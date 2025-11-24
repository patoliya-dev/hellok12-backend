import { Types } from 'mongoose';

export const getUpcomingSessions = async (
  SessionModel: any,
  teacherId: string
): Promise<{
  count: number;
  thisWeek: number;
  changeFromLastWeek: number;
}> => {
  const now = new Date();

  // Get start of current week (Sunday)
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  // Get end of current week (Saturday)
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);

  // Get start of last week
  const startOfLastWeek = new Date(startOfWeek);
  startOfLastWeek.setDate(startOfWeek.getDate() - 7);

  const [totalUpcoming, thisWeek, lastWeek] = await Promise.all([
    // Total upcoming sessions
    SessionModel.countDocuments({
      teacher: new Types.ObjectId(teacherId),
      start: { $gte: now },
      status: { $in: ['SCHEDULED', 'CONFIRMED'] }
    }),

    // This week's sessions
    SessionModel.countDocuments({
      teacher: new Types.ObjectId(teacherId),
      start: { $gte: startOfWeek, $lt: endOfWeek },
      status: { $in: ['SCHEDULED', 'CONFIRMED'] }
    }),

    // Last week's sessions (same time period)
    SessionModel.countDocuments({
      teacher: new Types.ObjectId(teacherId),
      start: { $gte: startOfLastWeek, $lt: startOfWeek },
      status: { $in: ['SCHEDULED', 'CONFIRMED'] }
    })
  ]);

  const changeFromLastWeek = thisWeek - lastWeek;

  return {
    count: totalUpcoming,
    thisWeek,
    changeFromLastWeek
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

  // Get start and end of target month
  const startOfMonth = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
  const endOfMonth = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0);
  endOfMonth.setHours(23, 59, 59, 999);

  // Get start and end of last month
  const startOfLastMonth = new Date(targetMonth.getFullYear(), targetMonth.getMonth() - 1, 1);
  const endOfLastMonth = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 0);
  endOfLastMonth.setHours(23, 59, 59, 999);

  const [currentMonthPayouts, lastMonthPayouts] = await Promise.all([
    // Current month earnings
    PayoutModel.aggregate([
      {
        $match: {
          recipient: new Types.ObjectId(teacherId),
          recipientType: 'TEACHER',
          status: { $in: ['PAID', 'PROCESSING', 'PENDING'] },
          $or: [
            { periodStart: { $gte: startOfMonth, $lte: endOfMonth } },
            { periodEnd: { $gte: startOfMonth, $lte: endOfMonth } }
          ]
        }
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
          currency: { $first: '$currency' }
        }
      }
    ]),

    // Last month earnings
    PayoutModel.aggregate([
      {
        $match: {
          recipient: new Types.ObjectId(teacherId),
          recipientType: 'TEACHER',
          status: { $in: ['PAID', 'PROCESSING', 'PENDING'] },
          $or: [
            { periodStart: { $gte: startOfLastMonth, $lte: endOfLastMonth } },
            { periodEnd: { $gte: startOfLastMonth, $lte: endOfLastMonth } }
          ]
        }
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' }
        }
      }
    ])
  ]);

  const currentAmount = currentMonthPayouts[0]?.totalAmount || 0;
  const lastAmount = lastMonthPayouts[0]?.totalAmount || 0;
  const currency = currentMonthPayouts[0]?.currency || 'USD';

  // Calculate percentage change
  const changeFromLastMonth =
    lastAmount > 0 ? Number((((currentAmount - lastAmount) / lastAmount) * 100).toFixed(1)) : 0;

  const monthName = targetMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric'
  });

  return {
    amount: currentAmount,
    currency,
    month: monthName,
    changeFromLastMonth
  };
};
