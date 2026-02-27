import { Router } from 'express';
import { authenticate, authorize } from '../../middlewares/auth';
import { validateRequest } from '../../middlewares/validation';
import { USER_ROLES } from '../../utils/constants';
import { payoutAccountController } from './payoutAccount.controller';
import {
  createMyPayoutAccountSchema,
  getMyPayoutAccountSchema,
  patchMyPayoutAccountSchema
} from './payoutAccount.schemas';

const router = Router();

router.use(authenticate);
router.use(authorize([USER_ROLES.TEACHER, USER_ROLES.SCHOOL]));

router.get('/me', validateRequest(getMyPayoutAccountSchema), payoutAccountController.getMe);
router.post('/me', validateRequest(createMyPayoutAccountSchema), payoutAccountController.createMe);
router.patch('/me', validateRequest(patchMyPayoutAccountSchema), payoutAccountController.patchMe);
router.delete('/me', validateRequest(getMyPayoutAccountSchema), payoutAccountController.deleteMe);

export default router;
