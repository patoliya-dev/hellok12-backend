import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ITransaction extends Document {
  payer?: Types.ObjectId | string | null;
  payee?: Types.ObjectId | string | null;
  school?: Types.ObjectId | string | null;
  payeeType?: 'teacher' | 'school';
  booking?: Types.ObjectId | string | null;
  amount?: number; // cents
  amountDisplay?: string; // human friendly e.g. "$65.00"
  currency?: string;
  status?: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
  failureReason?: string;
  stripePaymentIntentId?: string;
  stripeChargeId?: string;
  stripeTransferId?: string;
  stripeCustomerId?: string;
  stripeInvoiceId?: string;
  platformFee?: number; // cents
  netAmount?: number; // cents (amount - platformFee - stripe fees if you want)
  paymentMethodBrand?: string;
  paymentMethodLast4?: string;
  reference?: string; // friendly reference code
  title?: string; // e.g. "Course Purchase: Algebra 1"
  metadata?: any;
  downloadUrl?: string; // receipt or pdf url
  // Canonical purchase-settlement timestamp used by earnings aggregations.
  paidAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const TransactionSchema = new Schema<ITransaction>({
  payer: { type: Schema.Types.ObjectId, ref: 'User' },
  payee: { type: Schema.Types.ObjectId, ref: 'User' }, // teacher or school
  school: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  payeeType: { type: String, enum: ['teacher', 'school'], index: true },
  booking: { type: Schema.Types.ObjectId, ref: 'Booking' },
  amount: { type: Number }, // cents
  amountDisplay: { type: String },
  currency: { type: String, default: 'usd' },
  status: {
    type: String,
    enum: ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED'],
    default: 'PENDING'
  },
  failureReason: { type: String },
  stripePaymentIntentId: { type: String, index: true },
  stripeChargeId: { type: String },
  stripeTransferId: { type: String },
  stripeCustomerId: { type: String },
  stripeInvoiceId: { type: String, index: true },
  platformFee: { type: Number }, // cents
  netAmount: { type: Number },
  paymentMethodBrand: { type: String },
  paymentMethodLast4: { type: String },
  reference: { type: String },
  title: { type: String },
  metadata: { type: Object },
  downloadUrl: { type: String },
  paidAt: { type: Date, default: null, index: true },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
});

TransactionSchema.index({ payee: 1, status: 1, createdAt: -1 });
TransactionSchema.index({ booking: 1, status: 1 });
TransactionSchema.index({ school: 1, status: 1, createdAt: -1 });
// paidAt indexes keep earnings summary/graph queries fast when bucketing by settlement date.
TransactionSchema.index({ payee: 1, payeeType: 1, status: 1, paidAt: -1 });
TransactionSchema.index({ school: 1, status: 1, paidAt: -1 });

export default mongoose.model<ITransaction>('Transaction', TransactionSchema);
