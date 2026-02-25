import { Server, Socket } from 'socket.io';
import { SOCKET_EVENTS } from '../../constants/socket.constants';
import Logger from '../../utils/winstonLogger.utils';
import { User } from '../../models/user.model';

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
  socket.on(SOCKET_EVENTS.USER.CONNECT, async (data: { userId: string }) => {
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

      await User.findByIdAndUpdate(userId, {
        $set: {
          lastSeen: new Date(),
          availabilityStatus: 'online'
        }
      });
      socket.broadcast.emit('USER_ONLINE', {
        userId,
        timestamp: new Date()
      });
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
  socket.on('disconnect', async () => {
    try {
      let disconnectedUserId: string | null = null;

      // Identify the user whose socket got disconnected
      for (const [userId, socketId] of userSocketMap.entries()) {
        if (socketId === socket.id) {
          disconnectedUserId = userId;
          userSocketMap.delete(userId);
          break;
        }
      }

      if (disconnectedUserId) {
        // Update user as offline in DB
        await User.findByIdAndUpdate(disconnectedUserId, {
          $set: {
            lastSeen: new Date(),
            availabilityStatus: 'offline'
          }
        });

        socket.broadcast.emit('USER_OFFLINE', {
          userId: disconnectedUserId,
          timestamp: new Date()
        });
      }
    } catch (error: any) {
      Logger.error('Error on disconnect:', error);
    }
  });
};
