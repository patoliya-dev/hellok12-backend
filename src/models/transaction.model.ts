import mongoose, { Schema } from 'mongoose';

const TransactionSchema = new Schema({
  payer: { type: Schema.Types.ObjectId, ref: 'User' },
  payee: { type: Schema.Types.ObjectId, ref: 'User' }, // teacher
  booking: { type: Schema.Types.ObjectId, ref: 'Booking' },
  amount: { type: Number }, // cents
  currency: { type: String, default: 'usd' },
  status: {
    type: String,
    enum: ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED'],
    default: 'PENDING'
  },
  stripePaymentIntentId: { type: String, index: true },
  stripeChargeId: { type: String },
  stripeTransferId: { type: String },
  stripeCustomerId: { type: String },
  platformFee: { type: Number }, // cents
  netAmount: { type: Number },
  failureReason: { type: String },
  metadata: { type: Object },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

export default mongoose.model('Transaction', TransactionSchema);
