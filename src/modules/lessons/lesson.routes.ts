import { Router } from 'express';
import { authenticate, authorize } from '../../middlewares/auth';
import { USER_ROLES } from '../../utils/constants';
import * as ctrl from './lesson.controller';

const r = Router();

r.post('/', authenticate, authorize([USER_ROLES.SCHOOL, USER_ROLES.TEACHER]), ctrl.createLesson);
r.patch(
  '/:id',
  authenticate,
  authorize([USER_ROLES.SCHOOL, USER_ROLES.TEACHER]),
  ctrl.updateLesson
);
r.delete(
  '/:id',
  authenticate,
  authorize([USER_ROLES.SCHOOL, USER_ROLES.TEACHER]),
  ctrl.deleteLesson
);
r.post(
  '/:id/duplicate',
  authenticate,
  authorize([USER_ROLES.SCHOOL, USER_ROLES.TEACHER]),
  ctrl.duplicateLesson
);

export default r;
