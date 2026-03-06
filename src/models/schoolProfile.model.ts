import mongoose, { Schema, InferSchemaType } from 'mongoose';

const SchoolProfileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },

    // UI-required
    schoolName: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    website: { type: String, default: '', trim: true },

    // Support multiple addresses (UI has dynamic list)
    addresses: { type: [String], default: [] },

    // Backward compatibility (if old code uses address1/address2)
    address1: { type: String, default: '', trim: true },
    address2: { type: String, default: '', trim: true },

    // Optional / existing
    teachersDisplayLink: { type: String, default: '', trim: true }
  },
  { timestamps: true }
);

SchoolProfileSchema.index({ user: 1 }, { unique: true });

export type SchoolProfileDoc = InferSchemaType<typeof SchoolProfileSchema> & { _id: string };
export const SchoolProfileModel = mongoose.model('SchoolProfile', SchoolProfileSchema);
