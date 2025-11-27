import mongoose, { Schema } from 'mongoose';

const PayoutSchema = new Schema({
  transaction: { type: Schema.Types.ObjectId, ref: 'Transaction', index: true },
  invoice: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  toUser: { type: Schema.Types.ObjectId, ref: 'User' }, // teacher or school
  toAccountId: { type: String }, // stripe connected account id
  amount: { type: Number }, // cents
  currency: { type: String, default: 'usd' },
  platformFee: { type: Number }, // cents
  netAmount: { type: Number }, // cents
  stripeTransferId: { type: String, index: true },
  status: { type: String, enum: ['PENDING', 'SENT', 'FAILED'], default: 'PENDING' },
  metadata: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

export default mongoose.model('Payout', PayoutSchema);
