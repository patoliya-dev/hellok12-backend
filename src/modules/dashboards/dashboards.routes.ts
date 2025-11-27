import { authenticate, authorize } from '../../middlewares/auth';
import { getDashboardStatsController } from './dashboards.controller';
import { Router } from 'express';

const r = Router();

/**
 * @route   GET /api/teacher/dashboard/stats
 * @desc    Get complete dashboard statistics
 * @access  Private (Teacher only)
 */
r.get('/', authenticate, authorize(['teacher']), getDashboardStatsController);

export default r;
