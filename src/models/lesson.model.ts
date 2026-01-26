import { Schema, model, Types, Document } from 'mongoose';

export interface LessonDoc extends Document {
  courseId: Types.ObjectId;
  teacherId: Types.ObjectId;
  title: string;
  description?: string;

  schedule: {
    date: Date; // local date only
    time: string; // "HH:mm"
    duration: number; // minutes
  };

  status: 'draft' | 'active' | 'archived';

  // These MUST be supplied by LessonService.parseStartEnd (UTC)
  startAt: Date;
  endAt: Date;

  isTrialAvailable: boolean;
  trialCapacity?: number;
  order: number;

  createdAt: Date;
  updatedAt: Date;
}

const LessonSchema = new Schema<LessonDoc>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },

    schedule: {
      date: { type: Date, required: true, index: true },
      time: { type: String, required: true },
      duration: { type: Number, required: true, min: 1 }
    },

    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft', index: true },

    // Will be set by service layer (UTC)
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true, index: true },

    isTrialAvailable: { type: Boolean, default: false, index: true },
    trialCapacity: { type: Number, min: 0, default: 0 },
    order: { type: Number, default: 0, index: true }
  },
  { timestamps: true }
);

LessonSchema.index({ courseId: 1, order: 1 });
LessonSchema.index({ courseId: 1, startAt: 1 });
LessonSchema.index({ isTrialAvailable: 1, startAt: 1 });
LessonSchema.index({ courseId: 1, startAt: -1 });
LessonSchema.index({ courseId: 1, title: 1 });
LessonSchema.index({ courseId: 1, status: 1 });
LessonSchema.index({ teacherId: 1, courseId: 1 });
LessonSchema.index({ teacherId: 1, schedule: 1 });
LessonSchema.index({ teacherId: 1, startAt: 1 });

export const Lesson = model<LessonDoc>('Lesson', LessonSchema);
