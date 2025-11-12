import { Schema, model, Types, Document } from 'mongoose';
import { normalizeToHHMM24, parseHHMM } from '../modules/lessons/lesson.util';

export interface LessonDoc extends Document {
  courseId: Types.ObjectId;
  teacherId: Types.ObjectId;
  title: string;
  description?: string;

  // NEW schedule block (Phase-1)
  schedule: {
    date: Date; // date part only (UI date picker)
    time: string; // "10:00 AM" | "14:30 PM"
    duration: number; // minutes
  };

  // status flags
  status: 'draft' | 'active' | 'archived';

  // stored for fast list/filter/sort (derived from schedule)
  startAt: Date; // UTC datetime = schedule.date + schedule.time
  endAt: Date; // startAt + duration (minutes)

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
      time: { type: String, required: true }, // "HH:MM AM/PM"
      duration: { type: Number, required: true, min: 1 }
    },

    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft', index: true },

    startAt: { type: Date, required: true, index: true }, // derived
    endAt: { type: Date, required: true, index: true }, // derived

    isTrialAvailable: { type: Boolean, default: false, index: true },
    trialCapacity: { type: Number, min: 0, default: 0 },
    order: { type: Number, default: 0, index: true }
  },
  { timestamps: true }
);

/** Derive startAt/endAt on create/update */
LessonSchema.pre('validate', function (next) {
  try {
    // combine date + time into a single UTC Date
    const { schedule } = this as LessonDoc;
    if (!schedule?.date || !schedule?.time || !schedule?.duration) return next();

    // normalize time -> "HH:MM" 24h
    const normalized = normalizeToHHMM24(String(schedule.time));
    if (!normalized)
      return next(
        new Error(
          'Invalid schedule.time format. Acceptable examples: "09:30", "09:30 AM", "12:00 PM", "23:15".'
        )
      );

    // parse hh/mm
    const { hours, minutes } = parseHHMM(normalized);
    const d = new Date(schedule.date); // treat schedule.date as local date
    const start = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hours, minutes, 0, 0)
    );
    const end = new Date(start.getTime() + schedule.duration * 60_000);

    (this as any).startAt = start;
    (this as any).endAt = end;

    next();
  } catch (err) {
    next(err as any);
  }
});

// helpful indexes for dashboard + calendar-like lists
LessonSchema.index({ courseId: 1, order: 1 });
LessonSchema.index({ courseId: 1, startAt: 1 });
LessonSchema.index({ isTrialAvailable: 1, startAt: 1 });
LessonSchema.index({ courseId: 1, startAt: -1 });
LessonSchema.index({ courseId: 1, title: 1 });
LessonSchema.index({ courseId: 1, status: 1 });
LessonSchema.index({ teacherId: 1, schedule: 1 });

export const Lesson = model<LessonDoc>('Lesson', LessonSchema);
