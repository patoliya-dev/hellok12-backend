import { Request, Response } from 'express';

import { buildS3Path, headObject, makePresignedPost, s3 } from '../../utils/s3';
import { AttachmentModel } from '../../models/attachment.model';
import Logger from '../../utils/winstonLogger.utils';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';

const BUCKET = process.env.S3_BUCKET!;
const BASE = (process.env.S3_PUBLIC_BASE || '').replace(/\/$/, '');

/**
 * Generates a presigned URL for an S3 file upload
 * @returns {status: 200, data: {upload: string, key: string}}
 */
export const presign = async (req: Request, res: Response) => {
  const { filename, mime, size, entityType, entityId, prefix = '' } = req.body;
  const ext = filename.includes('.') ? filename.split('.').pop() : 'bin';

  const key = buildS3Path({ entityType, entityId, prefix, ext });
  // course/68ee186d48843ffa41614071/intro/48eb8375-5e52-4191-90c9-264d3965b689.png

  const post = await makePresignedPost({ bucket: BUCKET, key, contentType: mime, maxBytes: size });
  return res.json({ upload: post, key });
};

// export const complete = async (req: Request, res: Response) => {
//   const { key, entityType, entityId } = req.body;
//   const head = await headObject(BUCKET, key);
//   if (!head?.ContentLength || !head?.ContentType || !head?.ETag)
//     return res.status(400).json({ error: 'OBJECT_NOT_FOUND_OR_INVALID' });
//   const url = `${BASE}/${key}`;
//   const att = await AttachmentModel.create({
//     name: key.split('/').pop(),
//     size: head.ContentLength,
//     mime: head.ContentType,
//     bucket: BUCKET,
//     key,
//     url,
//     etag: String(head.ETag).replace(/"/g, ''),
//     uploadedBy: req.user!.id,
//     entityType: entityType ?? null,
//     entityId: entityId ?? null,
//     status: 'READY',
//     storageType: 'S3',
//     isPublic: true
//   });
//   return res.status(201).json(att);
// };

/**
 * Marks an uploaded S3 file as completed and creates an Attachment record
 * This endpoint should be called AFTER the frontend successfully uploads to S3 using a presigned URL.
 * @returns {status: 201, data: Attachment}
 */
export const complete = async (req: Request, res: Response) => {
  const { key, entityType, entityId } = req.body;

  try {
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: 'INVALID_KEY', message: 'File key is required.' });
    }

    let head;
    try {
      head = await headObject(BUCKET, key);
    } catch (err: any) {
      Logger.warn(`S3 headObject failed for key=${key}`, err);
      return res.status(404).json({
        error: 'OBJECT_NOT_FOUND',
        message: 'Uploaded file not found in S3 bucket.'
      });
    }

    const attachmentData = {
      name: key.split('/').pop() || 'unnamed_file',
      size: head.ContentLength,
      mime: head.ContentType,
      bucket: BUCKET,
      key,
      url: `${BASE}/${key}`,
      etag: String(head.ETag).replace(/"/g, ''),
      uploadedBy: req.user?.id,
      entityType: entityType || null,
      entityId: entityId || null,
      status: 'READY',
      storageType: 'S3',
      isPublic: true
    };

    const attachment = await AttachmentModel.create(attachmentData);

    Logger.info(
      `Attachment created successfully: ${attachment._id} (key=${key}, user=${req.user?.id})`
    );

    return res.status(201).json({
      success: true,
      message: 'Attachment created successfully.',
      data: attachment
    });
  } catch (error: any) {
    Logger.error('Attachment complete failed:', error);

    return res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong while finalizing the upload.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Marks an uploaded S3 file as completed and update an Attachment record
 * This endpoint should be called AFTER the frontend successfully uploads to S3 using a presigned URL if attachmentId exists.
 * @returns {status: 200, data: Attachment}
 */
export const updateAttachment = async (req: Request, res: Response) => {
  const { attachmentId, key } = req.body;

  try {
    if (!attachmentId) {
      return res
        .status(400)
        .json({ error: 'MISSING_ATTACHMENT_ID', message: 'Attachment ID is required.' });
    }

    const attachment = await AttachmentModel.findById(attachmentId);
    if (!attachment) {
      return res
        .status(404)
        .json({ error: 'ATTACHMENT_NOT_FOUND', message: 'No attachment found with the given ID.' });
    }
    const oldKey = attachment.key;

    if (key && key !== attachment.key) {
      let head;
      try {
        head = await headObject(BUCKET, key);
      } catch (err: any) {
        Logger.warn(`S3 headObject failed for key=${key}`, err);
        return res
          .status(404)
          .json({ error: 'OBJECT_NOT_FOUND', message: 'File not found in S3 bucket.' });
      }

      // Update key and related fields if file changed
      attachment.key = key;
      attachment.url = `${BASE}/${key}`;
      attachment.size = head.ContentLength || 0;
      attachment.mime = head.ContentType || '';
    }

    const updatedAttachment = await attachment.save();

    Logger.info(`Attachment updated: ${attachmentId} by user=${req.user?.id}`);

    if (oldKey !== attachment.key) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: oldKey }));
        Logger.info(`Old S3 file deleted: ${oldKey}`);
      } catch (error) {
        Logger.warn(`Failed to delete old S3 file: ${oldKey}`, error);
        return res
          .status(500)
          .json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete old S3 file.' });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Attachment updated successfully.',
      data: updatedAttachment
    });
  } catch (error: any) {
    Logger.error('Attachment update failed:', error);
    return res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong while updating the attachment.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export const softDelete = async (req: Request, res: Response) => {
  const a = await AttachmentModel.findByIdAndUpdate(
    req.params.id,
    { $set: { status: 'DELETED' } },
    { new: true }
  ).lean();
  if (!a) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json(a);
};
