// src/models/course.model.ts
import mongoose, { Schema, InferSchemaType } from 'mongoose';

const CourseSchema = new Schema(
  {
    // ownership for RBAC
    ownerId: { type: String, required: true },

    // UI fields
    title: { type: String, required: true, maxlength: 120 },
    language: { type: String, required: true, maxlength: 10 },
    description: { type: String, default: '', maxlength: 4000 },
    lessonType: { type: String, enum: ['group', 'one-on-one'], required: true },
    studentCapacity: { type: Number, required: true, min: 1, max: 100000 },
    mode: { type: String, enum: ['online', 'in-person'], required: true },

    // age groups aligned to your constants
    ageGroups: {
      type: [String],
      enum: ['3-5', '6-8', '9-12', '13-15', '16-18', '18+'],
      required: true
    },

    // intro image bound to Attachment
    introImage: {
      attachmentId: { type: String },
      url: { type: String }
    },

    pricePerLesson: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'USD', maxlength: 3 },

    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },

    // operational
    published: { type: Boolean, default: false },
    enrolledCount: { type: Number, default: 0 },
    archivedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

CourseSchema.index({ ownerType: 1, ownerId: 1, title: 1 });
export type CourseDoc = InferSchemaType<typeof CourseSchema> & { _id: string };
export const CourseModel = mongoose.model('Course', CourseSchema);
