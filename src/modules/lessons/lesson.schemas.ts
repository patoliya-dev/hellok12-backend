import { z } from 'zod';
import { teacherDashboardService } from '../dashboards/dashboards.service';

const id24 = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

// Accept either 24h "HH:MM" (00:00 - 23:59) OR 12h "H:MM AM/PM" (allow optional leading zero)
const RE_24H = /^(?:[01]\d|2[0-3]):[0-5]\d$/; // 00:00 - 23:59
const RE_12H = /^(0?[1-9]|1[0-2]):[0-5]\d\s?(AM|PM)$/i; // 1:00 AM - 12:59 PM (with optional leading 0 and optional space)

// helper: coerce to Date only when possible
const toDate = (v: unknown) => (typeof v === 'string' && v ? new Date(v) : undefined);

function isValidTimeString(v: unknown) {
  if (v === undefined || v === null) return false;
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s) return false;
  return RE_24H.test(s) || RE_12H.test(s);
}

export const lessonCreateSchema = z.object({
  courseId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid courseId'),
  teacherId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid teacherId')
    .optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  schedule: z.object({
    // Accept date strings or Date objects; will be normalized by BE parseStartEnd
    date: z.preprocess(
      v => {
        // keep YYYY-MM-DD strings as-is (preferred), accept full ISO strings too,
        // and accept Date objects only if caller intentionally sent a Date instant.
        if (v instanceof Date) return v; // allow Date objects
        if (typeof v === 'string') {
          const ds = v.trim();
          // allow bare date "YYYY-MM-DD" and full ISO strings
          if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) return ds;
          // if full ISO (with time/offset), allow -> leave as string to parse later
          if (/^\d{4}-\d{2}-\d{2}T/.test(ds) || /^\d{4}-\d{2}-\d{2}$/.test(ds)) return ds;
          // otherwise return original for zod to reject
          return ds;
        }
        return v;
      },
      z.union([z.string(), z.date()])
    ),
    // accept 24h HH:MM OR 12h HH:MM AM/PM
    time: z.string().refine(v => isValidTimeString(v), {
      message: 'Time must be in HH:MM (24h) or HH:MM AM/PM format'
    }),
    // duration in minutes; keep your existing rules (>=30 and <=60)
    duration: z
      .preprocess(v => {
        if (v === '' || v === null || v === undefined) return undefined;
        if (typeof v === 'string') return Number(v);
        return v;
      }, z.number().int())
      .refine(n => Number.isInteger(n), { message: 'Duration must be an integer' })
      .refine(n => n >= 30, { message: 'Duration must be at least 30 minute' })
      .refine(n => n <= 60, { message: 'Duration must be ≤ 60 minutes' })
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
    .refine(v => isValidTimeString(v), {
      message: 'Time must be in HH:MM (24h) or HH:MM AM/PM format'
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
  status: z.enum(['draft', 'active', 'archived']).optional().default('draft'),
  teacherId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid teacherId')
    .optional()
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
