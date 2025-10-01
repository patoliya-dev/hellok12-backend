import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth';
import { createErrorResponse } from '../utils/apiResponse';
import { USER_ROLES } from '../utils/constants';

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

// Common role combinations
export const requireTeacherOrSchool = requireRole([USER_ROLES.TEACHER, USER_ROLES.SCHOOL]);
export const requireTeacher = requireRole([USER_ROLES.TEACHER]);
export const requireSchool = requireRole([USER_ROLES.SCHOOL]);
export const requireParent = requireRole([USER_ROLES.PARENT]);
export const requireAdmin = requireRole([USER_ROLES.SUPER_ADMIN]);
