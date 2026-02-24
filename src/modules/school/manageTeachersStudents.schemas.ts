import { z } from 'zod';

const objectIdRegex = /^[a-f\d]{24}$/i;

export const sendTeacherNotificationSchema = z.object({
  params: z.object({
    teacherId: z.string().regex(objectIdRegex, 'Invalid teacher id')
  }),
  query: z.object({}).optional().default({}),
  body: z.object({
    message: z.string().trim().min(5).max(500),
    title: z.string().trim().max(80).optional(),
    schoolId: z.string().regex(objectIdRegex, 'Invalid school id').optional(),
    context: z.string().trim().max(60).optional()
  })
});
