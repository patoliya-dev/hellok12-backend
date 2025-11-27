import express from 'express';
import { EarningsController } from './earnings.controller';
import { authenticate, authorize } from '../../middlewares/auth';
import { USER_ROLES } from '../../utils/constants';
import { validatePayoutQuery } from './earnings.helper';

const router = express.Router();

// Routes
router.get(
  '/summary',
  authenticate,
  authorize([USER_ROLES.TEACHER, USER_ROLES.SCHOOL]),
  EarningsController.getSummary
);

router.get(
  '/trend',
  authenticate,
  authorize([USER_ROLES.TEACHER, USER_ROLES.SCHOOL]),
  EarningsController.getTrend
);

router.get(
  '/list',
  authenticate,
  authorize([USER_ROLES.TEACHER, USER_ROLES.SCHOOL]),
  validatePayoutQuery,
  EarningsController.listPayouts
);

router.get(
  '/earnings-commission',
  authenticate,
  authorize([USER_ROLES.TEACHER, USER_ROLES.SCHOOL]),
  EarningsController.getPayoutAfterCommission
);

export default router;
