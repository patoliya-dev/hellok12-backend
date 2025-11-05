import { z } from 'zod';
import { COURSE_MODE, LESSON_TYPES, AGE_GROUPS } from '../../utils/constants';

export const courseCreateSchema = z.object({
  title: z.string().min(2).max(160),
  description: z.string().max(4000).optional(),
  language: z.string().min(2).max(10),
  lessonType: z.enum([LESSON_TYPES.ONE_ON_ONE, LESSON_TYPES.GROUP]),
  studentCapacity: z.coerce.number().int().min(1),
  mode: z.enum([COURSE_MODE.ONLINE, COURSE_MODE.IN_PERSON]),
  price: z.coerce.number().min(0),
  currency: z.string().default('USD'),
  ageGroups: z.array(z.enum(AGE_GROUPS as unknown as [string, ...string[]])).min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullable().optional(),
  introImageRef: z.string().optional(),
  status: z.enum(['draft', 'active', 'archived']).default('draft')
});

export type CourseCreateDTO = z.infer<typeof courseCreateSchema>;

export const courseUpdateSchema = z
  .object({
    title: z.string().min(2).max(160).optional(),
    description: z.string().max(4000).optional(),
    language: z.string().min(2).max(10).optional(),
    lessonType: z.enum([LESSON_TYPES.ONE_ON_ONE, LESSON_TYPES.GROUP]).optional(),
    studentCapacity: z.coerce.number().int().min(1).optional(),
    mode: z.enum([COURSE_MODE.ONLINE, COURSE_MODE.IN_PERSON]).optional(),
    price: z.coerce.number().min(0).optional(),
    currency: z.string().optional(),
    ageGroups: z.array(z.enum(AGE_GROUPS as unknown as [string, ...string[]])).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().nullable().optional(),
    introImageRef: z.string().optional(),
    status: z.enum(['draft', 'active', 'archived']).optional()
  })
  .partial()
  .refine(
    data =>
      !data.startDate ||
      !data.endDate ||
      (data.startDate && data.endDate && data.endDate >= data.startDate),
    { message: 'endDate must be greater than or equal to startDate', path: ['endDate'] }
  );

export type CourseUpdateDTO = z.infer<typeof courseUpdateSchema>;

export const listQuerySchema = z.object({
  search: z.string().max(120).optional(),
  language: z.string().max(10).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  isTrialAvailable: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform(v => (typeof v === 'boolean' ? v : v ? v?.toLowerCase() === 'true' : undefined)),
  priceMin: z.coerce.number().min(0).optional(),
  priceMax: z.coerce.number().min(0).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),

  // table sorts
  sortBy: z
    .enum([
      'newest',
      'titleAsc',
      'titleDesc',
      'languageAsc',
      'languageDesc',
      'studentsAsc',
      'studentsDesc',
      'priceAsc',
      'priceDesc',
      'statusAsc',
      'statusDesc',
      'startDateAsc',
      'startDateDesc'
    ])
    .default('newest'),

  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10)
});
