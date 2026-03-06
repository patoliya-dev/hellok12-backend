import { Types } from 'mongoose';
import { DateTime } from 'luxon';
import {
  getAverageRating,
  getMonthlyEarnings,
  getTrialBookings,
  getUpcomingSessions
} from './dashboards.helper';
import { SessionModel, SessionStatus } from '../../models/sessions.model';
import { FeedbackRating } from '../../models/feedbackRatings.model';
import bookingModel from '../../models/booking.model';
import payoutModel from '../../models/payout.model';
import { Course } from '../../models/course.model';
import { User } from '../../models/user.model';
import { getWeekRangeFromISO } from '../lessons/lesson.util';

export const teacherDashboardService = {
  getDashboardStats: async (teacherId: string) => {
    const [upcomingSessions, trialBookings, averageRating, monthlyEarnings] = await Promise.all([
      getUpcomingSessions(SessionModel, Course, teacherId),
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

    for (let i = 0; i < 7; i++) {
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

type Args = { schoolId: string; timeZone: string };

type CurrencyAgg = {
  currency: string;
  amountCents: number;
  netAmountCents: number;
  transactionCount: number;
};

const toUpperCurrency = (v: any) =>
  String(v || 'usd')
    .trim()
    .toUpperCase();
const safeInt = (v: any) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);

function startEndOfWeekUTC(timeZone: string) {
  const now = DateTime.now().setZone(timeZone);
  return {
    start: now.startOf('week').toUTC().toJSDate(),
    end: now.endOf('week').toUTC().toJSDate()
  };
}

function startEndOfMonthUTC(timeZone: string) {
  const now = DateTime.now().setZone(timeZone);
  return {
    start: now.startOf('month').toUTC().toJSDate(),
    end: now.endOf('month').toUTC().toJSDate()
  };
}

function buildPayoutReceiverMatch(userId: string) {
  const userObj = Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null;

  const or: any[] = [
    ...(userObj ? [{ toUser: userObj }] : []),
    { 'metadata.raw.payoutReceiverId': userId },
    { 'metadata.payoutReceiverId': userId },
    { 'metadata.schoolId': userId }
  ];

  return { $or: or };
}

export const SchoolDashboardService = {
  async getSchoolMetrics({ schoolId, timeZone }: Args) {
    const schoolObjId = new Types.ObjectId(schoolId);
    const tz = timeZone;

    // deterministic Monday-start week boundaries in user's timezone
    const { start: weekStart, end: weekEnd } = getWeekRangeFromISO(undefined, 1, tz);
    const { start: monthStart, end: monthEnd } = startEndOfMonthUTC(tz);

    // ACTIVE courses only
    const [activeCourseDocs, activeTeachers] = await Promise.all([
      Course.find({
        ownerId: schoolObjId,
        ownerType: 'school',
        status: 'active'
      })
        .select({ _id: 1 })
        .lean(),
      User.countDocuments({
        role: 'teacher',
        school: schoolObjId,
        status: 'active',
        isVerified: true
      })
    ]);

    const courseIds = activeCourseDocs.map(c => c._id);
    const safeCourseIds = courseIds.length ? courseIds : [new Types.ObjectId()];

    const totalCourses = courseIds.length;

    /**
     * Scheduled lessons this week:
     * - "scheduledLessonsThisWeek" should only consider sessions belonging to ACTIVE courses.
     * - Keep the statuses you want to count.
     */
    const scheduledLessonsThisWeekQuery = SessionModel.countDocuments({
      course: { $in: safeCourseIds },
      start: { $gte: weekStart, $lte: weekEnd },
      status: { $in: [SessionStatus.SCHEDULED, SessionStatus.IN_PROGRESS] } // adjust if you don’t have IN_PROGRESS
    });

    /**
     * Monthly revenue:
     * - If your platform sets payee=school for school purchases, this is fine.
     * - If you want revenue only from ACTIVE courses, you must store courseId in transaction.metadata
     *   or keep a direct reference; otherwise you cannot reliably filter by course status here.
     */
    const revenueByCurrencyQuery: Promise<CurrencyAgg[]> = payoutModel.aggregate([
      {
        $match: {
          ...buildPayoutReceiverMatch(schoolId),
          status: { $in: ['PAID', 'PROCESSING', 'PENDING'] },
          createdAt: { $gte: monthStart, $lte: monthEnd }
        }
      },
      {
        $group: {
          _id: { $toUpper: { $ifNull: ['$currency', 'usd'] } },
          amountCents: { $sum: { $ifNull: ['$amount', 0] } }, // gross
          netAmountCents: { $sum: { $ifNull: ['$netAmount', 0] } }, // payee net
          transactionCount: { $sum: 1 }
        }
      },
      { $sort: { amountCents: -1 } },
      {
        $project: {
          _id: 0,
          currency: '$_id',
          amountCents: 1,
          netAmountCents: 1,
          transactionCount: 1
        }
      }
    ]);

    const [scheduledLessonsThisWeek, revenueByCurrency] = await Promise.all([
      scheduledLessonsThisWeekQuery,
      revenueByCurrencyQuery
    ]);

    const primary =
      revenueByCurrency[0] ||
      ({
        currency: 'USD',
        amountCents: 0,
        netAmountCents: 0,
        transactionCount: 0
      } as CurrencyAgg);

    // Safety: net cannot exceed gross (if it does, your historical data is inconsistent)
    // We do NOT mutate DB here; we only clamp the metric output to avoid dashboard lying.
    const safePrimaryNet = Math.min(safeInt(primary.netAmountCents), safeInt(primary.amountCents));

    return {
      activeTeachers,
      totalCourses, // active courses only
      scheduledLessonsThisWeek, // sessions from active courses only

      monthlyRevenue: {
        currency: toUpperCurrency(primary.currency),
        amountCents: safeInt(primary.amountCents),
        netAmountCents: safePrimaryNet,
        transactionCount: safeInt(primary.transactionCount)
      },

      monthlyRevenueByCurrency: revenueByCurrency.map(r => ({
        currency: toUpperCurrency(r.currency),
        amountCents: safeInt(r.amountCents),
        netAmountCents: Math.min(safeInt(r.netAmountCents), safeInt(r.amountCents)),
        transactionCount: safeInt(r.transactionCount)
      }))
    };
  }
};
