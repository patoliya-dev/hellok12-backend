import express from 'express';
import cors, { CorsOptions } from 'cors';
import path from 'path';
import helmet from 'helmet';
import dotenv from 'dotenv';
import morgan from 'morgan';
import routes from './routes/index';
import { errorHandler } from './middlewares/error';
import http from 'http';
import SocketManager from './sockets/socketmanager';

dotenv.config();

const allowedOrigins = [
  //'http://localhost:5173',
  // 'http://localhost:3001',
  process.env.CLIENT_URL || 'https://dev-app.hellok12.com'
];
const app = express();
const server = http.createServer(app);

const socketManager = SocketManager.getInstance();
socketManager.initialize(server);

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-timezone']
};

app.use(cors(corsOptions));
app.use(helmet());
app.use(morgan('dev'));
app.use(
  express.json({
    verify: (req: any, res, buf) => {
      // save raw buffer for webhook verification
      req.rawBody = buf;
    }
  })
);
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Root route → serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// API routes
app.use('/api/v1', routes);

app.use(errorHandler);

export default server;
