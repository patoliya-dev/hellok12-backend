import { Types } from 'mongoose';
import { DateTime } from 'luxon';
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
  getDashboardStats: async (teacherId: string) => {
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
  async getWeeklySchedule(query: any & { timezone: string }) {
    const { studentId, startDate, endDate, timezone = 'UTC' } = query;

    // startDate and endDate should already be UTC Date objects representing the day/week boundaries,
    // computed via getWeekRangeFromISO(..., timezone).
    const sessions = await SessionModel.find({
      students: { $in: [new Types.ObjectId(studentId)] },
      start: { $gte: startDate, $lte: endDate }
    })
      .populate({ path: 'lesson', select: 'title' })
      .populate({ path: 'teacher', select: 'name' })
      .sort({ start: 1 })
      .lean();

    // Formatters using user's timezone
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone
    });

    const dayMap = new Map<string, any[]>();

    for (const s of sessions) {
      const startUtc = DateTime.fromJSDate(new Date(s.start), { zone: 'utc' });
      // convert instant to user timezone for formatting only
      const localStart = startUtc.setZone(timezone);
      const dateKey = localStart.toISODate() ?? localStart.toFormat('yyyy-MM-dd'); // YYYY-MM-DD in user's tz
      const displayTime = timeFormatter.format(localStart.toJSDate());

      const sessionCard = {
        sessionId: s._id.toString(),
        lessonName: (s.lesson as any)?.title || 'Unknown Lesson',
        teacherName: (s.teacher as any)?.name || 'Unknown Teacher',
        duration: Math.round((new Date(s.end).getTime() - new Date(s.start).getTime()) / 60000),
        startTime: s.start,
        endTime: s.end,
        displayTime,
        status: s.status
      };

      if (!dayMap.has(dateKey)) dayMap.set(dateKey, []);
      dayMap.get(dateKey)!.push(sessionCard);
    }

    // Build days array from startDate → endDate stepping by user's local day
    const days = [];
    // Build in user's timezone to ensure correct day names & keys
    let cur = DateTime.fromJSDate(startDate, { zone: 'utc' }).setZone(timezone).startOf('day');
    const endLocal = DateTime.fromJSDate(endDate, { zone: 'utc' }).setZone(timezone).endOf('day');

    while (cur <= endLocal) {
      const dateKey = cur.toISODate() ?? cur.toFormat('yyyy-MM-dd');
      days.push({
        date: cur.toUTC().toJSDate(), // anchor in UTC (useful on client)
        dayName: cur.toFormat('cccc'), // e.g., Monday
        sessions: dayMap.get(dateKey) || [],
        sessionCount: (dayMap.get(dateKey) || []).length
      });
      cur = cur.plus({ days: 1 });
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
