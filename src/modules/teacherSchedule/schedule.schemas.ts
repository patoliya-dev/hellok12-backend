import { z } from 'zod';
import { TIME_24H, ISO_DATE } from './schedule.util';

// 24-char ObjectId (reuse your helper if you wish)
const id24 = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

const slotString = z.string().regex(TIME_24H, 'Time must be HH:MM (24h)');
const slotArray = z.array(slotString).min(0);

export const getScheduleSchema = z.object({
  params: z.object({ teacherId: id24 }),
  query: z.object({}).optional(),
  body: z.object({}).optional()
});

export const upsertWeeklySchema = z.object({
  params: z.object({ teacherId: id24 }),
  query: z.object({}).optional(),
  body: z.object({
    slotMinutes: z.coerce.number().int().min(15).max(240).optional(),
    weekly: z
      .object({
        0: slotArray.optional(),
        1: slotArray.optional(),
        2: slotArray.optional(),
        3: slotArray.optional(),
        4: slotArray.optional(),
        5: slotArray.optional(),
        6: slotArray.optional()
      })
      .partial()
      .optional()
  })
});

export const getSlotsForDateSchema = z.object({
  params: z.object({ teacherId: id24 }),
  query: z.object({ date: z.string().regex(ISO_DATE, 'date must be YYYY-MM-DD') }),
  body: z.object({}).optional()
});

export const patchDateSlotsSchema = z.object({
  params: z.object({ teacherId: id24 }),
  query: z.object({}).optional(),
  body: z
    .object({
      date: z.string().regex(ISO_DATE, 'date must be YYYY-MM-DD'),
      add: slotArray.optional(),
      remove: slotArray.optional(),
      toggle: slotArray.optional()
    })
    .refine(b => !!(b.add?.length || b.remove?.length || b.toggle?.length), {
      message: 'Provide at least one of add/remove/toggle'
    })
});

export const validateLessonBlockSchema = z.object({
  params: z.object({ teacherId: id24 }),
  query: z.object({}).optional(),
  body: z.object({
    date: z.string().regex(ISO_DATE, 'date must be YYYY-MM-DD'),
    start: z.string().regex(TIME_24H, 'start must be HH:MM (24h)'),
    end: z.string().regex(TIME_24H, 'end must be HH:MM (24h)')
  })
});
