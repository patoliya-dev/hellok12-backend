import { z } from 'zod';

const objectIdRegex = /^[a-f\d]{24}$/i;
const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const upiRegex = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;

const optStr = z.preprocess(
  v => (typeof v === 'string' ? v.trim() : undefined),
  z.string().optional()
);

const accountTypeSchema = z.enum(['SAVINGS', 'CURRENT']);
const ownerTypeSchema = z.enum(['TEACHER', 'SCHOOL']);
const statusSchema = z.enum(['PENDING', 'VERIFIED', 'REJECTED']);

const payoutAccountBodySchema = z
  .object({
    country: z.string().trim().min(2).max(3).optional(),
    currency: z.string().trim().min(3).max(3).optional(),
    holderName: z.string().trim().min(2).max(120),
    bankName: z.string().trim().min(2).max(120),
    accountNumber: z.string().trim().min(6).max(34),
    ifsc: optStr
      .transform(v => (v ? v.toUpperCase() : ''))
      .refine(v => !v || ifscRegex.test(v), 'Invalid IFSC format'),
    branchName: optStr,
    accountType: accountTypeSchema.optional(),
    upiId: optStr.refine(v => !v || upiRegex.test(v), 'Invalid UPI format')
  })
  .strict();

export const getMyPayoutAccountSchema = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  params: z.object({}).optional().default({})
});

export const createMyPayoutAccountSchema = z.object({
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  body: payoutAccountBodySchema
});

export const patchMyPayoutAccountSchema = z.object({
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  body: payoutAccountBodySchema.partial()
});

export const listAdminPayoutAccountsSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    ownerType: ownerTypeSchema.optional(),
    status: statusSchema.optional(),
    q: z.preprocess(v => (typeof v === 'string' ? v.trim() : ''), z.string().max(120)).optional(),
    page: z.preprocess(v => Number(v ?? 1), z.number().int().min(1).max(100000)).default(1),
    limit: z.preprocess(v => Number(v ?? 10), z.number().int().min(1).max(100)).default(10)
  })
});

export const payoutAccountIdParamSchema = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  params: z.object({ id: z.string().regex(objectIdRegex, 'Invalid payout account id') })
});

export const verifyPayoutAccountSchema = z.object({
  query: z.object({}).optional().default({}),
  params: z.object({ id: z.string().regex(objectIdRegex, 'Invalid payout account id') }),
  body: z
    .object({ note: z.string().trim().max(250).optional() })
    .optional()
    .default({})
});

export const rejectPayoutAccountSchema = z.object({
  query: z.object({}).optional().default({}),
  params: z.object({ id: z.string().regex(objectIdRegex, 'Invalid payout account id') }),
  body: z.object({
    reason: z.string().trim().min(3).max(250)
  })
});

export type PayoutAccountCreateInput = z.infer<typeof createMyPayoutAccountSchema>['body'];
export type PayoutAccountPatchInput = z.infer<typeof patchMyPayoutAccountSchema>['body'];
