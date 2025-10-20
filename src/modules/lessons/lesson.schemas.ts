import { z } from 'zod';

const sessionSchema = z.object({
  startTime: z.string().datetime(),
  durationMinutes: z.number().int().min(1).max(600)
});

export const createLessonSchema = z
  .object({
    title: z.string().min(1).max(120),
    description: z.string().max(4000).optional().default(''),
    sessions: z.array(sessionSchema).min(1).max(50),
    trialAvailable: z.boolean().default(false),
    trialCapacity: z.number().int().min(0).max(100000).default(0),
    orderIndex: z.number().int().min(1).optional()
  })
  .superRefine((val, ctx) => {
    // start times must be unique and in course range; range check occurs in controller
    const seen = new Set<string>();
    for (const s of val.sessions) {
      if (seen.has(s.startTime))
        ctx.addIssue({
          code: 'custom',
          path: ['sessions'],
          message: 'Duplicate session startTime'
        });
      seen.add(s.startTime);
    }
  });

export const updateLessonSchema = createLessonSchema.partial().extend({
  published: z.boolean().optional(),
  archivedAt: z.string().datetime().nullable().optional()
});

export const listLessonQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
