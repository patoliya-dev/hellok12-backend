import { Router } from 'express';
import { schoolController } from './manageTeachersStudents.controller';
import { authenticate, authorize } from '../../middlewares/auth';
import { USER_ROLES } from '../../utils/constants';

const router = Router();

router.get(
  '/teachers',
  authenticate,
  authorize(USER_ROLES.SCHOOL),
  schoolController.getSchoolTeachers
);

router.post(
  '/teacher/invite',
  authenticate,
  authorize(USER_ROLES.SCHOOL),
  schoolController.inviteTeacher
);

router.post(
  '/student/invite',
  authenticate,
  authorize(USER_ROLES.SCHOOL),
  schoolController.inviteStudent
);

router.get(
  '/invitations',
  authenticate,
  authorize(USER_ROLES.SCHOOL),
  schoolController.listInvitations
);
router.post(
  '/invitations/:invitationId/cancel',
  authenticate,
  authorize(USER_ROLES.SCHOOL),
  schoolController.cancelInvitation
);

router.post(
  '/teachers/:teacherId/approval',
  authenticate,
  authorize(USER_ROLES.SCHOOL),
  schoolController.approveRejectTeacher
);

router.get('/students', authenticate, authorize(USER_ROLES.SCHOOL), schoolController.getStudents);

router.get(
  '/upcoming-lessons',
  authenticate,
  authorize(USER_ROLES.SCHOOL),
  schoolController.getUpcomingLessons
);

export default router;
