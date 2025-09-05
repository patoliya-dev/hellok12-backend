import dotenv from 'dotenv';
import path from 'path';

// Determine NODE_ENV (default to 'development')
const NODE_ENV = process.env.NODE_ENV || 'development';

// Pick the correct .env file
const envFile = path.resolve(process.cwd(), `.env.${NODE_ENV}`);
dotenv.config({ path: envFile });

console.log('Loaded environment:', NODE_ENV);

interface Config {
  env: string;
  port: number;
  mongoURI: string;
  jwtSecret: string;
  jwtExpiresIn: number | `${number}${"d" | "h" | "m" | "s"}`;
  jwtRefreshSecret: string;
  jwtRefreshExpiresIn: number | `${number}${"d" | "h" | "m" | "s"}`;
  clientURL: string;
  nodeEnv: string;
  emailService: string;
  emailHost: string;
  emailPort: number;
  emailUser: string;
  emailPass: string;
  emailFrom: string;
}

// Type-safe config object
const config: Config = {
  env: NODE_ENV,
  port: Number(process.env.PORT) || 3000,
  mongoURI: process.env.MONGO_URI || 'mongodb://localhost:27017/hello12k',
  jwtSecret: process.env.JWT_SECRET || 'default_jwt_secret',
  jwtExpiresIn: (process.env.JWT_EXPIRES_IN as `${number}${"d" | "h" | "m" | "s"}`) || '7d',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'default_refresh_secret',
  jwtRefreshExpiresIn: (process.env.JWT_REFRESH_EXPIRES_IN as `${number}${"d" | "h" | "m" | "s"}`) || '7d',
  clientURL: process.env.CLIENT_URL || 'http://localhost:3000',
  nodeEnv: NODE_ENV,
  emailService: process.env.EMAIL_SERVICE || 'gmail',
  emailHost: process.env.EMAIL_HOST || 'smtp.gmail.com',
  emailPort: Number(process.env.EMAIL_PORT) || 465,
  emailUser: process.env.EMAIL_USER || '',
  emailPass: process.env.EMAIL_PASS || '',
  emailFrom: process.env.EMAIL_FROM || process.env.EMAIL_USER || '',
};

export default config;
