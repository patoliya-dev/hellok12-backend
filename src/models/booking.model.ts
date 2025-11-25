import mongoose, { Schema, Document } from 'mongoose';

export interface IBooking extends Document {
  student: mongoose.Types.ObjectId | string;
  // teacher: mongoose.Types.ObjectId | string;
  course?: mongoose.Types.ObjectId | string;
  bookedBy?: mongoose.Types.ObjectId | string;
  location?: string;
  start?: Date;
  end?: Date;
  isTrial?: boolean;
  paymentStatus?: 'NOT_REQUIRED' | 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED';
  paymentFlow?: 'DIRECT_SUPER_ADMIN' | 'TRIAL_FREE' | string;
  transaction?: mongoose.Types.ObjectId | string; // Transaction document
  sessions?: mongoose.Types.ObjectId[]; // Session references
  meta?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}
const BookingSchema = new Schema<IBooking>({
  student: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // teacher: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  course: { type: Schema.Types.ObjectId, ref: 'Course' },
  bookedBy: { type: Schema.Types.ObjectId, ref: 'User' },
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
export default mongoose.model<IBooking>('Booking', BookingSchema);
