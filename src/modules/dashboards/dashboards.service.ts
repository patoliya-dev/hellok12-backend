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

export const StudentDashboardService = {
  async getWeeklySchedule(query: WeeklyScheduleQuery): Promise<WeeklyScheduleResponse> {
    const { studentId, startDate, endDate } = query;

    // Fetch sessions from database with populated references
    const sessions = await SessionModel.find({
      students: { $in: [new Types.ObjectId(studentId)] },
      start: {
        $gte: startDate,
        $lte: endDate
      }
    })
      .populate({
        path: 'lesson',
        select: 'title'
      })
      .populate({
        path: 'teacher',
        select: 'name'
      })
      .sort({ start: 1 })
      .lean();

    // Group sessions by day
    const dayMap = new Map<string, SessionCard[]>();

    sessions.forEach((session: any) => {
      const sessionDate = new Date(session.start);
      // FIX: Use local date instead of UTC
      const dateKey = sessionDate.toLocaleDateString('en-CA');

      if (!dayMap.has(dateKey)) {
        dayMap.set(dateKey, []);
      }

      const duration = Math.round(
        (new Date(session.end).getTime() - new Date(session.start).getTime()) / (1000 * 60)
      );

      const sessionCard: SessionCard = {
        sessionId: session._id.toString(),
        lessonName: session.lesson?.title || 'Unknown Lesson',
        teacherName: session.teacher?.name || 'Unknown Teacher',
        duration,
        startTime: session.start,
        endTime: session.end,
        status: session.status
      };

      dayMap.get(dateKey)!.push(sessionCard);
    });

    // Generate all days in the week range
    const days: DaySchedule[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      // FIX: Use local date for consistency
      const dateKey = currentDate.toLocaleDateString('en-CA');
      const daySessions = dayMap.get(dateKey) || [];

      days.push({
        date: new Date(currentDate),
        dayName: currentDate.toLocaleDateString('en-US', { weekday: 'long' }),
        sessions: daySessions,
        sessionCount: daySessions.length
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return {
      weekStart: startDate,
      weekEnd: endDate,
      totalSessions: sessions.length,
      days
    };
  },

  getWeekBoundaries(date: Date = new Date()): { start: Date; end: Date } {
    const current = new Date(date);
    const dayOfWeek = current.getDay();

    // Get Monday (start of week)
    const start = new Date(current);
    start.setDate(current.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    start.setHours(0, 0, 0, 0);

    // Get Sunday (end of week)
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }
};
