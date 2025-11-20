import { Server, Socket } from 'socket.io';
import { SOCKET_EVENTS } from '../../constants/socket.constants';
import {
  sendMessagePayload,
  threadOpenPayload,
  markAsReadPayload,
  typingPayload,
  AddParticipantsPayload,
  LeaveGroupPayload
} from '../../types/SocketTypes';
import Logger from '../../utils/winstonLogger.utils';
import { messageService } from '../services/message.socket';
import messageThreadModel from '../../models/messageThread.model';

export const messageHelper = (socket: Socket, io: Server) => {
  /**
   * Handle thread open event
   */
  socket.on(SOCKET_EVENTS.CHAT.THREAD_OPEN, async (data: threadOpenPayload) => {
    try {
      const result = await messageService.openThread(socket, io, data.threadId, data.senderId);

      if (!result) {
        throw new Error('Failed to open thread');
      }
    } catch (error: any) {
      Logger.error('[THREAD_OPEN] Error:', error);
      socket.emit(SOCKET_EVENTS.ERROR, {
        event: 'threadOpen',
        message: error.message || 'Failed to open thread'
      });
    }
  });

  /**
   * Handle send message event
   * UPDATED: Sends notifications to users not in the room
   */
  socket.on(SOCKET_EVENTS.CHAT.SEND_MESSAGE, async (data: sendMessagePayload) => {
    try {
      const message = await messageService.sendMessage(socket, io, data);
      io.to(data.thread).emit(SOCKET_EVENTS.CHAT.NEW_MESSAGE, message);

      const thread: any = await messageThreadModel
        .findById(data.thread)
        .populate('participants', '_id name availabilityStatus lastSeen')
        .lean();

      if (thread) {
        for (const participant of thread.participants) {
          const participantId = participant._id.toString();

          if (participantId === data.sender.toString()) {
            continue;
          }

          io.to(`user:${participantId}`).emit(SOCKET_EVENTS.CHAT.NEW_MESSAGE_NOTIFICATION, {
            message: message,
            thread: {
              _id: thread._id,
              threadType: thread.threadType,
              groupName: thread.groupName,
              participants: thread.participants
            },
            sender: message.sender,
            timestamp: new Date()
          });
        }
      }
    } catch (error: any) {
      Logger.error('[SEND_MESSAGE] Error:', error);
      socket.emit(SOCKET_EVENTS.ERROR, {
        event: 'sendMessage',
        message: error.message || 'Failed to send message'
      });
    }
  });

  /**
   * Handle mark as read event
   */
  socket.on(SOCKET_EVENTS.CHAT.MARK_AS_READ, async (data: markAsReadPayload) => {
    try {
      await messageService.markAsRead(socket, io, data.threadId, data.userId);
    } catch (error: any) {
      Logger.error('[MARK_AS_READ] Error:', error);
      socket.emit(SOCKET_EVENTS.ERROR, {
        event: 'markAsRead',
        message: error.message || 'Failed to mark as read'
      });
    }
  });

  /**
   * Handle typing indicator
   */
  socket.on(SOCKET_EVENTS.CHAT.TYPING, (data: typingPayload) => {
    try {
      messageService.broadcastTyping(
        socket,
        data.threadId,
        data.userId,
        data.isTyping,
        data.userName
      );
    } catch (error: any) {
      Logger.error('[TYPING] Error:', error);
    }
  });

  /**
   * Handle close thread (user leaves room)
   */
  socket.on(SOCKET_EVENTS.CHAT.CLOSE_THREAD, (data: { threadId: string; userId: string }) => {
    try {
      socket.leave(data.threadId);
    } catch (error: any) {
      Logger.error('[CLOSE_THREAD] Error:', error);
    }
  });

  /**
   * Handle add participants to group
   */
  socket.on(SOCKET_EVENTS.CHAT.ADD_PARTICIPANTS, async (data: AddParticipantsPayload) => {
    try {
      const { threadId, participants, userId } = data;

      // Notify all participants in the thread about new members
      io.to(threadId).emit(SOCKET_EVENTS.CHAT.PARTICIPANTS_ADDED, {
        threadId,
        newParticipants: participants,
        addedBy: userId,
        timestamp: new Date()
      });

      // Notify the new participants to join the thread room
      participants.forEach(participantId => {
        io.to(`user:${participantId}`).emit(SOCKET_EVENTS.CHAT.ADDED_TO_GROUP, {
          threadId,
          addedBy: userId,
          timestamp: new Date()
        });
      });
    } catch (error: any) {
      Logger.error('[ADD_PARTICIPANTS] Error:', error);
      socket.emit(SOCKET_EVENTS.ERROR, {
        event: 'addParticipants',
        message: error.message || 'Failed to add participants'
      });
    }
  });

  /**
   * Handle leave group
   */
  socket.on(SOCKET_EVENTS.CHAT.LEAVE_GROUP, async (data: LeaveGroupPayload) => {
    try {
      const { threadId, userId } = data;

      // Leave the socket room
      socket.leave(threadId);

      // Notify remaining participants
      socket.to(threadId).emit(SOCKET_EVENTS.CHAT.PARTICIPANT_LEFT, {
        threadId,
        userId,
        timestamp: new Date()
      });

      // Notify the user who left (for their other devices/sessions)
      io.to(`user:${userId}`).emit(SOCKET_EVENTS.CHAT.LEFT_GROUP, {
        threadId,
        timestamp: new Date()
      });
    } catch (error: any) {
      Logger.error('[LEAVE_GROUP] Error:', error);
      socket.emit(SOCKET_EVENTS.ERROR, {
        event: 'leaveGroup',
        message: error.message || 'Failed to leave group'
      });
    }
  });
};
