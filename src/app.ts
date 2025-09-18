import express from 'express';
import cors, { CorsOptions } from 'cors';
import path from 'path';
import helmet from 'helmet';
import dotenv from 'dotenv';
import morgan from 'morgan';
import routes from './routes/index';
import { errorHandler } from './middlewares/error.middleware';

dotenv.config();

const app = express();

const allowedOrigins = [
  'http://localhost:5173',
  process.env.CLIENT_URL || 'https://dev-app.hellok12.com'
];

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
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());
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

export default app;
