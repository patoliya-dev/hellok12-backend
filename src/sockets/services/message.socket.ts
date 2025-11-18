import { Server, Socket } from 'socket.io';
import messageThreadModel from '../../models/messageThread.model';
import messageModel from '../../models/message.model';
import { sendMessagePayload } from '../../types/SocketTypes';
import Logger from '../../utils/winstonLogger.utils';

export const messageService = {
  /**
   * Opens a thread - user joins room and gets messages
   */
  openThread: async (socket: Socket, io: Server, threadId: string, senderId: string) => {
    try {
      // Join the socket room
      socket.join(threadId);

      // Fetch last 30 messages
      const messages = await messageModel
        .find({ thread: threadId })
        .sort({ sentAt: -1 })
        .limit(30)
        .populate({
          path: 'sender',
          select: 'name role',
          populate: { path: 'profileImage', select: 'url' }
        })
        .populate({
          path: 'readBy',
          select: 'name'
        })
        .populate({
          path: 'attachments',
          select: 'url name mime'
        });

      // Send messages to the user who opened the thread
      socket.emit('thread-messages', messages.reverse());

      // Mark all unread messages as read for this user
      const unreadMessages = await messageModel.find({
        thread: threadId,
        readBy: { $ne: senderId },
        sender: { $ne: senderId } // Don't mark own messages
      });

      if (unreadMessages.length > 0) {
        await messageModel.updateMany(
          {
            thread: threadId,
            readBy: { $ne: senderId },
            sender: { $ne: senderId }
          },
          { $addToSet: { readBy: senderId } }
        );
      }

      // Reset unread count for this user in the thread
      await messageThreadModel.findByIdAndUpdate(threadId, {
        [`unreadCount.${senderId}`]: 0
      });

      // Notify other users in the room that messages were read
      socket.to(threadId).emit('messagesRead', {
        threadId,
        userId: senderId,
        timestamp: new Date()
      });

      return {
        threadId,
        senderId,
        messages: messages || []
      };
    } catch (error) {
      Logger.error('[THREAD_OPEN] Error:', error);
      throw error;
    }
  },

  /**
   * Sends a message and broadcasts to all participants
   */
  sendMessage: async (socket: Socket, io: Server, message: sendMessagePayload) => {
    try {
      // Find the thread with participants
      const thread: any = await messageThreadModel
        .findOne({ _id: message.thread })
        .populate('participants', '_id name')
        .lean();

      if (!thread) {
        throw new Error('Thread not found');
      }

      console.log(message.attachments);
      // Create the message in database
      const messageToSend = await messageModel.create({
        thread: message.thread,
        sender: message.sender,
        body: message.body,
        sentAt: message.sentAt,
        readBy: [message.sender], // Sender has already read it
        type: message.type || 'text',
        status: 'sent',
        attachments: message.attachments || []
      });

      // Populate sender information
      await messageToSend.populate({
        path: 'sender',
        select: 'name role',
        populate: { path: 'profileImage', select: 'url' }
      });

      // Update thread's lastMessage and timestamps
      const updateObj: any = {
        lastMessage: messageToSend._id,
        updatedAt: new Date()
      };

      // Increment unread count for all participants except sender
      thread.participants.forEach((participant: any) => {
        const participantId = participant._id.toString();
        if (participantId !== message.sender.toString()) {
          const currentCount =
            thread.unreadCount?.get?.(participantId) || thread.unreadCount?.[participantId] || 0;
          updateObj[`unreadCount.${participantId}`] = currentCount + 1;
        }
      });

      await messageThreadModel.findByIdAndUpdate(message.thread, updateObj);

      return messageToSend;
    } catch (error) {
      Logger.error('[SEND_MESSAGE] Error:', error);
      throw error;
    }
  },

  /**
   * Marks messages as read for a specific user
   */
  markAsRead: async (socket: Socket, io: Server, threadId: string, userId: string) => {
    try {
      // Find unread messages (excluding user's own messages)
      const unreadMessages = await messageModel.find({
        thread: threadId,
        readBy: { $ne: userId },
        sender: { $ne: userId }
      });

      if (unreadMessages.length === 0) {
        return {
          success: true,
          messagesMarked: 0
        };
      }

      // Mark all unread messages as read
      const updateResult = await messageModel.updateMany(
        {
          thread: threadId,
          readBy: { $ne: userId },
          sender: { $ne: userId }
        },
        { $addToSet: { readBy: userId } }
      );

      // Reset unread count in thread
      await messageThreadModel.findByIdAndUpdate(threadId, {
        [`unreadCount.${userId}`]: 0
      });

      // Notify other participants in the room
      socket.to(threadId).emit('messagesRead', {
        threadId,
        userId,
        timestamp: new Date()
      });

      // Also emit to user's personal room (for other devices)
      io.to(`user:${userId}`).emit('messagesRead', {
        threadId,
        userId,
        timestamp: new Date()
      });

      return {
        success: true,
        messagesMarked: updateResult.modifiedCount
      };
    } catch (error) {
      Logger.error('[MARK_AS_READ] Error:', error);
      throw error;
    }
  },

  /**
   * Broadcasts typing status
   */
  broadcastTyping: (
    socket: Socket,
    threadId: string,
    userId: string,
    isTyping: boolean,
    userName: string
  ) => {
    socket.to(threadId).emit('userTyping', {
      threadId,
      userId,
      userName,
      isTyping,
      timestamp: new Date()
    });
  }
};
