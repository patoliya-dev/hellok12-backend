import mongoose, { Schema } from 'mongoose';

const WebhookEventLogSchema = new Schema({
  eventId: { type: String, unique: true },
  processedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('WebhookEventLog', WebhookEventLogSchema);
