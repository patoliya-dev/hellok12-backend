import mongoose, { Schema, Document, Types } from 'mongoose';
import { USER_ROLES } from '../utils/constants';

export type RecipientRole = 'teacher' | 'student' | 'parent' | 'school';
export type InviterRole = 'super_admin' | 'school';
export type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled';

export interface InvitationDoc extends Document {
  invitedBy: Types.ObjectId;
  organization?: Types.ObjectId | null; // store School userId for now
  recipientEmail: string;
  recipientRole: RecipientRole;
  inviterRole: InviterRole;
  invitationMessage?: string;
  inviteToken: string; // HASH
  status: InvitationStatus;
  meta?: Record<string, any>;
  expiresAt: Date;
  acceptedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const InvitationSchema = new Schema<InvitationDoc>(
  {
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    organization: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true }, // School userId

    recipientEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    recipientRole: {
      type: String,
      enum: [USER_ROLES.SCHOOL, USER_ROLES.TEACHER, USER_ROLES.STUDENT, USER_ROLES.PARENT],
      required: true
    },
    inviterRole: {
      type: String,
      enum: [USER_ROLES.SUPER_ADMIN, USER_ROLES.SCHOOL],
      required: true
    },

    invitationMessage: { type: String, default: '' },
    inviteToken: { type: String, required: true, unique: true, index: true }, // sha256 hash

    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'expired', 'cancelled'],
      default: 'pending',
      index: true
    },

    meta: { type: Schema.Types.Mixed, default: {} },
    expiresAt: { type: Date, required: true, index: true },
    acceptedAt: { type: Date }
  },
  { timestamps: true }
);

InvitationSchema.index({ organization: 1, recipientEmail: 1, recipientRole: 1, status: 1 });

export const Invitation = mongoose.model<InvitationDoc>('Invitation', InvitationSchema);
