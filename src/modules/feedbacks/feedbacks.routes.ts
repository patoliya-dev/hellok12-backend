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

/**
 * @route   POST /api/feedback-ratings
 * @desc    Create a new feedback rating
 * @access  Private
 */
r.post(
  '/',
  authenticate,
  authorize([USER_ROLES.PARENT, USER_ROLES.STUDENT]),
  feedbackRatingsController.create
);

export default r;
