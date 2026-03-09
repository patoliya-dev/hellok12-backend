import mongoose, { InferSchemaType, Schema } from 'mongoose';

const PayoutAccountSchema = new Schema(
  {
    ownerType: {
      type: String,
      enum: ['TEACHER', 'SCHOOL'],
      required: true,
      index: true
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    country: {
      type: String,
      default: process.env.DEFAULT_COUNTRY || 'IN',
      uppercase: true,
      trim: true
    },
    currency: {
      type: String,
      default: process.env.DEFAULT_CURRENCY || 'usd',
      uppercase: true,
      trim: true
    },
    holderName: { type: String, required: true, trim: true },
    bankName: { type: String, required: true, trim: true },
    accountNumberEncrypted: { type: String, required: true, select: false },
    accountNumberLast4: { type: String, default: '' },
    ifsc: { type: String, default: '', uppercase: true, trim: true },
    branchName: { type: String, default: '', trim: true },
    accountType: { type: String, enum: ['SAVINGS', 'CURRENT'], default: null },
    upiIdEncrypted: { type: String, default: '', select: false },
    upiIdMasked: { type: String, default: '' },
    isDefault: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ['PENDING', 'VERIFIED', 'REJECTED'],
      default: 'PENDING',
      index: true
    },
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rejectionReason: { type: String, default: '', trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

PayoutAccountSchema.index({ ownerType: 1, ownerId: 1 }, { unique: true });
PayoutAccountSchema.index(
  { ownerType: 1, ownerId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } }
);

export type PayoutAccountDoc = InferSchemaType<typeof PayoutAccountSchema> & { _id: string };
export const PayoutAccountModel = mongoose.model('PayoutAccount', PayoutAccountSchema);
