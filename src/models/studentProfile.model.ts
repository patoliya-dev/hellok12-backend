import mongoose, { Schema, InferSchemaType } from 'mongoose';

const StudentProfileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    address: { type: String, default: '' },
    age: { type: Number, default: null, min: 0, max: 120 },
    gender: { type: String, enum: ['male', 'female', 'other'], default: 'other' },
    languages: { type: [String], default: [] } // simple array of language names or codes
  },
  { timestamps: true }
);

StudentProfileSchema.index({ age: 1 });
StudentProfileSchema.index({ user: 1 }, { unique: true });

export type StudentProfileDoc = InferSchemaType<typeof StudentProfileSchema> & { _id: string };
export const StudentProfileModel = mongoose.model('StudentProfile', StudentProfileSchema);
