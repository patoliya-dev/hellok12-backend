import { Router } from 'express';
import { feedbackRatingsController } from './feedbacks.controller';
import { authenticate, authorize } from '../../middlewares/auth';
import { USER_ROLES } from '../../utils/constants';

const r = Router();

/**
 * @route   GET /api/feedback-ratings
 * @desc    Get all feedback ratings with filters and pagination
 * @access  Private
 */
r.get(
  '/',
  authenticate,
  authorize([USER_ROLES.SCHOOL, USER_ROLES.TEACHER]),
  feedbackRatingsController.getFeedbackRatings
);

/**
 * @route   GET /api/feedback-ratings/stats/:teacherId
 * @desc    Get feedback statistics for a teacher
 * @access  Private
 */
r.get('/stats/:teacherId', feedbackRatingsController.getFeedbackStats);

export default r;
