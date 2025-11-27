// src/models/invoice.model.ts
import mongoose, { Schema } from 'mongoose';

const InvoiceItemSchema = new Schema(
  {
    description: { type: String },
    quantity: { type: Number, default: 1 },
    price: { type: Number }, // cents OR display string if preferred
    priceDisplay: { type: String }
  },
  { _id: false }
);

const InvoiceSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User' }, // the payer user
  stripeInvoiceId: { type: String },
  number: { type: String }, // human friendly invoice number: REF_YYYYMMDD_0001
  customerName: { type: String },
  customerEmail: { type: String },
  items: { type: [InvoiceItemSchema], default: [] },
  amountDue: { type: Number }, // cents
  amountPaid: { type: Number }, // cents
  totalDisplay: { type: String }, // e.g. "$65.00"
  currency: { type: String },
  status: { type: String },
  pdfUrl: { type: String },
  hostedInvoiceUrl: { type: String },
  metadata: { type: Object },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
});

export default mongoose.model('Invoice', InvoiceSchema);
