// models/Course.ts
import { Schema, model, Document, Types } from 'mongoose';

export interface ICourse extends Document {
  name: string;
  language: string;
  description?: string;
  lessonType: 'online' | 'in-person';
  introImage?: string;
  options?: string[];
  studentCapacity?: number; // Only for group lessons
  pricePerLesson: number;
  ageRange?: { min: number; max: number };
  startDate: Date;
  endDate: Date;
  lessons: Types.ObjectId[];
}

const CourseSchema = new Schema<ICourse>(
  {
    name: { type: String, required: true },
    language: { type: String, required: true },
    description: { type: String },
    lessonType: { type: String, enum: ['online', 'in-person'], required: true },
    introImage: { type: String },
    options: [{ type: String }],
    studentCapacity: { type: Number },
    pricePerLesson: { type: Number, required: true },
    ageRange: {
      min: { type: Number },
      max: { type: Number }
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    lessons: [{ type: Schema.Types.ObjectId, ref: 'Lesson' }]
  },
  { timestamps: true }
);

export const Course = model<ICourse>('Course', CourseSchema);
