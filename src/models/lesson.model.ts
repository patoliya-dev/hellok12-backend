import mongoose, { Schema, InferSchemaType } from 'mongoose';

const Session = new Schema(
  {
    startTime: { type: Date, required: true }, // e.g., 2025-08-22T10:00:00Z
    durationMinutes: { type: Number, required: true, min: 1, max: 600 }
  },
  { _id: false }
);

const LessonSchema = new Schema(
  {
    courseId: { type: String, required: true },
    title: { type: String, required: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 4000 },
    teacher: { type: Schema.Types.ObjectId, ref: 'TeacherProfile' },
    sessions: { type: [Session], default: [] }, // corresponds to Weekly Schedule date+times   /*********** need to check *************/
    trialAvailable: { type: Boolean, default: false },
    trialCapacity: { type: Number, default: 0, min: 0 },
    orderIndex: { type: Number, default: 1 },
    published: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

LessonSchema.index({ courseId: 1, orderIndex: 1 });

export type LessonDoc = InferSchemaType<typeof LessonSchema> & { _id: string };
export const LessonModel = mongoose.model('Lesson', LessonSchema);
