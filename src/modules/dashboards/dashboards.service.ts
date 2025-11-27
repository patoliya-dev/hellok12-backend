import { Types } from 'mongoose';
import {
  getAverageRating,
  getMonthlyEarnings,
  getTrialBookings,
  getUpcomingSessions
} from './dashboards.helper';
import { SessionModel } from '../../models/sessions.model';
import { FeedbackRating } from '../../models/feedbackRatings.model';
import bookingModel from '../../models/booking.model';
import payoutModel from '../../models/payout.model';

export const teacherDashboardService = {
  getDashboardStats: async (teacherId: string): Promise<DashboardStats> => {
    const [upcomingSessions, trialBookings, averageRating, monthlyEarnings] = await Promise.all([
      getUpcomingSessions(SessionModel, teacherId),
      getTrialBookings(bookingModel, teacherId),
      getAverageRating(FeedbackRating, teacherId),
      getMonthlyEarnings(payoutModel, teacherId)
    ]);

    return {
      upcomingSessions,
      trialBookings,
      averageRating,
      monthlyEarnings
    };
  }
};
