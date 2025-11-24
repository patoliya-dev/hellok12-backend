import dotenv from 'dotenv';
import path from 'path';

// Determine NODE_ENV (default to 'development')
const NODE_ENV = process.env.NODE_ENV || 'development';

// Pick the correct .env file
const envFile = path.resolve(process.cwd(), `.env`);
dotenv.config({ path: envFile });

interface Config {
  env: string;
  port: number;
  mongoURI: string;
  jwtSecret: string;
  jwtExpiresIn: number | `${number}${'d' | 'h' | 'm' | 's'}`;
  jwtRefreshSecret: string;
  jwtRefreshExpiresIn: number | `${number}${'d' | 'h' | 'm' | 's'}`;
  clientURL: string;
  nodeEnv: string;
  emailService: string;
  emailHost: string;
  emailPort: number;
  emailUser: string;
  emailPass: string;
  emailFrom: string;
  AWS_CONFIG: {
    S3_ASSET_BUCKET: string;
    S3_ASSETS_PUBLIC_BASE: string;
    S3_MAX_UPLOAD_MB: number;
  };
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  PLATFORM_FEE_PERCENT: number;
  CURRENCY: string;
  STRIPE_AUTO_TRANSFER?: string;
  STRIPE_API_VERSION?: string;
  zoomAccountId: string;
  zoomClientId: string;
  zoomClientSecret: string;
}

// Type-safe config object
const config: Config = {
  env: NODE_ENV,
  port: Number(process.env.PORT) || 3000,
  mongoURI: process.env.MONGO_URI || 'mongodb://localhost:27017/hello12k',
  jwtSecret: process.env.JWT_SECRET || 'default_jwt_secret',
  jwtExpiresIn: (process.env.JWT_EXPIRES_IN as `${number}${'d' | 'h' | 'm' | 's'}`) || '7d',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'default_refresh_secret',
  jwtRefreshExpiresIn: '7d',
  clientURL: process.env.CLIENT_URL || 'https://dev-app.hellok12.com',
  nodeEnv: NODE_ENV,
  emailService: 'gmail',
  emailHost: 'smtp.gmail.com',
  emailPort: 465,
  emailUser: process.env.EMAIL_USER || '',
  emailPass: process.env.EMAIL_PASS || '',
  emailFrom: `Hello12K <${process.env.EMAIL_USER}>`,
  AWS_CONFIG: {
    S3_ASSET_BUCKET: process.env.S3_ASSET_BUCKET || 'hellok12-assets-dev',
    S3_ASSETS_PUBLIC_BASE: `https://${process.env.S3_ASSET_BUCKET || 'hellok12-assets-dev'}.s3.us-east-1.amazonaws.com`,
    S3_MAX_UPLOAD_MB: 5
  },
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  PLATFORM_FEE_PERCENT: Number(process.env.PLATFORM_FEE_PERCENT || 0.2), // 20% default
  CURRENCY: process.env.DEFAULT_CURRENCY || 'usd',
  STRIPE_AUTO_TRANSFER: 'false',
  STRIPE_API_VERSION: '2022-11-15',
  zoomAccountId: process.env.ZOOM_ACCOUNT_ID || '',
  zoomClientId: process.env.ZOOM_CLIENT_ID || '',
  zoomClientSecret: process.env.ZOOM_CLIENT_SECRET || ''
};

export default config;
