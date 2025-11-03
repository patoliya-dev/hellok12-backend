import { Request, Response } from 'express';

import { buildS3Path, headObject, makePresignedPost, s3 } from '../../utils/s3';
import { AttachmentModel } from '../../models/attachment.model';
import { createErrorResponse, createSuccessResponse } from '../../utils/apiResponse';
import { CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import config from '../../config/config';
import Logger from '../../utils/winstonLogger.utils';

const BUCKET = config.AWS_CONFIG.S3_ASSET_BUCKET!;
const BASE = (config.AWS_CONFIG.S3_ASSETS_PUBLIC_BASE || '').replace(/\/$/, '');
const MAX_BYTES_DEFAULT = 5 * 1024 * 1024; // 5MB default
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'video/quicktime'
]); // tweak as needed

/**
 * Build S3 key prefix.
 * - If we know the entity, we can put it under its final folder.
 * - If entity is not known (e.g. creating course step-1), we stage under user-specific area.
 */
function buildUploadPrefix({
  userId,
  entityType,
  entityId,
  scope // optional logical scope like "intro"
}: {
  userId: string;
  entityType?: string | null;
  entityId?: string | null;
  scope?: string | null;
}) {
  // Known Course intro: courses/<courseId>/intro
  if (entityType === 'Course' && entityId) {
    const s = scope || 'intro';
    return `courses/${entityId}/${s}`;
  } else if (entityType === 'User' && entityId) {
    const s = scope;
    return `users/${entityId}${s ? `/${s}` : ''}`;
  } else if (entityType === 'TeacherProfile' && entityId && scope) {
    const s = scope;
    return `teacherProfiles/${entityId}/${s}`;
  }
  // Fallback (staging): uploads/<userId>/staged
  return `uploads/${userId}/staged`;
}

/**
 * Step 1: Presign upload
 * - Stages file under user’s folder when entityId is unknown
 * - Returns normalized fields so the browser POST matches S3 policy
 */
export const presign = async (req: Request, res: Response) => {
  try {
    const { filename, mime, size, entityType, entityId, scope } = req.body;
    if (!filename || !mime || !size) {
      return res
        .status(400)
        .json(createErrorResponse('Missing required params', 'Bad Request', 400));
    }
    if (!ALLOWED_MIME.has(mime)) {
      return res
        .status(422)
        .json(createErrorResponse('Unsupported file type', 'Unprocessable Entity', 422));
    }

    const maxBytes = Number(process.env.S3_UPLOAD_MAX_BYTES || MAX_BYTES_DEFAULT);
    if (Number(size) > maxBytes) {
      return res.status(413).json(createErrorResponse('File too large', 'Payload Too Large', 413));
    }

    const ext = filename.includes('.') ? filename.split('.').pop() : 'bin';
    const timestamp = Date.now();

    const prefix = buildUploadPrefix({
      userId: req.user!.id,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      scope: scope ?? null
    });

    const key = `${prefix}/${timestamp}_${filename}`;

    const post = await makePresignedPost({
      bucket: BUCKET,
      key,
      contentType: mime,
      maxBytes: Number(size)
    });

    return res.json(createSuccessResponse({ upload: post, key }, 'Presigned', 200));
  } catch (err: any) {
    return res
      .status(500)
      .json(createErrorResponse('Failed to presign upload', 'Internal Server Error', 500));
  }
};

/**
 * Step 2: Complete upload
 * - Verifies S3 object exists
 * - Creates Attachment row (can remain unbound to entity until claimed)
 */
export const complete = async (req: Request, res: Response) => {
  try {
    const { key, entityType, entityId, isPublic } = req.body;
    if (!key) {
      return res.status(400).json(createErrorResponse('Missing key', 'Bad Request', 400));
    }

    const head = await headObject(BUCKET, key);
    if (!head?.ContentLength || !head?.ContentType || !head?.ETag) {
      return res
        .status(400)
        .json(createErrorResponse('OBJECT_NOT_FOUND_OR_INVALID', 'Bad Request', 400));
    }

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
      entityType: entityType ?? null, // can be null at this stage
      entityId: entityId ?? null, // can be null at this stage
      status: 'READY',
      storageType: 'S3',
      isPublic: isPublic !== undefined ? !!isPublic : true
    });

    return res.status(201).json(createSuccessResponse(att, 'Attachment Created', 201));
  } catch (err: any) {
    return res
      .status(500)
      .json(createErrorResponse('Attachment finalize failed', 'Internal Server Error', 500));
  }
};

/**
 * Step 2.5 (NEW): Claim an existing staged attachment to an entity (Course, Lesson, etc.)
 * - Optionally moves file to organized S3 prefix
 * - Ensures only the original uploader (or admins) can claim
 */
export const claim = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { entityType, entityId, moveToEntityPrefix = true, scope = 'intro' } = req.body;

    if (!entityType || !entityId) {
      return res
        .status(400)
        .json(createErrorResponse('entityType & entityId required', 'Bad Request', 400));
    }
    const att = await AttachmentModel.findById(id);

    if (!att) {
      return res.status(404).json(createErrorResponse('Not found', 'Not Found', 404));
    }

    // Security: only the uploader can claim (extend with RBAC as needed)
    if (String(att.uploadedBy) !== req.user!.id) {
      return res.status(403).json(createErrorResponse('Forbidden', 'Forbidden', 403));
    }

    // If we want to physically move to organized location (recommended)
    let newKey = att.key;
    if (moveToEntityPrefix) {
      const fileName = att.name || att.key.split('/').pop()!;
      const targetPrefix = (() => {
        // Standardized prefixes per entity (extend as needed)
        const type = String(entityType).toLowerCase();
        if (type === 'course') return `courses/${entityId}/${scope}`;
        if (type === 'lesson') return `lessons/${entityId}/${scope}`;
        if (type === 'user') return `users/${entityId}/${scope}`;
        if (type === 'school') return `schools/${entityId}/${scope}`;
        return `${type}s/${entityId}/${scope}`; // fallback
      })();

      const targetKey = `${targetPrefix}/${fileName}`;

      if (targetKey !== att.key) {
        await s3.send(
          new CopyObjectCommand({
            Bucket: BUCKET,
            CopySource: `/${BUCKET}/${att.key}`,
            Key: targetKey,
            ServerSideEncryption: 'AES256',
            MetadataDirective: 'COPY'
          })
        );
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: att.key }));
        newKey = targetKey;
      }
    }

    att.entityType = entityType;
    att.entityId = entityId;
    att.key = newKey;
    att.url = `${BASE}/${newKey}`;
    await att.save();

    return res.json(createSuccessResponse(att, 'Attachment Claimed', 200));
  } catch (err: any) {
    return res
      .status(500)
      .json(createErrorResponse('Attachment claim failed', 'Internal Server Error', 500));
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

/**
 * Step 3: Soft delete
 */
export const softDelete = async (req: Request, res: Response) => {
  try {
    const a = await AttachmentModel.findByIdAndUpdate(
      req.params.id,
      { $set: { status: 'DELETED' } },
      { new: true }
    ).lean();
    if (!a) {
      return res.status(404).json(createErrorResponse('Not found', 'Not found', 404));
    }
    return res.json(createSuccessResponse(a, 'Deleted'));
  } catch (err: any) {
    return res
      .status(500)
      .json(createErrorResponse('Internal Server Error', 'Internal Server Error', 500));
  }
};
