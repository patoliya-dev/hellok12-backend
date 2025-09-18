import mongoose from 'mongoose';
import config from './config';
import Logger from '../utils/winstonLogger.utils';

export const connectDB = async () => {
  try {
    await mongoose.connect(config.mongoURI);
    Logger.info(`MongoDB connected to ${config.mongoURI}`);
  } catch (error) {
    Logger.error('MongoDB connection error:', error);
    process.exit(1);
  }
};
