import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserPayload } from '../types/UserPayload';
import { User } from '../models/user.model';

const JWT_SECRET = process.env.JWT_SECRET!;

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });

  try {
    const secret = JWT_SECRET || 'secret';
    const decoded = jwt.verify(token, secret) as UserPayload; // Type as UserPayload

    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

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
