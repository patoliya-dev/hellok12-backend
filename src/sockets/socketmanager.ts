import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import Logger from '../utils/winstonLogger.utils';
import config from '../config/config';
import socketHandler from './helpers';

const allowedOrigins = [
  'http://localhost:5173',
  config.clientURL || 'https://dev-app.hellok12.com'
];

class SocketManager {
  private static instance: SocketManager;
  private io: Server | null = null;

  private constructor() {
    this.io = null;
  }

  public static getInstance(): SocketManager {
    if (!SocketManager.instance) {
      SocketManager.instance = new SocketManager();
    }
    return SocketManager.instance;
  }

  public initialize(server: HttpServer): Server {
    if (this.io) {
      Logger.warning('SocketManager already initialized');
      return this.io;
    }
    this.io = new Server(server, {
      cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        credentials: true
      }
    });

    this.setupConnectionHandler();
    return this.io;
  }

  private setupConnectionHandler(): void {
    if (!this.io) return;

    this.io.on('connection', socket => {
      socketHandler(socket, this.io as Server);
    });
  }
}

export default SocketManager;
