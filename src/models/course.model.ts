import { Schema, model, Types, Document } from 'mongoose';
import { AGE_GROUPS, CourseMode, LessonType } from '../utils/constants';

export interface CourseDoc extends Document {
  title: string;
  description?: string;
  language: string; // e.g. "en", "es"
  lessonType: LessonType;
  studentCapacity: number;
  mode: CourseMode;
  pricePerLesson: number;
  currency: string; // e.g. "USD"
  ageGroups: string[]; // ["6-8","9-12"] etc.
  startDate: Date;
  endDate?: Date | null;
  introImage?: { attachmentId: string; url: string } | null;

  // ownership
  ownerType: 'school' | 'teacher';
  ownerId: Types.ObjectId;

  // status flags
  status: 'draft' | 'active' | 'archived';
  isTrialAvailable: boolean;

  // simple denormalized counters for UI
  enrolledCount?: number;

  // timestamps
  createdAt: Date;
  updatedAt: Date;
}

const CourseSchema = new Schema<CourseDoc>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    language: { type: String, required: true, index: true },
    lessonType: { type: String, enum: ['one-on-one', 'group'], required: true },
    studentCapacity: { type: Number, min: 1, default: 1 },
    mode: { type: String, enum: ['online', 'in-person'], required: true },
    pricePerLesson: { type: Number, min: 0, index: true, required: true },
    currency: { type: String, default: 'USD' },
    ageGroups: { type: [String], enum: AGE_GROUPS, required: true, default: [] },

    startDate: { type: Date, index: true, required: true },
    endDate: { type: Date },

    introImage: {
      attachmentId: { type: String },
      url: { type: String }
    },

    ownerType: { type: String, enum: ['school', 'teacher'], required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },

    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft', index: true },
    isTrialAvailable: { type: Boolean, default: false, index: true },

    enrolledCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

// useful indexes for list filters & sorts
CourseSchema.index({ createdAt: -1 });
CourseSchema.index({ title: 1 });
CourseSchema.index({ startDate: 1, endDate: 1 });

export const Course = model<CourseDoc>('Course', CourseSchema);
