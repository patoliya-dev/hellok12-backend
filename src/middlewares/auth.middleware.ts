import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserPayload } from '../types/UserPayload';

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_ACCESS_SECRET) as UserPayload; // Type as UserPayload
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};

export const authorizee = (role: string) => (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== role) return res.status(403).json({ message: 'Unauthorized' });
  next();
};
