import { authenticate, authorize } from '../../middlewares/auth';
import { USER_ROLES } from '../../utils/constants';
import {
  getDashboardStatsController,
  getSchoolMetrics,
  getWeeklySchedule
} from './dashboards.controller';
import { Router } from 'express';

const r = Router();

/**
 * @route   GET /api/teacher/dashboard/stats
 * @desc    Get complete dashboard statistics
 * @access  Private (Teacher only)
 */
r.get('/', authenticate, authorize(['teacher', 'school']), getDashboardStatsController);
r.get(
  '/weekly-schedule/:studentId',
  authenticate,
  authorize([USER_ROLES.PARENT, USER_ROLES.STUDENT]),
  getWeeklySchedule
);

r.get('/school/metrics', authenticate, authorize([USER_ROLES.SCHOOL]), getSchoolMetrics);

export default r;
