import { Server, Socket } from 'socket.io';
import { messageHelper } from './message.helper';
import { userConnectionHelper } from './user.helper';
import Logger from '../../utils/winstonLogger.utils';

/**
 * Main socket handler that initializes all socket event handlers
 * This is called for each new socket connection
 */
const socketHandler = (socket: Socket, io: Server) => {
  // user connection handlers
  userConnectionHelper(socket, io);

  // message-related socket handlers
  messageHelper(socket, io);

  // Handle errors
  socket.on('error', error => {
    Logger.error(`Socket ${socket.id} error:`, error);
  });
};

export default socketHandler;
