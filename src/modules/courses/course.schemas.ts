import { z } from 'zod';
import { COURSE_MODE, LESSON_TYPES, AGE_GROUPS } from '../../utils/constants';

export const courseCreateSchema = z.object({
  title: z.string().min(2).max(160),
  description: z.string().max(4000).optional().default(''),
  language: z.string().min(2).max(10),
  lessonType: z.enum([LESSON_TYPES.ONE_ON_ONE, LESSON_TYPES.GROUP]),
  studentCapacity: z.coerce.number().int().min(1),
  mode: z.enum([COURSE_MODE.ONLINE, COURSE_MODE.IN_PERSON]),
  pricePerLesson: z.coerce.number().min(0),
  currency: z.string().default('USD'),
  ageGroups: z.array(z.enum(AGE_GROUPS as unknown as [string, ...string[]])).min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),

  introImageAttachmentId: z.string().optional(),
  introImageUrl: z.string().url().optional(),

  status: z.enum(['draft', 'active', 'archived']).optional().default('draft')
});

export const courseUpdateSchema = courseCreateSchema.partial();

export const listQuerySchema = z.object({
  search: z.string().max(120).optional(),
  language: z.string().max(10).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  trialAvailable: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform(v => (typeof v === 'boolean' ? v : v?.toLowerCase() === 'true')),
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
