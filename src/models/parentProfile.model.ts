import mongoose, { Schema, InferSchemaType } from 'mongoose';

const ParentProfileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    address: { type: String, default: '' },
    children: [{ type: Schema.Types.ObjectId, ref: 'User' }] // link to child users
  },
  { timestamps: true }
);

ParentProfileSchema.index({ user: 1 }, { unique: true });

export type ParentProfileDoc = InferSchemaType<typeof ParentProfileSchema> & { _id: string };
export const ParentProfileModel = mongoose.model('ParentProfile', ParentProfileSchema);
