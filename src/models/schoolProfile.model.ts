import mongoose, { Schema, InferSchemaType } from 'mongoose';

const SchoolProfileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    schoolName: { type: String, required: true },
    teachersDisplayLink: { type: String, default: '' },
    address1: { type: String, default: '' },
    address2: { type: String, default: '' }
  },
  { timestamps: true }
);

SchoolProfileSchema.index({ user: 1 }, { unique: true });

export type SchoolProfileDoc = InferSchemaType<typeof SchoolProfileSchema> & { _id: string };
export const SchoolProfileModel = mongoose.model('SchoolProfile', SchoolProfileSchema);
