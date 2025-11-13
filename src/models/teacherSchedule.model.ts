import mongoose, { Schema, InferSchemaType } from 'mongoose';

const WeeklySchema = new Schema(
  {
    0: { type: [Number], default: undefined }, // Sunday
    1: { type: [Number], default: undefined }, // Monday
    2: { type: [Number], default: undefined },
    3: { type: [Number], default: undefined },
    4: { type: [Number], default: undefined },
    5: { type: [Number], default: undefined },
    6: { type: [Number], default: undefined }
  },
  { _id: false }
);

const TeacherScheduleSchema = new Schema(
  {
    teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    slotMinutes: { type: Number, default: 60 }, // 15..240 recommended
    // legacy weekly baseline (kept for backward compatibility)
    weekly: { type: WeeklySchema, default: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } }, // minutes from 00:00, aligned to slotMinutes
    // monthly: a map keyed by "YYYY-MM" -> object { 0: Number[], 1: Number[], ... }
    monthly: { type: Map, of: WeeklySchema, default: {} },
    overrides: { type: Map, of: [Number], default: {} } // date -> minutes[]
  },
  { timestamps: true }
);

TeacherScheduleSchema.index({ teacherId: 1 }, { unique: true });

export type TeacherScheduleDoc = InferSchemaType<typeof TeacherScheduleSchema> & { _id: string };
export const TeacherSchedule = mongoose.model('TeacherSchedule', TeacherScheduleSchema);
