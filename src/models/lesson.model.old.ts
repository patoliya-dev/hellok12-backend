// models/Lesson.ts
import { Schema, model, Document, Types } from 'mongoose';

export interface IWeeklySchedule {
  day: string; // e.g., "Monday"
  startTime: string; // e.g., "10:00"
  endTime: string; // e.g., "11:00"
}

export interface ILesson extends Document {
  course: Types.ObjectId;
  title: string;
  assignedTeacher: Types.ObjectId;
  description?: string;
  weeklySchedule: IWeeklySchedule[];
  isTrialAvailable: boolean;
  trialCapacity?: number;
  isCurriculumAlignedGame: boolean;
  vocabulary: Types.ObjectId[];
}

const LessonSchema = new Schema<ILesson>(
  {
    course: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    title: { type: String, required: true },
    assignedTeacher: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    description: { type: String },
    weeklySchedule: [
      {
        day: { type: String, required: true },
        startTime: { type: String, required: true },
        endTime: { type: String, required: true }
      }
    ],
    isTrialAvailable: { type: Boolean, default: false },
    trialCapacity: { type: Number },
    isCurriculumAlignedGame: { type: Boolean, default: false },
    vocabulary: [{ type: Schema.Types.ObjectId, ref: 'Vocabulary' }]
  },
  { timestamps: true }
);

export const Lesson = model<ILesson>('Lesson', LessonSchema);
