import { Types } from 'mongoose';
import { Course } from '../../models/course.model';
import { SessionStatus } from '../../models/sessions.model';

type SessionModelType = {
  countDocuments: (filter: any) => Promise<number>;
};

type CourseModelType = typeof Course;

type UpcomingSessionsOut = {
  count: number;
  thisWeek: number;
  changeFromLastWeek: number;
};

function startOfWeekSunday(d: Date) {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
}

export const getUpcomingSessions = async (
  SessionModel: SessionModelType,
  CourseModel: CourseModelType,
  teacherId: string
): Promise<UpcomingSessionsOut> => {
  const now = new Date();

  const startOfWeek = startOfWeekSunday(now);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  const startOfLastWeek = new Date(startOfWeek);
  startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

  const teacherObjId = new Types.ObjectId(teacherId);

  /**
   * IMPORTANT: ACTIVE COURSES ONLY
   * We restrict sessions by session.course IN activeCourseIds.
   *
   * Choose the best “teacher course ownership rule” for your app:
   * - If teacher owns their own courses: ownerType='teacher' & ownerId=teacherId
   * - If teacher teaches school courses: teachers contains teacherId
   *
   * To support BOTH cases reliably, use $or.
   */
  const courseFilter = {
    status: 'active',
    teachers: teacherObjId
  };

  const activeCourseDocs = await CourseModel.find(courseFilter).select({ _id: 1 }).lean();
  const activeCourseIds = activeCourseDocs.map(c => c._id);

  // safe-empty to avoid $in: []
  const safeCourseIds = activeCourseIds.length ? activeCourseIds : [new Types.ObjectId()];

  const baseFilter = {
    teacher: teacherObjId,
    course: { $in: safeCourseIds },
    status: SessionStatus.SCHEDULED // matches your previous ['SCHEDULED']
  };

  const [totalUpcoming, thisWeek, lastWeek] = await Promise.all([
    // Total upcoming sessions (start >= now)
    SessionModel.countDocuments({
      ...baseFilter,
      start: { $gte: now }
    }),

    // This week's sessions
    SessionModel.countDocuments({
      ...baseFilter,
      start: { $gte: startOfWeek, $lt: endOfWeek }
    }),

    // Last week's sessions (same weekday window)
    SessionModel.countDocuments({
      ...baseFilter,
      start: { $gte: startOfLastWeek, $lt: startOfWeek }
    })
  ]);

  return {
    count: totalUpcoming,
    thisWeek,
    changeFromLastWeek: thisWeek - lastWeek
  };
};

export const getTrialBookings = async (
  BookingModel: any,
  teacherId: string
): Promise<{
  count: number;
  pending: number;
  newRequests: number;
}> => {
  const now = new Date();

  // Get 24 hours ago
  const twentyFourHoursAgo = new Date(now);
  twentyFourHoursAgo.setHours(now.getHours() - 24);

  const [totalTrials, pendingTrials, newRequests] = await Promise.all([
    // Total trial bookings
    BookingModel.countDocuments({
      teacher: new Types.ObjectId(teacherId),
      isTrial: true
    }),

    // Pending approval trials
    BookingModel.countDocuments({
      teacher: new Types.ObjectId(teacherId),
      isTrial: true,
      paymentStatus: 'PENDING'
    }),

    // New requests in last 24 hours
    BookingModel.countDocuments({
      teacher: new Types.ObjectId(teacherId),
      isTrial: true,
      createdAt: { $gte: twentyFourHoursAgo }
    })
  ]);

  return {
    count: totalTrials,
    pending: pendingTrials,
    newRequests
  };
};

export const getAverageRating = async (
  FeedbackRatingModel: any,
  teacherId: string
): Promise<{
  rating: number;
  totalReviews: number;
}> => {
  const result = await FeedbackRatingModel.aggregate([
    {
      $match: { teacher: new Types.ObjectId(teacherId) }
    },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 }
      }
    }
  ]);

  if (!result || result.length === 0) {
    return {
      rating: 0,
      totalReviews: 0
    };
  }

  const overall = result[0];
  const rating = overall?.averageRating || 0;
  const totalReviews = overall?.totalReviews || 0;

  return {
    rating: Number(rating.toFixed(1)),
    totalReviews
  };
};

export const getMonthlyEarnings = async (
  PayoutModel: any,
  teacherId: string,
  month?: Date
): Promise<{
  amount: number;
  currency: string;
  month: string;
  changeFromLastMonth: number;
}> => {
  const targetMonth = month || new Date();

  // Month ranges
  const startOfMonth = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1, 0, 0, 0, 0);
  const endOfMonth = new Date(
    targetMonth.getFullYear(),
    targetMonth.getMonth() + 1,
    0,
    23,
    59,
    59,
    999
  );

  const startOfLastMonth = new Date(
    targetMonth.getFullYear(),
    targetMonth.getMonth() - 1,
    1,
    0,
    0,
    0,
    0
  );
  const endOfLastMonth = new Date(
    targetMonth.getFullYear(),
    targetMonth.getMonth(),
    0,
    23,
    59,
    59,
    999
  );

  const teacherObjId = Types.ObjectId.isValid(teacherId) ? new Types.ObjectId(teacherId) : null;

  // Support multiple receiver shapes:
  // - payouts.toUser (ObjectId)
  // - metadata.raw.payoutReceiverId (string or ObjectId)
  // - metadata.payoutReceiverId (string or ObjectId)
  const receiverMatch: any = {
    $or: [
      ...(teacherObjId ? [{ toUser: teacherObjId }] : []),
      { 'metadata.raw.payoutReceiverId': teacherId },
      ...(teacherObjId ? [{ 'metadata.raw.payoutReceiverId': teacherObjId }] : []),
      { 'metadata.payoutReceiverId': teacherId },
      ...(teacherObjId ? [{ 'metadata.payoutReceiverId': teacherObjId }] : [])
    ]
  };

  // Support status variants used across systems
  const statusMatch = { $in: ['PAID', 'PROCESSING', 'PENDING', 'SENT', 'SETTLED'] };

  const groupStage = {
    _id: null,
    totalAmount: {
      $sum: {
        // prefer netAmount, fallback to amount
        $ifNull: ['$netAmount', { $ifNull: ['$amount', 0] }]
      }
    },
    currency: { $first: '$currency' }
  };

  const [currentMonthPayouts, lastMonthPayouts] = await Promise.all([
    // Current month earnings
    PayoutModel.aggregate([
      {
        $match: {
          ...receiverMatch,
          status: statusMatch,
          createdAt: { $gte: startOfMonth, $lte: endOfMonth }
        }
      },
      { $group: groupStage }
    ]),

    // Last month earnings
    PayoutModel.aggregate([
      {
        $match: {
          ...receiverMatch,
          status: statusMatch,
          createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth }
        }
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: { $ifNull: ['$netAmount', { $ifNull: ['$amount', 0] }] } }
        }
      }
    ])
  ]);

  const currentAmount = Number(currentMonthPayouts?.[0]?.totalAmount || 0) / 100 || 0;
  const lastAmount = Number(lastMonthPayouts?.[0]?.totalAmount || 0) / 100 || 0;
  const currency = currentMonthPayouts?.[0]?.currency || 'USD';

  // Calculate percentage change
  const changeFromLastMonth =
    lastAmount > 0 ? Number((((currentAmount - lastAmount) / lastAmount) * 100).toFixed(1)) : 0;

  const monthName = targetMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return {
    amount: Number(currentAmount.toFixed(2)),
    currency,
    month: monthName,
    changeFromLastMonth
  };
};
