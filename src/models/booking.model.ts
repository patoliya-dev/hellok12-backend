import mongoose, { Schema, Document } from 'mongoose';
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

export interface IBooking extends Document {
  student: mongoose.Types.ObjectId | string;
  course?: mongoose.Types.ObjectId | string;
  bookedBy?: mongoose.Types.ObjectId | string;
  lesson?: mongoose.Types.ObjectId | string;
  location?: string;
  start?: Date;
  end?: Date;
  isTrial?: boolean;
  paymentStatus?: 'NOT_REQUIRED' | 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED';
  paymentFlow?: 'DIRECT_SUPER_ADMIN' | 'TRIAL_FREE' | string;
  transaction?: mongoose.Types.ObjectId | string; // Transaction document
  address?: Address | null;
  sessions?: mongoose.Types.ObjectId[]; // Session references
  meta?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

const BookingSchema = new Schema<IBooking>({
  student: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  course: { type: Schema.Types.ObjectId, ref: 'Course' },
  bookedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  lesson: { type: Schema.Types.ObjectId, ref: 'Lesson' },
  location: { type: String },
  start: { type: Date },
  end: { type: Date },
  isTrial: { type: Boolean, default: false },
  paymentStatus: {
    type: String,
    enum: ['NOT_REQUIRED', 'PENDING', 'PROCESSING', 'PAID', 'FAILED'],
    default: 'PENDING',
    index: true
  },
  paymentFlow: {
    type: String,
    enum: ['DIRECT_SUPER_ADMIN', 'TRIAL_FREE'],
    default: 'DIRECT_SUPER_ADMIN'
  },
  transaction: { type: Schema.Types.ObjectId, ref: 'Transaction' },
  address: { type: AddressSchema, default: null },
  sessions: [{ type: Schema.Types.ObjectId, ref: 'Session' }],
  meta: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
});

// keep updatedAt maintained
BookingSchema.pre('save', function (next) {
  (this as any).updatedAt = new Date();
  next();
});

// booking.model.ts
BookingSchema.index({ student: 1, course: 1, paymentStatus: 1, updatedAt: -1 });

export default mongoose.model<IBooking>('Booking', BookingSchema);
