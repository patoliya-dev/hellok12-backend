import mongoose, { Schema } from 'mongoose';

const InvoiceSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User' },
  stripeInvoiceId: { type: String },
  amountDue: { type: Number },
  amountPaid: { type: Number },
  currency: { type: String },
  status: { type: String },
  pdfUrl: { type: String },
  metadata: { type: Object },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

export default mongoose.model('Invoice', InvoiceSchema);
