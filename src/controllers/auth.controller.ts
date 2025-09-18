import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { validationResult } from 'express-validator';

export const authController = {
  signup: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const user = await authService.signup(req.body);
      res.status(201).json({ message: 'User created, verification email sent', userId: user._id });
    } catch (error) {
      next(error);
    }
  },

  login: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { email, password } = req.body;
      const tokens = await authService.login(email, password);
      res.json(tokens);
    } catch (error) {
      next(error);
    }
  },

  verifyEmail: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.query.token as string;
      if (!token) {
        return res.status(400).json({ success: false, message: 'Token missing' });
      }

      const user = await authService.verifyEmail(token);
      res.json({ message: 'Email verified', userId: user._id });
    } catch (error) {
      next(error);
    }
  },

  forgotPassword: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { email } = req.body;
      await authService.forgotPassword(email);
      res.json({ message: 'Verification code sent to email' });
    } catch (error) {
      next(error);
    }
  },

  verifyResetCode: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { email, code } = req.body;
      await authService.verifyResetCode(email, code);
      res.json({ message: 'Verification code valid' });
    } catch (error) {
      next(error);
    }
  },

  resetPassword: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { email, code, newPassword } = req.body;
      await authService.resetPassword(email, code, newPassword);
      res.json({ message: 'Password reset successfully' });
    } catch (error) {
      next(error);
    }
  },

  refreshToken: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = req.body;
      const tokens = await authService.refreshToken(refreshToken);
      res.json(tokens);
    } catch (error) {
      next(error);
    }
  },

  getCurrentUser: async (req: Request, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
      res.json(req.user);
    } catch (err) {
      res.status(500).json({ message: 'Server error', error: err });
    }
  }
};
