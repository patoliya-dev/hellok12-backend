import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../../middlewares/auth';
import { USER_ROLES } from '../../utils/constants';
import * as courseCtrl from './course.controller';
import * as lessonCtrl from '../lessons/lesson.controller';
import { validateRequest } from '../../middlewares/validation';
import { bulkCreateLessonsSchema, bulkUpdateLessonsSchema } from '../lessons/lesson.schemas';

// ownership guard (school or teacher must own the resource for mutating ops)
// for list/create we derive owner from req.user in controller; here we ensure roles
function requireCourseOwnerRole(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role === USER_ROLES.SCHOOL || req.user?.role === USER_ROLES.TEACHER) return next();
  return res
    .status(403)
    .json({ success: false, message: 'Forbidden', error: 'Forbidden', statusCode: 403 });
}

const r = Router();

r.get('/', authenticate, courseCtrl.listCourses); // dashboard list (scoped by owner)
r.get('/:id', authenticate, courseCtrl.getCourseDetail);

r.post('/', authenticate, requireCourseOwnerRole, courseCtrl.createCourse);
r.patch('/:id', authenticate, requireCourseOwnerRole, courseCtrl.updateCourse);
r.delete('/:id', authenticate, requireCourseOwnerRole, courseCtrl.deleteCourse);
r.post('/:id/duplicate', authenticate, requireCourseOwnerRole, courseCtrl.duplicateCourse);

// lesson routes with course dependency
r.get('/:courseId/lessons', authenticate, lessonCtrl.listLessonsForCourse);
r.post(
  '/:courseId/lessons',
  authenticate,
  authorize(['teacher', 'school']),
  validateRequest(bulkCreateLessonsSchema),
  lessonCtrl.bulkCreateForCourse
);

r.patch(
  '/:courseId/lessons',
  authenticate,
  authorize(['teacher', 'school']),
  validateRequest(bulkUpdateLessonsSchema),
  lessonCtrl.bulkUpdateForCourse
);
r.post(
  '/:courseId/lessons/reorder',
  authenticate,
  authorize([USER_ROLES.SCHOOL, USER_ROLES.TEACHER]),
  lessonCtrl.reorderLessons
);
r.get('/:id/details', courseCtrl.courseDetails);
r.get('/:id/feedbacks', courseCtrl.courseFeedbacks);

r.get('/school/courses', authenticate, authorize([USER_ROLES.SCHOOL]), courseCtrl.getSchoolCourses);

export default r;
