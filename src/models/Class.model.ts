import mongoose, { Schema, model } from 'mongoose';
import { IClass } from '../interfaces/IClass';

const classSchema = new Schema<IClass>({
  teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  description: { type: String },
  durationMinutes: { type: Number, required: true },
  type: { type: String, enum: ['GROUP', 'ONE_ON_ONE'], required: true },
  mode: { type: String, enum: ['ONLINE', 'IN_PERSON'], required: true },  // ✅ NEW
  price: { type: Number, required: true },
  schedule: {
    days: [{ type: String }],
    time: { type: String },
    location: { type: String }
  },
  studentLimit: { type: Number },
  enrolledStudentIds: [{ type: Schema.Types.ObjectId, ref: 'Student' }],
  isTrial: { type: Boolean, default: false },
  nextSessionDate: { type: Date },
  language: { type: String, required: true },
  topics: [{ type: String }]
});

export default model<IClass>('Class', classSchema);
