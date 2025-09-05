import { Schema, model, Types, Document } from 'mongoose';

export interface IPasswordResetToken extends Document {
  user: Types.ObjectId;
  code: string; // 6-digit code or secure token
  expiresAt: Date;
  createdAt: Date;
}

const PasswordResetTokenSchema = new Schema<IPasswordResetToken>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    code: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export const PasswordResetToken = model<IPasswordResetToken>('PasswordResetToken', PasswordResetTokenSchema);
