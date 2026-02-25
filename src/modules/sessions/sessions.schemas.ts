import { z } from 'zod';

export const sessionIdParamsSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid session id')
});

export const completeSessionSchema = z.object({
  note: z.string().trim().max(500).optional()
});
