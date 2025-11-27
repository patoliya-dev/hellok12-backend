import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPayout extends Document {
  transaction?: Types.ObjectId | string | null;
  invoice?: Types.ObjectId | string | null;
  toUser?: Types.ObjectId | string | null;
  toAccountId?: string | null;
  toType?: 'teacher' | 'school' | 'platform' | 'admin' | string | null;
  amount?: number; // cents
  currency?: string;
  platformFee?: number; // cents
  netAmount?: number; // cents
  stripeTransferId?: string | null;
  status?: 'PENDING' | 'SENT' | 'FAILED' | 'SETTLED';
  metadata?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

const PayoutSchema = new Schema<IPayout>({
  transaction: { type: Schema.Types.ObjectId, ref: 'Transaction', index: true },
  invoice: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  toUser: { type: Schema.Types.ObjectId, ref: 'User' }, // teacher or school
  toAccountId: { type: String }, // stripe connected account id
  toType: { type: String, enum: ['teacher', 'school', 'platform', 'admin'], default: 'teacher' },

  amount: { type: Number }, // cents
  currency: { type: String, default: 'usd' },
  platformFee: { type: Number }, // cents
  netAmount: { type: Number }, // cents

  stripeTransferId: { type: String, index: true },

  // include SETTLED as valid status to support different payout workflows
  status: { type: String, enum: ['PENDING', 'SENT', 'FAILED', 'SETTLED'], default: 'PENDING' },

  metadata: { type: Schema.Types.Mixed, default: {} },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// keep updatedAt maintained
PayoutSchema.pre('save', function (next) {
  (this as any).updatedAt = new Date();
  next();
});

export default mongoose.model<IPayout>('Payout', PayoutSchema);
