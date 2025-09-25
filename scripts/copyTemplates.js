import fs from 'fs';
import path from 'path';
import Logger from '../src/utils/winstonLogger.utils.js';

const srcDir = path.resolve(__dirname, '../src/templates');
const destDir = path.resolve(__dirname, '../dist/templates');

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  fs.readdirSync(src).forEach(item => {
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);

    if (fs.lstatSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  });
}

copyDir(srcDir, destDir);
Logger.info(`✅ Templates copied from ${srcDir} to ${destDir}`);
