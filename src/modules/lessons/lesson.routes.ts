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
r.get(
  '/dashboard',
  authenticate,
  authorize([USER_ROLES.SCHOOL, USER_ROLES.TEACHER]),
  ctrl.getLessonsDashboard
);
r.get(
  '/calendar',
  authenticate,
  authorize([USER_ROLES.SCHOOL, USER_ROLES.TEACHER]),
  ctrl.getCalendarOverview
);

r.get(
  '/calendar/:date',
  authenticate,
  authorize([USER_ROLES.SCHOOL, USER_ROLES.TEACHER]),
  ctrl.getSessionsByDate
);

r.get('/list', authenticate, authorize([USER_ROLES.SCHOOL, USER_ROLES.TEACHER]), ctrl.getLessons);

r.get(
  '/stats',
  authenticate,
  authorize([USER_ROLES.SCHOOL, USER_ROLES.TEACHER]),
  ctrl.getLessonStats
);

r.get('/:id', authenticate, authorize([USER_ROLES.SCHOOL, USER_ROLES.TEACHER]), ctrl.getLessonById);

r.patch(
  '/:id/status',
  authenticate,
  authorize([USER_ROLES.SCHOOL, USER_ROLES.TEACHER]),
  ctrl.updateLessonStatus
);

export default r;
