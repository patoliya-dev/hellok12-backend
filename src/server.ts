import app from './app';
import config from './config/config';
import { connectDB } from './config/db';
import Logger from './utils/winstonLogger.utils';

async function start() {
  await connectDB();
  app.listen(config.port, () => {
    Logger.info(`Server running on http://localhost:${config.port}`);
  });
}

start();
