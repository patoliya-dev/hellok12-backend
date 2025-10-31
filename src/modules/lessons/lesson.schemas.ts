import { z } from 'zod';

const id24 = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const TIME_12H = /^(0?[1-9]|1[0-2]):[0-5]\d\s?(AM|PM)$/i;
const toDate = (v: unknown) => (typeof v === 'string' && v ? new Date(v) : undefined);

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
  date: z
    .preprocess(v => {
      if (v === '' || v === null || v === undefined) return undefined;
      const d = v instanceof Date ? v : new Date(String(v));
      return isNaN(d.getTime()) ? undefined : d;
    }, z.date())
    .refine(d => d instanceof Date && !isNaN(d.getTime()), {
      message: 'Invalid date'
    }),

  time: z
    .string()
    .refine(v => v !== undefined && v !== null && String(v).trim() !== '', {
      message: 'Time is required'
    })
    .refine(v => TIME_12H.test(String(v).trim()), {
      message: 'Time must be in format HH:MM AM/PM'
    }),

  duration: z
    .preprocess(v => {
      if (v === '' || v === null || v === undefined) return undefined;
      const n = typeof v === 'string' ? Number(v) : v;
      return n;
    }, z.number().int())
    .refine(n => Number.isInteger(n), { message: 'Duration must be an integer' })
    .refine(n => n >= 30, { message: 'Duration must be at least 30 minute' })
    .refine(n => n <= 60, { message: 'Duration must be ≤ 60 minutes' })
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

export const listLessonsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),

  search: z.string().trim().optional().default(''),

  // accept either startDate/endDate or dateFrom/dateTo (mirrors course API names)
  startDate: z.preprocess(toDate, z.date().optional()),
  endDate: z.preprocess(toDate, z.date().optional()),
  dateFrom: z.preprocess(toDate, z.date().optional()),
  dateTo: z.preprocess(toDate, z.date().optional()),

  // optional filters aligned to your model
  status: z.enum(['draft', 'active', 'archived']).optional(),
  isTrialAvailable: z.coerce.boolean().optional(),

  // two styles supported:
  // 1) sortBy (like courses API)
  sortBy: z
    .enum([
      'newest',
      'titleAsc',
      'titleDesc',
      'startAtAsc',
      'startAtDesc',
      'statusAsc',
      'statusDesc'
    ])
    .optional(),

  // 2) sortKey + sortDirection (compatible with your curl)
  sortKey: z.enum(['title', 'startAt', 'createdAt', 'status']).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional()
});
