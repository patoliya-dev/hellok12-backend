import app from './app';
import config from './config/config';
import { connectDB } from './config/db';

async function start() {
  await connectDB();
  app.listen(config.port, () => {
    console.log(`Server running on http://localhost:${config.port}`);
  });
}

start();
