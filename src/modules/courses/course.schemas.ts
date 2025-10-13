// src/modules/courses/course.schemas.ts
import { z } from 'zod';
import { COURSE_MODE, LESSON_TYPES, AGE_GROUPS } from '../../utils/constants';

export const createCourseSchema = z.object({
  title: z.string().min(1).max(120),
  language: z.string().min(1).max(10),
  description: z.string().max(4000).optional().default(''),
  lessonType: z.enum([LESSON_TYPES.GROUP, LESSON_TYPES.ONE_ON_ONE]), // 'group' | 'one-on-one'
  studentCapacity: z.number().int().min(1).max(100000),
  mode: z.enum([COURSE_MODE.ONLINE, COURSE_MODE.IN_PERSON]).default(COURSE_MODE.ONLINE),

  // attachment reference from S3 finalize step
  introImageAttachmentId: z.string().min(1).optional(),

  pricePerLesson: z.number().min(0),
  currency: z.string().length(3).default('USD'),

  // age groups aligned to your constants
  ageGroups: z.array(z.enum(AGE_GROUPS as unknown as [string, ...string[]])).min(1),

  startDate: z.string().datetime(),
  endDate: z.string().datetime().nullable().optional()
});

export const updateCourseSchema = createCourseSchema.partial().extend({
  published: z.boolean().optional(),
  archivedAt: z.string().datetime().nullable().optional()
});

export const listCourseQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  language: z.string().optional(),
  status: z.enum(['ACTIVE', 'DRAFT', 'ARCHIVED']).optional(),
  priceMin: z.coerce.number().min(0).optional(),
  priceMax: z.coerce.number().min(0).optional(),
  trialAvailable: z.coerce.boolean().optional(),
  startFrom: z.string().datetime().optional(),
  endTo: z.string().datetime().optional(),
  q: z.string().min(2).max(80).optional()
});
