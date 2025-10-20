import { z } from 'zod';
export const presignSchema = z.object({
  filename: z.string().min(1),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z
    .number()
    .int()
    .min(1)
    .max(Number(process.env.S3_MAX_UPLOAD_MB || 5) * 1024 * 1024),
  entityType: z.string().optional(),
  entityId: z.string().optional()
});
export const completeSchema = z.object({
  key: z.string().min(1),
  entityType: z.string().optional(),
  entityId: z.string().optional()
});
