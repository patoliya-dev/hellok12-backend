import { Request, Response } from 'express';
import crypto from 'crypto';
import { headObject, makePresignedPost } from '../../utils/s3';
import { AttachmentModel } from '../../models/attachment.model';

const BUCKET = process.env.S3_BUCKET!;
const BASE = (process.env.S3_PUBLIC_BASE || '').replace(/\/$/, '');

export const presign = async (req: Request, res: Response) => {
  const { filename, mime, size, entityType, entityId } = req.body;
  const ext = filename.includes('.') ? filename.split('.').pop() : 'bin';
  const uuid = crypto.randomUUID();
  const prefix =
    entityType === 'Course' && entityId ? `courses/${entityId}/intro` : `uploads/${req.user!.id}`;
  const key = `${prefix}/${uuid}.${ext}`;
  const post = await makePresignedPost({ bucket: BUCKET, key, contentType: mime, maxBytes: size });
  return res.json({ upload: post, key });
};

export const complete = async (req: Request, res: Response) => {
  const { key, entityType, entityId } = req.body;
  const head = await headObject(BUCKET, key);
  if (!head?.ContentLength || !head?.ContentType || !head?.ETag)
    return res.status(400).json({ error: 'OBJECT_NOT_FOUND_OR_INVALID' });
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
  res.status(201).json(att);
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
