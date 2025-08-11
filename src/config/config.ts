import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ path: `.env.${process.env.NODE_ENV || 'development'}` });

interface Config {
  env: string;
  port: number;
  mongoURI: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  clientURL: string;
  nodeEnv: string;
}

const config: Config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  mongoURI: process.env.MONGO_URI || 'mongodb://localhost:27017/hello12k',
  jwtSecret: process.env.JWT_SECRET || 'your_default_secret_key',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  clientURL: process.env.CLIENT_URL || 'http://localhost:3000',
  nodeEnv: process.env.NODE_ENV || 'development',
};

export default config;
