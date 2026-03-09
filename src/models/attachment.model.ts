import mongoose, { Schema, InferSchemaType } from 'mongoose';

const AttachmentSchema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: '' },
    size: { type: Number, required: true },
    mime: { type: String, required: true },
    bucket: { type: String, required: true },
    key: { type: String, required: true },
    url: { type: String, required: true },
    etag: { type: String, required: true },
    storageType: { type: String, enum: ['S3'], default: 'S3' },
    isPublic: { type: Boolean, default: true },
    uploadedBy: { type: String, required: true },
    entityType: { type: String, default: null },
    entityId: { type: Schema.Types.ObjectId, default: null, refPath: 'entityType' },
    status: { type: String, enum: ['UPLOADING', 'READY', 'DELETED'], default: 'UPLOADING' },
    width: { type: Number, default: null },
    height: { type: Number, default: null }
  },
  { timestamps: true }
);

AttachmentSchema.index({ entityType: 1, entityId: 1 });
AttachmentSchema.index({ entityType: 1, status: 1, entityId: 1, createdAt: -1 });

export type AttachmentDoc = InferSchemaType<typeof AttachmentSchema> & { _id: string };
export const AttachmentModel = mongoose.model('Attachment', AttachmentSchema);
