import { Schema, model, Types, Document } from 'mongoose';
import { USER_ROLES } from '../utils/constants';

export const NOTIFICATION_TYPES = [
  'INVITATION_CREATED',
  'INVITATION_ACCEPTED',
  'INVITATION_REJECTED',
  'COURSE_UPDATED',
  'COURSE_PURCHASED',
  'BOOKING_CONFIRMED',
  'PAYMENT_STATUS_UPDATED',
  'LESSON_SCHEDULED',
  'LESSON_UPDATED',
  'LESSON_CANCELLED',
  'TEACHER_ASSIGNED',
  'TEACHER_REMOVED',
  'ADMIN_ACTION',
  'SCHOOL_CUSTOM_MESSAGE'
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface INotification extends Document {
  recipientUserId?: Types.ObjectId | null;
  audienceRoles?: string[];
  audienceSchoolId?: Types.ObjectId | null;
  title: string;
  message: string;
  type: NotificationType;
  metadata?: Record<string, any>;
  isRead: boolean;
  readAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    recipientUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    audienceRoles: {
      type: [
        {
          type: String,
          enum: Object.values(USER_ROLES)
        }
      ],
      default: []
    },
    audienceSchoolId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    message: { type: String, required: true, trim: true, maxlength: 1200 },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
      index: true
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null }
  },
  {
    timestamps: true
  }
);

// Query-path indexes (high-traffic list and unread count endpoints)
NotificationSchema.index({ recipientUserId: 1, createdAt: -1 });
NotificationSchema.index({ recipientUserId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ audienceRoles: 1, audienceSchoolId: 1, createdAt: -1 });

export const Notification = model<INotification>('Notification', NotificationSchema);
