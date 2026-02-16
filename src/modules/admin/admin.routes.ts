import { Router } from 'express';
import { authenticate, authorize } from '../../middlewares/auth';
import { USER_ROLES } from '../../utils/constants';
import { adminController } from './admin.controller';

const router = Router();

router.use(authenticate);
router.use(authorize([USER_ROLES.SUPER_ADMIN]));

router.get('/parents', adminController.getParents);

router.get('/teachers', adminController.getTeachers);

router.patch('/users/:userId', adminController.updateUser);

router.get('/schools', adminController.getSchools);

router.get('/schools/:schoolId/details', adminController.getSchoolDetails);

export default router;
