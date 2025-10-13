import mongoose, { Schema, InferSchemaType } from 'mongoose';

const StudentProfileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    address: { type: String, default: '' },
    age: { type: String, default: '' },
    gender: { type: String, enum: ['male', 'female', 'other'], default: 'other' },
    languages: { type: [String], default: [] } // simple array of language names or codes
  },
  { timestamps: true }
);

export type StudentProfileDoc = InferSchemaType<typeof StudentProfileSchema> & { _id: string };
export const StudentProfileModel = mongoose.model('StudentProfile', StudentProfileSchema);
