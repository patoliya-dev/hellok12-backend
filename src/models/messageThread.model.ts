// models/MessageThread.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

const MessageThreadSchema = new Schema(
  {
    participants: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
      }
    ],
    formerParticipants: [
      {
        userId: {
          type: Schema.Types.ObjectId,
          ref: 'User',
          required: true
        },
        leftAt: {
          type: Date,
          required: true,
          default: Date.now
        }
      }
    ],

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    threadType: {
      type: String,
      enum: ['DIRECT', 'GROUP'],
      required: true,
      index: true
    },

    groupName: {
      type: String,
      required: function (this: any) {
        return this.threadType === 'GROUP';
      },
      trim: true
    },

    lastMessage: {
      type: Schema.Types.ObjectId,
      ref: 'Message'
    },
    unreadCount: {
      type: Map,
      of: Number,
      default: {}
    }
  },
  {
    timestamps: true // Auto-manage createdAt, updatedAt
  }
);

MessageThreadSchema.index({ participants: 1, threadType: 1 }, { unique: false });

MessageThreadSchema.index({ participants: 1 });

MessageThreadSchema.index({ updatedAt: -1 });

MessageThreadSchema.index({ groupName: 1 });

MessageThreadSchema.index({ lastMessage: 1 });

MessageThreadSchema.index({ 'formerParticipants.userId': 1 });

export default mongoose.models.MessageThread ||
  mongoose.model('MessageThread', MessageThreadSchema);
