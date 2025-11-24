import { Schema, model, Types, Document } from 'mongoose';

export enum SessionStatus {
  SCHEDULED = 'SCHEDULED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}

export interface ISession extends Document {
  course: Types.ObjectId;
  lesson: Types.ObjectId;
  teacher: Types.ObjectId;
  students: Types.ObjectId[];

  start: Date;
  end: Date;

  meetingId?: string;
  joinUrl?: string;
  hostUrl?: string;

  tokenMeta?: {
    token?: string;
    expiresAt?: Date;
  };

  status: SessionStatus;

  createdAt: Date;
  updatedAt: Date;
}

const SessionSchema = new Schema<ISession>(
  {
    course: {
      type: Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      index: true
    },

    lesson: {
      type: Schema.Types.ObjectId,
      ref: 'Lesson',
      required: true,
      index: true
    },

    teacher: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    students: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User'
      }
    ],

    start: { type: Date, required: true },
    end: { type: Date, required: true },

    meetingId: { type: String },

    joinUrl: {
      type: String
    },

    hostUrl: {
      type: String,
      select: false
    },

    tokenMeta: {
      token: { type: String, select: false },
      expiresAt: { type: Date }
    },

    status: {
      type: String,
      enum: Object.values(SessionStatus),
      default: SessionStatus.SCHEDULED
    }
  },
  {
    timestamps: true
  }
);

SessionSchema.index({ start: 1 });

SessionSchema.index({ teacher: 1, start: 1 });

SessionSchema.index({ course: 1, lesson: 1 });

export const SessionModel = model<ISession>('Session', SessionSchema);
