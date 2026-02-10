import { Router } from 'express';
import { teachersStudentsInvitationController } from './manageTeachersStudents.controller';
import { authenticate, authorize } from '../../middlewares/auth';
import { USER_ROLES } from '../../utils/constants';

const router = Router();

router.get(
  '/teachers',
  authenticate,
  authorize([USER_ROLES.SCHOOL, USER_ROLES.SUPER_ADMIN]),
  teachersStudentsInvitationController.getSchoolTeachers
);

router.post(
  '/teacher/invite',
  authenticate,
  authorize([USER_ROLES.SCHOOL, USER_ROLES.SUPER_ADMIN]),
  teachersStudentsInvitationController.inviteTeacher
);

router.post(
  '/student/invite',
  authenticate,
  authorize([USER_ROLES.SCHOOL, USER_ROLES.SUPER_ADMIN]),
  teachersStudentsInvitationController.inviteStudent
);

router.post(
  '/parent/invite',
  authenticate,
  authorize([USER_ROLES.SCHOOL, USER_ROLES.SUPER_ADMIN]),
  teachersStudentsInvitationController.inviteParent
);

router.get(
  '/invitations',
  authenticate,
  authorize([USER_ROLES.SCHOOL, USER_ROLES.SUPER_ADMIN]),
  teachersStudentsInvitationController.listInvitations
);
router.post(
  '/invitations/:invitationId/cancel',
  authenticate,
  authorize([USER_ROLES.SCHOOL, USER_ROLES.SUPER_ADMIN]),
  teachersStudentsInvitationController.cancelInvitation
);

router.post(
  '/teachers/:teacherId/approval',
  authenticate,
  authorize([USER_ROLES.SCHOOL, USER_ROLES.SUPER_ADMIN]),
  teachersStudentsInvitationController.approveRejectTeacher
);

router.get(
  '/students',
  authenticate,
  authorize([USER_ROLES.SCHOOL, USER_ROLES.SUPER_ADMIN]),
  teachersStudentsInvitationController.getStudents
);

router.get(
  '/upcoming-lessons',
  authenticate,
  authorize(USER_ROLES.SCHOOL),
  teachersStudentsInvitationController.getUpcomingLessons
);

export default router;
