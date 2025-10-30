import { z } from 'zod';
import config from '../../config/config';
export const presignSchema = z.object({
  filename: z.string().min(1),
  mime: z.enum([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'video/mp4',
    'video/mov'
  ]),
  size: z
    .number()
    .int()
    .min(1)
    .max(Number(config.AWS_CONFIG.S3_MAX_UPLOAD_MB || 5) * 1024 * 1024),
  entityType: z.string().optional(),
  entityId: z.string().optional()
});
export const completeSchema = z.object({
  key: z.string().min(1),
  entityType: z.string().optional(),
  entityId: z.string().optional()
});

export const claimSchema = z.object({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  moveToEntityPrefix: z.boolean().optional(),
  scope: z.string().optional()
});

export const updateSchema = z.object({
  attachmentId: z.string().min(1),
  key: z.string().min(1).optional()
});
