import jwt, { SignOptions, Secret } from 'jsonwebtoken';
import config from '../config/config';

if (!config.jwtSecret || !config.jwtRefreshSecret) {
  throw new Error('JWT secrets are not defined in config');
}

export interface JwtPayload {
  id: string;
  role?: string;
  action?: 'verify' | 'reset';
  rememberMe?: boolean;
}

const signOptions: SignOptions = { expiresIn: config.jwtExpiresIn };
const refreshSignOptions: SignOptions = { expiresIn: config.jwtRefreshExpiresIn };

export const generateToken = (payload: JwtPayload, expiresIn?: string): string => {
  return jwt.sign(
    payload,
    config.jwtSecret as Secret,
    { expiresIn: expiresIn || signOptions.expiresIn } as SignOptions
  );
};

export const generateRefreshToken = (payload: JwtPayload, expiresIn?: string): string => {
  return jwt.sign(
    payload,
    config.jwtRefreshSecret as Secret,
    { expiresIn: expiresIn || refreshSignOptions.expiresIn } as SignOptions
  );
};

export const verifyToken = (token: string): JwtPayload => {
  try {
    return jwt.verify(token, config.jwtSecret as Secret) as JwtPayload;
  } catch {
    throw new Error('Invalid or expired token');
  }
};

export const verifyRefreshToken = (token: string): JwtPayload => {
  try {
    return jwt.verify(token, config.jwtRefreshSecret as Secret) as JwtPayload;
  } catch {
    throw new Error('Invalid or expired refresh token');
  }
};
