import { z } from 'zod';
import { normalizeTime12h } from '../../utils/validators';

const id24 = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const time12h = /^(0?[1-9]|1[0-2]):[0-5]\d\s?(AM|PM)$/i;

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
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  isTrialAvailable: z.boolean().default(false),
  trialCapacity: z.number().int().min(1).max(1000).optional(),
  order: z.number().int().min(0).default(0)
});

export const lessonUpdateSchema = lessonCreateSchema.partial();

export const lessonReorderSchema = z.object({
  items: z.array(z.object({ lessonId: z.string(), order: z.number().int().min(0) }))
});

export const lessonScheduleSchema = z.object({
  date: z.preprocess(v => new Date(v as any), z.date()),
  time: z.preprocess(
    v => normalizeTime12h(v),
    z.string().regex(time12h, 'Invalid time; expected "HH:MM AM/PM"')
  ),
  duration: z.coerce.number().int().min(1).max(180)
});

export const lessonCreateItemSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  schedule: lessonScheduleSchema,
  isTrialAvailable: z.boolean().optional().default(false),
  trialCapacity: z.coerce.number().int().min(0).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional().default('draft'),
  order: z.coerce.number().int().min(0).optional(),
  // (Optional) vocab or tags if UI uses them
  vocabulary: z.array(z.string()).optional()
});

export const lessonUpdateItemSchema = z.object({
  lessonId: id24, // required to update
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  schedule: lessonScheduleSchema.partial().optional(), // partial schedule updates allowed
  isTrialAvailable: z.boolean().optional(),
  trialCapacity: z.coerce.number().int().min(0).optional(),
  order: z.coerce.number().int().min(0).optional(),
  vocabulary: z.array(z.string()).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional()
});

export const bulkCreateLessonsSchema = z.object({
  params: z.object({ courseId: id24 }),
  body: z.object({
    lessons: z.array(lessonCreateItemSchema).min(1).max(100)
  })
});
export type BulkCreateLessonsInput = z.infer<typeof bulkCreateLessonsSchema>;

export const bulkUpdateLessonsSchema = z.object({
  params: z.object({ courseId: id24 }),
  body: z.object({
    updates: z.array(lessonUpdateItemSchema).min(1).max(100).optional(),
    deletes: z.array(id24).optional() // lesson ids to delete (optional)
  })
});

export const lessonItemSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  schedule: lessonScheduleSchema,
  isTrialAvailable: z.boolean().optional().default(false),
  trialCapacity: z.coerce.number().int().min(0).optional(),
  order: z.coerce.number().int().min(0).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional().default('draft')
});

export type BulkUpdateLessonsInput = z.infer<typeof bulkUpdateLessonsSchema>;
export type LessonItemInput = z.infer<typeof lessonItemSchema>;
