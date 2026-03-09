import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserPayload } from '../types/UserPayload';
import { User } from '../models/user.model';
import { createErrorResponse } from '../utils/apiResponse';
import { USER_ROLES } from '../utils/constants';

const JWT_SECRET = process.env.JWT_SECRET!;

// Use the existing UserPayload interface instead of redefining
export interface AuthenticatedRequest extends Request {
  user?: UserPayload;
}

export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token) {
      res.status(401).json(createErrorResponse('No token provided', 'Unauthorized', 401));
      return;
    }

    const secret = JWT_SECRET || 'secret';
    const decoded = jwt.verify(token, secret) as UserPayload;
    // Verify user exists in database
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      res.status(404).json(createErrorResponse('User not found', 'User not found', 404));
      return;
    }

    // Ensure the user role matches expected types
    if (!Object.values(USER_ROLES).includes(decoded.role as any)) {
      res.status(403).json(createErrorResponse('Invalid user role', 'Forbidden', 403));
      return;
    }

    const headerTz = (req.headers['x-timezone'] as string) || '';
    req.userTimezone = headerTz || 'UTC';

    // Set the validated user payload
    req.user = {
      id: decoded.id,
      role: decoded.role,
      email: decoded.email,
      schoolId: decoded.schoolId
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json(createErrorResponse('Token expired', 'Token Expired', 401));
    } else if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json(createErrorResponse('Invalid token', 'Invalid Token', 401));
    } else {
      res
        .status(500)
        .json(createErrorResponse('Authentication error', 'Internal Server Error', 500));
    }
  }
};

// Fixed function name (was 'authorizee') and use AuthenticatedRequest
export const authorize = (allowedRoles: string | string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json(createErrorResponse('Authentication required', 'Unauthorized', 401));
      return;
    }

    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

    if (!roles.includes(req.user.role)) {
      res
        .status(403)
        .json(
          createErrorResponse(
            `Access denied. Required roles: ${roles.join(', ')}`,
            'Forbidden',
            403
          )
        );
      return;
    }

    next();
  };
};

// Role-specific authorization helpers
export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json(createErrorResponse('Authentication required', 'Unauthorized', 401));
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res
        .status(403)
        .json(
          createErrorResponse(
            `Access denied. Required roles: ${allowedRoles.join(', ')}`,
            'Forbidden',
            403
          )
        );
      return;
    }

    next();
  };
};

// Common role combinations for convenience
export const requireTeacherOrSchool = requireRole([USER_ROLES.TEACHER, USER_ROLES.SCHOOL]);
export const requireTeacher = requireRole([USER_ROLES.TEACHER]);
export const requireSchool = requireRole([USER_ROLES.SCHOOL]);
export const requireParent = requireRole([USER_ROLES.PARENT]);
export const requireAdmin = requireRole([USER_ROLES.SUPER_ADMIN]);

// Token refresh middleware
export const refreshToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json(createErrorResponse('Authentication required', 'Unauthorized', 401));
    return;
  }

  try {
    const newToken = jwt.sign(
      {
        id: req.user.id,
        role: req.user.role,
        email: req.user.email,
        schoolId: req.user.schoolId
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.setHeader('X-New-Token', newToken);
    next();
  } catch (error) {
    res.status(500).json(createErrorResponse('Token refresh failed', 'Internal Server Error', 500));
  }
};
