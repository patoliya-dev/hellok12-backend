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
  '/breakdown',
  authenticate,
  authorize([USER_ROLES.TEACHER, USER_ROLES.SCHOOL]),
  EarningsController.getBreakdown
);

router.get(
  '/custom',
  authenticate,
  authorize([USER_ROLES.TEACHER, USER_ROLES.SCHOOL]),
  EarningsController.getCustomRange
);
router.get(
  '/trend',
  authenticate,
  authorize([USER_ROLES.TEACHER, USER_ROLES.SCHOOL]),
  EarningsController.getTrend
);

/**
 * @route   GET /api/payouts
 * @desc    List payouts with filters and pagination
 * @access  Private
 * @query   {
 *   lessonType?: '1-on-1' | 'group',
 *   paymentStatus?: 'PENDING' | 'SENT' | 'FAILED' | 'SETTLED',
 *   amountRange?: '0-50' | '50-100' | '100-150' | '150-200',
 *   startDate?: string,
 *   endDate?: string,
 *   page?: number,
 *   limit?: number,
 *   sortBy?: string,
 *   sortOrder?: 'asc' | 'desc'
 * }
 */
router.get(
  '/list',
  authenticate,
  authorize([USER_ROLES.TEACHER, USER_ROLES.SCHOOL]),
  validatePayoutQuery,
  EarningsController.listPayouts
);

export default router;
