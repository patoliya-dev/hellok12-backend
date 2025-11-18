import { Server, Socket } from 'socket.io';
import { SOCKET_EVENTS } from '../../constants/socket.constants';
import Logger from '../../utils/winstonLogger.utils';

/**
 * USER ROOM MANAGEMENT
 * Each user joins their own personal room using their userId
 * This allows sending notifications even when not in specific thread rooms
 */

// Store userId to socketId mapping
const userSocketMap = new Map<string, string>();

export const userConnectionHelper = (socket: Socket, io: Server) => {
  /**
   * User connects and joins their personal room
   * This happens on socket connection
   */
  socket.on(SOCKET_EVENTS.USER.CONNECT, (data: { userId: string }) => {
    try {
      const { userId } = data;

      if (!userId) {
        Logger.error('User connect - No userId provided');
        return;
      }

      // Store userId -> socketId mapping
      userSocketMap.set(userId, socket.id);

      // Join user's personal room (user:userId)
      socket.join(`user:${userId}`);

      // Emit connection success
      socket.emit(SOCKET_EVENTS.USER.CONNECTED, {
        userId,
        socketId: socket.id,
        timestamp: new Date()
      });
    } catch (error: any) {
      Logger.error('Error in user connect:', error);
    }
  });

  /**
   * Handle disconnect - cleanup user rooms
   */
  socket.on('disconnect', () => {
    // Find and remove user from map
    for (const [userId, socketId] of userSocketMap.entries()) {
      if (socketId === socket.id) {
        userSocketMap.delete(userId);
        break;
      }
    }
  });
};

/**
 * Get socket ID for a user
 */
export const getUserSocketId = (userId: string): string | undefined => {
  return userSocketMap.get(userId);
};

/**
 * Check if user is online
 */
export const isUserOnline = (userId: string): boolean => {
  return userSocketMap.has(userId);
};
