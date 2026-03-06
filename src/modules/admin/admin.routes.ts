import { Router } from 'express';
import { authenticate, authorize } from '../../middlewares/auth';
import { USER_ROLES } from '../../utils/constants';
import { adminController } from './admin.controller';

const router = Router();

router.get(
  '/schools',
  authenticate,
  authorize([USER_ROLES.SUPER_ADMIN]),
  adminController.getSchools
);

router.get(
  '/parents',
  authenticate,
  authorize([USER_ROLES.SUPER_ADMIN]),
  adminController.getParents
);

router.patch(
  '/users/:userId',
  authenticate,
  authorize([USER_ROLES.SUPER_ADMIN]),
  adminController.updateUser
);

export default router;
