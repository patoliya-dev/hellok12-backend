import crypto from 'crypto';

export const normalizeEmail = (email: string) =>
  String(email || '')
    .trim()
    .toLowerCase();
export const generateRawToken = () => crypto.randomBytes(32).toString('hex');
export const hashToken = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');
