import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service';
import { createErrorResponse, createSuccessResponse } from '../../utils/apiResponse';

export const authController = {
  signup: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { role, children, ...otherData } = req.body;

      let result;

      // Route to appropriate service method based on role
      switch (role) {
        case 'student':
          result = await authService.registerStudent({
            ...otherData,
            role: role
          });
          break;

        case 'parent':
          result = await authService.registerParent({
            ...otherData,
            children: children || []
          });
          break;

        case 'teacher':
          result = await authService.registerTeacher({
            ...otherData,
            role: role
          });
          break;

        case 'school':
          result = await authService.registerSchool({
            ...otherData,
            role: role
          });
          break;

        default:
          return res.status(400).json({
            success: false,
            message: 'Invalid role specified'
          });
      }

      // Handle parent result (which returns parent + children)
      const user: any = (result as any).parent || result;
      const userId = user._id;

      res.status(201).json({
        success: true,
        message: 'Account created successfully, verification email sent',
        data: {
          user: {
            id: userId,
            email: user.email,
            name: user.name,
            role: user.role,
            isVerified: user.isVerified
          },
          userId,
          requiresEmailVerification: true
        }
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message || 'Registration failed'
      });
    }
  },

  login: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password, rememberMe } = req.body;
      const result = await authService.login(email, password, rememberMe);

      res.json({
        success: true,
        message: 'Login successful',
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user
      });
    } catch (error: any) {
      if (error.message === 'Email not verified') {
        return res.status(401).json({
          success: false,
          message: 'Please verify your email before logging in'
        });
      }

      res.status(401).json({
        success: false,
        message: error.message || 'Login failed'
      });
    }
  },

  verifyEmail: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.query.token as string;
      if (!token) {
        return res.status(400).json({
          success: false,
          message: 'Token missing'
        });
      }

      const result = await authService.verifyEmail(token);
      res.json({
        success: true,
        message: 'Email verified',
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message || 'Email verification failed'
      });
    }
  },

  forgotPassword: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = req.body;
      await authService.forgotPassword(email);
      res.json({
        success: true,
        message: 'Verification code sent to email'
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to send verification code'
      });
    }
  },

  verifyResetCode: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, code } = req.body;
      await authService.verifyResetCode(email, code);
      res.json({
        success: true,
        message: 'Verification code valid'
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message || 'Invalid verification code'
      });
    }
  },

  resetPassword: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, code, newPassword } = req.body;
      await authService.resetPassword(email, code, newPassword);
      res.json({
        success: true,
        message: 'Password reset successfully'
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message || 'Password reset failed'
      });
    }
  },

  refreshToken: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = req.body;
      const tokens = await authService.refreshToken(refreshToken);
      res.json({
        success: true,
        ...tokens
      });
    } catch (error: any) {
      res.status(401).json({
        success: false,
        message: error.message || 'Token refresh failed'
      });
    }
  },

  getCurrentUser: async (req: Request, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

      const user = await authService.getCurrentUser(req.user.id, req.user.role);
      res.json({
        success: true,
        data: user
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        message: 'Server error',
        error: err.message
      });
    }
  },

  updateCurrentUser: async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      if (!userId) {
        return res.status(400).json(createErrorResponse('Missing userId', 'Bad Request', 400));
      }

      if (!req.user?.id) {
        return res.status(401).json(createErrorResponse('Unauthorized', 'Unauthorized', 401));
      }

      const user = await authService.updateCurrentUser({
        userId,
        authUserId: String(req.user.id),
        authRole: String(req.user.role),
        body: req.body
      });

      return res.status(200).json(createSuccessResponse(user, 'Profile updated', 200));
    } catch (err: any) {
      const status = err?.statusCode || 500;
      return res
        .status(status)
        .json(createErrorResponse(err?.message || 'Server error', 'Error', status));
    }
  },

  deleteChildren: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { childrenId } = req.params as { childrenId: string };
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json(createErrorResponse('Unauthorized', 'Unauthorized', 401));
      }
      await authService.deleteChildren(userId, childrenId);
      res.json({
        success: true,
        message: 'Children deleted successfully'
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        message: 'Server error',
        error: err.message
      });
    }
  },

  addStudentToParent: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json(createErrorResponse('Unauthorized', 'Unauthorized', 401));
      }
      const user = await authService.addStudentToParent(userId, req.body);
      res.json({
        success: true,
        message: 'Student added successfully',
        data: user
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        message: 'Server error',
        error: err.message
      });
    }
  },

  changePassword: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const user = await authService.changePassword(
        req.user?.id as string,
        currentPassword,
        newPassword
      );
      return res.json({
        success: true,
        message: 'Password changed successfully',
        data: user
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: 'Server error',
        error: err.message
      });
    }
  }
};
