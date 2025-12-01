// routes/progress.routes.ts

import { Router } from 'express';
import { ProgressController } from './progress.controller';
import { authenticate } from '../../middlewares/auth';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticate);

router.get('/', ProgressController.getUserProgress);

router.get('/dashboard/:studentId', ProgressController.getDashboardData);

router.get('/weekly-stats', ProgressController.getWeeklyStats);

router.get('/course/:courseId', ProgressController.getCourseProgress);

router.get('/course/:courseId/lessons', ProgressController.getCourseLessonDetails);

router.post('/courses/batch', ProgressController.getMultipleCourseProgress);

router.get('/analytics/:studentId', ProgressController.getAnalyticsDashboard);

export default router;
