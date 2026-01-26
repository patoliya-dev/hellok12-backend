import { Schema, model, Types, Document } from 'mongoose';
import { AGE_GROUPS, CourseMode, LessonType } from '../utils/constants';
import { Address } from '../modules/courses/course.schemas';

const AddressSchema = new Schema(
  {
    line1: { type: String, trim: true },
    line2: { type: String, trim: true },
    area: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    country: { type: String, trim: true }
  },
  { _id: false }
);

export interface CourseDoc extends Document {
  title: string;
  description?: string;
  languageCode?: string; // e.g. "ja" - ISO stored for UI
  lessonType: LessonType;
  studentCapacity: number;
  mode: CourseMode;
  price: number;
  currency: string; // e.g. "USD"
  ageGroups: string[]; // ["6-8","9-12"] etc.
  startDate: Date;
  endDate?: Date | null;
  introImageRef?: Types.ObjectId | null;

  // ownership
  ownerType: 'school' | 'teacher';
  ownerId: Types.ObjectId;

  // inside Course schema definition add:
  address?: Address | null;

  // status flags
  status: 'draft' | 'active' | 'archived';
  isTrialAvailable: boolean;

  // simple denormalized counters for UI
  enrolledCount?: number;
  teachers?: Types.ObjectId[];
  // timestamps
  createdAt: Date;
  updatedAt: Date;
}

const CourseSchema = new Schema<CourseDoc>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    languageCode: { type: String, index: true, default: null },
    lessonType: { type: String, enum: ['1-on-1', 'group'], required: true },
    studentCapacity: { type: Number, min: 1, default: 1 },
    mode: { type: String, enum: ['online', 'in-person'], required: true },
    price: { type: Number, min: 0, index: true, required: true },
    currency: { type: String, default: 'USD' },
    ageGroups: { type: [String], enum: AGE_GROUPS, required: true, default: [] },

    startDate: { type: Date, index: true, required: true },
    endDate: { type: Date },

    introImageRef: { type: Schema.Types.ObjectId, ref: 'Attachment', default: null },

    ownerType: { type: String, enum: ['school', 'teacher'], required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },

    address: { type: AddressSchema, default: null },

    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft', index: true },
    isTrialAvailable: { type: Boolean, default: false, index: true },

    enrolledCount: { type: Number, default: 0 },
    teachers: [{ type: Schema.Types.ObjectId, ref: 'User' }]
  },
  { timestamps: true }
);

// useful indexes for list filters & sorts
CourseSchema.index({ title: 1 });
CourseSchema.index({ teacherId: 1 });
CourseSchema.index({ createdAt: -1 });
CourseSchema.index({ status: 1, teachers: 1 });
CourseSchema.index({ startDate: 1, endDate: 1 });
CourseSchema.index({ ownerId: 1, ownerType: 1, status: 1 });
CourseSchema.index({ ownerType: 1, ownerId: 1, status: 1, createdAt: -1 });

export const Course = model<CourseDoc>('Course', CourseSchema);
