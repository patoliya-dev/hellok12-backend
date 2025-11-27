import mongoose, { Schema } from 'mongoose';

const PaymentMethodSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  stripePaymentMethodId: { type: String, required: true },
  brand: { type: String },
  last4: { type: String },
  exp_month: { type: Number },
  exp_year: { type: Number },
  isDefault: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('PaymentMethod', PaymentMethodSchema);
