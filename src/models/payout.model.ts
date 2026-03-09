import mongoose, { Schema, Document, Types } from 'mongoose';

export type PayoutKind = 'AUTO' | 'MANUAL';
export type ManualPayeeType = 'TEACHER' | 'SCHOOL';
export type ManualPayoutStatus = 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED';
export type LegacyPayoutStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SETTLED';

export interface IPayoutAdjustment {
  type: string;
  amount: number;
  note?: string;
}

export interface IPayoutLineItem {
  transactionId?: Types.ObjectId | string | null;
  bookingId?: Types.ObjectId | string | null;
  courseId?: Types.ObjectId | string | null;
  amount?: number;
  platformFee?: number;
  netAmount?: number;
  transactionDate?: Date;
  reference?: string;
}

export interface IPayout extends Document {
  payoutKind?: PayoutKind;

  transaction?: Types.ObjectId | string | null;
  invoice?: Types.ObjectId | string | null;
  toUser?: Types.ObjectId | string | null;
  toAccountId?: string | null;
  toType?: 'teacher' | 'school' | 'platform' | 'admin' | string | null;

  // Manual payout workflow fields (admin-created cash-out snapshots).
  payeeType?: ManualPayeeType;
  payeeId?: Types.ObjectId | string | null;
  periodStart?: Date;
  periodEnd?: Date;
  paidAt?: Date | null;
  paidBy?: Types.ObjectId | string | null;
  paymentRef?: string | null;
  lineItems?: IPayoutLineItem[];
  adjustments?: IPayoutAdjustment[];

  amount?: number; // cents
  currency?: string;
  platformFee?: number; // cents
  grossAmount?: number; // cents
  netAmount?: number; // cents

  stripeTransferId?: string | null;
  status?: ManualPayoutStatus | LegacyPayoutStatus;
  metadata?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

const PayoutSchema = new Schema<IPayout>({
  payoutKind: { type: String, enum: ['AUTO', 'MANUAL'], default: 'AUTO', index: true },

  transaction: { type: Schema.Types.ObjectId, ref: 'Transaction', index: true },
  invoice: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  toUser: { type: Schema.Types.ObjectId, ref: 'User' }, // teacher or school
  toAccountId: { type: String }, // stripe connected account id
  toType: { type: String, enum: ['teacher', 'school', 'platform', 'admin'], default: 'teacher' },

  payeeType: { type: String, enum: ['TEACHER', 'SCHOOL'], index: true },
  payeeId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  periodStart: { type: Date, index: true },
  periodEnd: { type: Date, index: true },

  amount: { type: Number }, // cents
  currency: { type: String, default: 'usd' },
  grossAmount: { type: Number },
  platformFee: { type: Number }, // cents
  netAmount: { type: Number }, // cents

  adjustments: [
    {
      type: { type: String, required: true },
      amount: { type: Number, required: true },
      note: { type: String, default: '' }
    }
  ],

  lineItems: [
    {
      transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
      bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
      courseId: { type: Schema.Types.ObjectId, ref: 'Course', default: null },
      amount: { type: Number, default: 0 },
      platformFee: { type: Number, default: 0 },
      netAmount: { type: Number, default: 0 },
      transactionDate: { type: Date, default: null },
      reference: { type: String, default: '' }
    }
  ],

  paidAt: { type: Date, default: null },
  paidBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  paymentRef: { type: String, default: null },

  stripeTransferId: { type: String, index: true },

  // include both legacy and manual statuses
  status: {
    type: String,
    enum: ['PENDING', 'SENT', 'FAILED', 'SETTLED', 'DRAFT', 'APPROVED', 'PAID', 'CANCELLED'],
    default: 'PENDING'
  },

  metadata: { type: Schema.Types.Mixed, default: {} },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// keep updatedAt maintained
PayoutSchema.pre('save', function (next) {
  (this as any).updatedAt = new Date();
  next();
});

PayoutSchema.index({ payoutKind: 1, status: 1, createdAt: -1 });
PayoutSchema.index({ payoutKind: 1, payeeType: 1, payeeId: 1, createdAt: -1 });
// Uniqueness on manual payee+period prevents duplicate payout records for the same window.
PayoutSchema.index(
  { payoutKind: 1, payeeType: 1, payeeId: 1, periodStart: 1, periodEnd: 1 },
  {
    unique: true,
    partialFilterExpression: {
      payoutKind: 'MANUAL',
      payeeType: { $exists: true },
      payeeId: { $exists: true },
      periodStart: { $exists: true },
      periodEnd: { $exists: true }
    }
  }
);

export default mongoose.model<IPayout>('Payout', PayoutSchema);
