import express from 'express';
import { EarningsControllerV2 } from './earnings.controller';
import { authenticate, authorize } from '../../middlewares/auth';
import { USER_ROLES } from '../../utils/constants';
import { validatePayoutQuery } from './earnings.helper';

const router = express.Router();

// Routes
router.get(
  '/summary',
  authenticate,
  authorize([USER_ROLES.TEACHER, USER_ROLES.SCHOOL]),
  EarningsControllerV2.getSummary
);

router.get(
  '/graph',
  authenticate,
  authorize([USER_ROLES.TEACHER, USER_ROLES.SCHOOL]),
  EarningsControllerV2.getGraph
);

router.get(
  '/trend',
  authenticate,
  authorize([USER_ROLES.TEACHER, USER_ROLES.SCHOOL]),
  EarningsControllerV2.getTrend
);

router.get(
  '/list',
  authenticate,
  authorize([USER_ROLES.TEACHER, USER_ROLES.SCHOOL]),
  validatePayoutQuery,
  EarningsControllerV2.listEarnings
);

router.get(
  '/earnings-commission',
  authenticate,
  authorize([USER_ROLES.TEACHER, USER_ROLES.SCHOOL]),
  EarningsControllerV2.getPayoutAfterCommission
);

export default router;
