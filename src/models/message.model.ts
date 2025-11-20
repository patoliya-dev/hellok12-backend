// models/Message.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

const MessageSchema = new Schema(
  {
    thread: {
      type: Schema.Types.ObjectId,
      ref: 'MessageThread',
      required: true,
      index: true
    },

    sender: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },

    body: {
      type: String,
      trim: true
    },

    attachments: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Attachment'
      }
    ],

    readBy: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
        index: true
      }
    ],

    sentAt: {
      type: Date,
      default: Date.now,
      index: true
    },

    type: {
      type: String,
      enum: ['text', 'image', 'video', 'audio', 'file'],
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'read'],
      default: 'pending'
    }
  },
  {
    timestamps: true
  }
);

MessageSchema.index({ thread: 1, sentAt: 1 });

MessageSchema.index({ thread: 1, readBy: 1 });

MessageSchema.index({ sender: 1 });

MessageSchema.index({ attachments: 1 });

export default mongoose.models.Message || mongoose.model('Message', MessageSchema);
