import { z } from 'zod';

const timeRegex = /^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i;

export const lessonCreateSchema = z.object({
  courseId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid courseId'),
  teacherId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid teacherId')
    .optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  schedule: z.object({
    date: z.preprocess(v => new Date(v as any), z.date()),
    time: z.string().regex(/^(0?[1-9]|1[0-2]):[0-5][0-9]\s?(AM|PM)$/i),
    duration: z.number().int().min(1).max(60).default(60) // 1hr max as per your rule
  }),
  isTrial: z.boolean().default(false),
  trialCapacity: z.number().int().min(1).max(1000).optional(),
  order: z.number().int().min(0).default(0)
});

export const lessonUpdateSchema = lessonCreateSchema.partial();

export const lessonReorderSchema = z.object({
  items: z.array(z.object({ lessonId: z.string(), order: z.number().int().min(0) }))
});

// HH:MM AM/PM
const time12h = /^(0?[1-9]|1[0-2]):[0-5]\d\s?(AM|PM)$/i;

export const bulkCreateLessonsSchema = z.object({
  params: z.object({
    courseId: z.string().min(1)
  }),
  body: z.object({
    lessons: z
      .array(
        z.object({
          title: z.string().min(1, 'Title is required'),
          description: z.string().optional(),
          schedule: z.object({
            date: z.preprocess(v => new Date(v as any), z.date()),
            time: z.string().regex(time12h, 'Invalid time; expected "HH:MM AM/PM"'),
            duration: z.number().int().min(1).max(180) // allow up to 180 if needed
          }),
          isTrial: z.boolean().default(false),
          trialCapacity: z.number().int().min(0).optional(),
          order: z.number().int().min(0).optional()
        })
      )
      .min(1)
      .max(100)
  })
});

export type BulkCreateLessonsInput = z.infer<typeof bulkCreateLessonsSchema>;
