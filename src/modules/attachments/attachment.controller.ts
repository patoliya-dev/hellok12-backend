import { Request, Response } from 'express';
import crypto from 'crypto';
import { headObject, makePresignedPost } from '../../utils/s3';
import { AttachmentModel } from '../../models/attachment.model';
import { createErrorResponse, createSuccessResponse } from '../../utils/apiResponse';

const BUCKET = process.env.S3_BUCKET!;
const BASE = (process.env.S3_PUBLIC_BASE || '').replace(/\/$/, '');

/**
 * Step 1: Presign upload
 */
export const presign = async (req: Request, res: Response) => {
  try {
    const { filename, mime, size, entityType, entityId } = req.body;
    if (!filename || !mime || !size)
      return res
        .status(400)
        .json(createErrorResponse('Missing required params', 'Bad Request', 400));

    const ext = filename.includes('.') ? filename.split('.').pop() : 'bin';
    const uuid = crypto.randomUUID();
    const prefix =
      entityType === 'Course' && entityId ? `courses/${entityId}/intro` : `uploads/${req.user!.id}`;
    const key = `${prefix}/${uuid}.${ext}`;

    const post = await makePresignedPost({
      bucket: BUCKET,
      key,
      contentType: mime,
      maxBytes: size
    });

    return res.json(createSuccessResponse({ upload: post, key }, 'Presigned', 200));
  } catch (err: any) {
    console.error('presign error:', err);
    return res
      .status(500)
      .json(createErrorResponse('Failed to presign upload', 'Internal Server Error', 500));
  }
};

/**
 * Step 2: Complete upload
 */
export const complete = async (req: Request, res: Response) => {
  try {
    const { key, entityType, entityId } = req.body;
    if (!key) return res.status(400).json(createErrorResponse('Missing key', 'Bad Request', 400));

    const head = await headObject(BUCKET, key);
    if (!head?.ContentLength || !head?.ContentType || !head?.ETag)
      return res
        .status(400)
        .json(createErrorResponse('OBJECT_NOT_FOUND_OR_INVALID', 'Bad Request', 400));

    const url = `${BASE}/${key}`;
    const att = await AttachmentModel.create({
      name: key.split('/').pop(),
      size: head.ContentLength,
      mime: head.ContentType,
      bucket: BUCKET,
      key,
      url,
      etag: String(head.ETag).replace(/"/g, ''),
      uploadedBy: req.user!.id,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      status: 'READY',
      storageType: 'S3',
      isPublic: true
    });

    return res.status(201).json(createSuccessResponse(att, 'Attachment Created', 201));
  } catch (err: any) {
    console.error('complete error:', err);
    return res
      .status(500)
      .json(createErrorResponse('Attachment finalize failed', 'Internal Server Error', 500));
  }
};

/**
 * Step 3: Soft delete
 */
export const softDelete = async (req: Request, res: Response) => {
  const a = await AttachmentModel.findByIdAndUpdate(
    req.params.id,
    { $set: { status: 'DELETED' } },
    { new: true }
  ).lean();

  if (!a) return res.status(404).json(createErrorResponse('Not found', 'Not found', 404));
  return res.json(createSuccessResponse(a, 'Deleted'));
};
