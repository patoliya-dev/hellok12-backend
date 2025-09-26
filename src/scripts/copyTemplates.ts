import fs from 'fs';
import path from 'path';
import Logger from '../utils/winstonLogger.utils';

const srcDir = path.join(process.cwd(), 'src/templates'); // always points to src/templates
const distDir = path.join(process.cwd(), 'dist/templates');

if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

fs.readdir(srcDir, (err, files) => {
  if (err) {
    Logger.error('Error reading templates folder:', err);
    process.exit(1);
  }

  files.forEach(file => {
    const srcFile = path.join(srcDir, file);
    const distFile = path.join(distDir, file);

    fs.copyFile(srcFile, distFile, err => {
      if (err) Logger.error(`Failed to copy template ${file}:`, err);
      else Logger.info(`Copied template: ${file}`);
    });
  });
});
