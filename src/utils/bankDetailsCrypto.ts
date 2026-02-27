import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;

const parseKey = () => {
  const raw = String(process.env.BANK_DETAILS_ENCRYPTION_KEY || '').trim();
  if (!raw) {
    throw new Error('BANK_DETAILS_ENCRYPTION_KEY is required');
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  try {
    const base64 = Buffer.from(raw, 'base64');
    if (base64.length === 32) return base64;
  } catch {
    // no-op
  }

  const utf = Buffer.from(raw, 'utf8');
  if (utf.length === 32) return utf;

  throw new Error('BANK_DETAILS_ENCRYPTION_KEY must resolve to 32 bytes (hex/base64/utf8)');
};

const getKey = () => parseKey();

export const encryptBankValue = (plainText: string) => {
  const value = String(plainText || '');
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getKey();
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
};

export const decryptBankValue = (encryptedValue: string) => {
  const raw = String(encryptedValue || '');
  const [version, ivHex, tagHex, cipherHex] = raw.split(':');
  if (version !== 'v1' || !ivHex || !tagHex || !cipherHex) {
    throw new Error('Invalid encrypted bank value format');
  }

  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const payload = Buffer.from(cipherHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
  return decrypted.toString('utf8');
};

export const maskAccountNumber = (accountNumber: string) => {
  const digits = String(accountNumber || '').replace(/\s+/g, '');
  if (!digits) return '';
  const last4 = digits.slice(-4);
  return `****${last4}`;
};

export const maskUpiId = (upiId: string) => {
  const value = String(upiId || '').trim();
  if (!value.includes('@')) return value ? '***' : '';
  const [local, domain] = value.split('@');
  const localMasked = local.length <= 2 ? '*'.repeat(local.length) : `${local.slice(0, 2)}***`;
  return `${localMasked}@${domain}`;
};
