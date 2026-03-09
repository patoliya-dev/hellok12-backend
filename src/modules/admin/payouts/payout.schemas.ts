import { z } from 'zod';

const objectIdRegex = /^[a-f\d]{24}$/i;
const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

const parseDate = (value: unknown) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value.trim());
    if (!Number.isNaN(d.getTime())) return d;
  }
  return value;
};

const optString = z.preprocess(
  v => (typeof v === 'string' && v.trim() ? v.trim() : undefined),
  z.string().optional()
);
const searchString = z.preprocess(
  v => (typeof v === 'string' && v.trim() ? v.trim() : undefined),
  z.string().max(120).optional()
);

const payeeTypeSchema = z.enum(['TEACHER', 'SCHOOL']);
const payoutStatusSchema = z.enum(['DRAFT', 'APPROVED', 'PAID', 'CANCELLED']);

const dateSchema = z.preprocess(parseDate, z.date());

const adjustmentSchema = z.object({
  type: z.string().trim().min(1).max(64),
  amount: z.number().int().min(-999999999).max(999999999),
  note: z.string().trim().max(500).optional().default('')
});

export const payoutPreviewSchema = z.object({
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  body: z
    .object({
      payeeType: payeeTypeSchema,
      payeeId: z.string().regex(objectIdRegex, 'Invalid payeeId'),
      periodStart: dateSchema,
      periodEnd: dateSchema,
      currency: z.string().trim().min(3).max(3).optional().default('usd'),
      adjustments: z.array(adjustmentSchema).optional().default([])
    })
    .refine(v => v.periodEnd >= v.periodStart, {
      message: 'periodEnd must be greater than or equal to periodStart',
      path: ['periodEnd']
    })
});

export const createPayoutSchema = payoutPreviewSchema;

export const listPayoutsSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    page: z.preprocess(v => Number(v ?? 1), z.number().int().min(1).max(100000)).default(1),
    limit: z.preprocess(v => Number(v ?? 10), z.number().int().min(1).max(100)).default(10),
    search: searchString.optional(),
    payeeType: payeeTypeSchema.optional(),
    payeeId: optString.refine(v => !v || objectIdRegex.test(v), 'Invalid payeeId').optional(),
    status: payoutStatusSchema.optional(),
    from: z
      .preprocess(v => {
        if (typeof v === 'string' && isoDateRegex.test(v.trim())) return new Date(v.trim());
        return undefined;
      }, z.date().optional())
      .optional(),
    to: z
      .preprocess(v => {
        if (typeof v === 'string' && isoDateRegex.test(v.trim())) {
          const d = new Date(v.trim());
          d.setHours(23, 59, 59, 999);
          return d;
        }
        return undefined;
      }, z.date().optional())
      .optional()
  })
});

export const payoutIdParamSchema = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  params: z.object({ id: z.string().regex(objectIdRegex, 'Invalid payout id') })
});

export const markPaidSchema = z.object({
  params: z.object({ id: z.string().regex(objectIdRegex, 'Invalid payout id') }),
  query: z.object({}).optional().default({}),
  body: z.object({
    paymentRef: z.string().trim().min(1).max(120),
    paidAt: z.preprocess(v => (v ? parseDate(v) : undefined), z.date().optional()).optional(),
    note: z.string().trim().max(500).optional().default('')
  })
});

export const cancelPayoutSchema = z.object({
  params: z.object({ id: z.string().regex(objectIdRegex, 'Invalid payout id') }),
  query: z.object({}).optional().default({}),
  body: z
    .object({
      note: z.string().trim().max(500).optional()
    })
    .optional()
    .default({ note: '' })
});

export type PayoutPreviewInput = z.infer<typeof payoutPreviewSchema>['body'];
export type CreatePayoutInput = z.infer<typeof createPayoutSchema>['body'];
