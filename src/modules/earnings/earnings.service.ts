import { Types } from 'mongoose';
import { DateTime } from 'luxon';
import payoutModel from '../../models/payout.model';

interface IEarningsSummary {
  thisWeek: {
    amount: number;
    percentageChange: number;
    comparisonPeriod: string;
  };
  thisMonth: {
    amount: number;
    percentageChange: number;
    comparisonPeriod: string;
  };
  thisYear: {
    amount: number;
    percentageChange: number;
    comparisonPeriod: string;
  };
}

interface IEarningsSummary {
  thisWeek: { amount: number; percentageChange: number; comparisonPeriod: string };
  thisMonth: { amount: number; percentageChange: number; comparisonPeriod: string };
  thisYear: { amount: number; percentageChange: number; comparisonPeriod: string };
}

// Shared receiver match for old + new payout structures
function buildReceiverMatch(userId: string) {
  const userObj = Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null;
  const or: any[] = [
    { 'metadata.raw.payoutReceiverId': userId }, // old
    { 'metadata.schoolId': userId }, // new meta
    { 'metadata.payoutReceiverId': userId } // optional future-proof
  ];
  if (userObj) or.unshift({ toUser: userObj }); // new canonical
  return { $or: or };
}

// ISO week helper (matches MongoDB $isoWeek/$isoWeekYear)
function getISOWeekParts(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // 1..7 (Mon..Sun)
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { isoWeek: weekNo, isoWeekYear: isoYear };
}

function toObjectId(id?: string) {
  return id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;
}

/**
 * Business decision:
 * - We compare "this period so far" vs "previous period for the same elapsed duration".
 *   This avoids inflated percentages early in a period.
 *
 * Example:
 * - If today is Wed, "this week" = Mon 00:00 → now
 * - "last week" = last Mon 00:00 → last Wed (same elapsed time)
 */
function getToDateRanges(timeZone = 'UTC') {
  const nowLocal = DateTime.now().setZone(timeZone);

  // ---- Week (Monday start) ----
  const weekStartLocal = nowLocal.startOf('day').minus({ days: (nowLocal.weekday + 6) % 7 }); // weekday: Mon=1..Sun=7

  const elapsedWeekMs = nowLocal.toMillis() - weekStartLocal.toMillis();

  const lastWeekStartLocal = weekStartLocal.minus({ weeks: 1 });
  const lastWeekEndLocal = lastWeekStartLocal.plus({ milliseconds: elapsedWeekMs });

  // ---- Month ----
  const monthStartLocal = nowLocal.startOf('month');
  const elapsedMonthMs = nowLocal.toMillis() - monthStartLocal.toMillis();

  const lastMonthStartLocal = monthStartLocal.minus({ months: 1 });
  const lastMonthEndLocal = lastMonthStartLocal.plus({ milliseconds: elapsedMonthMs });

  // ---- Year ----
  const yearStartLocal = nowLocal.startOf('year');
  const elapsedYearMs = nowLocal.toMillis() - yearStartLocal.toMillis();

  const lastYearStartLocal = yearStartLocal.minus({ years: 1 });
  const lastYearEndLocal = lastYearStartLocal.plus({ milliseconds: elapsedYearMs });

  // Convert to UTC JS Dates for Mongo createdAt filtering (DB stored in UTC)
  return {
    now: nowLocal.toUTC().toJSDate(),

    thisWeek: {
      startDate: weekStartLocal.toUTC().toJSDate(),
      endDate: nowLocal.toUTC().toJSDate()
    },
    lastWeek: {
      startDate: lastWeekStartLocal.toUTC().toJSDate(),
      endDate: lastWeekEndLocal.toUTC().toJSDate()
    },

    thisMonth: {
      startDate: monthStartLocal.toUTC().toJSDate(),
      endDate: nowLocal.toUTC().toJSDate()
    },
    lastMonth: {
      startDate: lastMonthStartLocal.toUTC().toJSDate(),
      endDate: lastMonthEndLocal.toUTC().toJSDate()
    },

    thisYear: {
      startDate: yearStartLocal.toUTC().toJSDate(),
      endDate: nowLocal.toUTC().toJSDate()
    },
    lastYear: {
      startDate: lastYearStartLocal.toUTC().toJSDate(),
      endDate: lastYearEndLocal.toUTC().toJSDate()
    }
  } as const;
}

function calculatePercentageChange(current: number, previous: number): number {
  // If there was no previous earning, any positive current is effectively +100% from 0 baseline (UI convention).
  if (!Number.isFinite(previous) || previous <= 0) return current > 0 ? 100 : 0;

  const delta = ((current - previous) / previous) * 100;
  // keep 1 decimal, avoid -0.0
  const v = Number(delta.toFixed(1));
  return Object.is(v, -0) ? 0 : v;
}

export const EarningsService = {
  /**
   * Robust receiver matching:
   * - Newer payouts: `toUser: ObjectId`
   * - Older/legacy: `metadata.raw.payoutReceiverId: string`
   * - Some variants: `metadata.payoutReceiverId: string`
   */
  async calculateEarnings(
    userId: string,
    startDate: Date,
    endDate: Date,
    PayoutModel: any
  ): Promise<number> {
    const userObjId = toObjectId(userId);

    const receiverOr: any[] = [];
    if (userObjId) receiverOr.push({ toUser: userObjId });
    // legacy/variants (string matches)
    receiverOr.push({ 'metadata.raw.payoutReceiverId': String(userId) });
    receiverOr.push({ 'metadata.payoutReceiverId': String(userId) });
    receiverOr.push({ 'metadata.payoutReceiverId': userObjId }); // if stored as ObjectId in metadata

    const result = await PayoutModel.aggregate([
      {
        $match: {
          $or: receiverOr,
          status: { $in: ['PAID', 'PROCESSING', 'PENDING'] },
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          // IMPORTANT:
          // - If your payout docs store payee net in `netAmount` (cents), sum netAmount.
          // - If you actually want gross, sum amount.
          totalAmount: { $sum: { $ifNull: ['$netAmount', 0] } }
        }
      }
    ]);

    const cents = result?.[0]?.totalAmount ?? 0;
    return Number((cents / 100).toFixed(2));
  },

  async getEarningsSummary(
    userId: string,
    PayoutModel: any,
    timeZone = 'UTC'
  ): Promise<IEarningsSummary> {
    const ranges = getToDateRanges(timeZone);

    const [
      thisWeekEarnings,
      lastWeekEarnings,
      thisMonthEarnings,
      lastMonthEarnings,
      thisYearEarnings,
      lastYearEarnings
    ] = await Promise.all([
      this.calculateEarnings(
        userId,
        ranges.thisWeek.startDate,
        ranges.thisWeek.endDate,
        PayoutModel
      ),
      this.calculateEarnings(
        userId,
        ranges.lastWeek.startDate,
        ranges.lastWeek.endDate,
        PayoutModel
      ),

      this.calculateEarnings(
        userId,
        ranges.thisMonth.startDate,
        ranges.thisMonth.endDate,
        PayoutModel
      ),
      this.calculateEarnings(
        userId,
        ranges.lastMonth.startDate,
        ranges.lastMonth.endDate,
        PayoutModel
      ),

      this.calculateEarnings(
        userId,
        ranges.thisYear.startDate,
        ranges.thisYear.endDate,
        PayoutModel
      ),
      this.calculateEarnings(
        userId,
        ranges.lastYear.startDate,
        ranges.lastYear.endDate,
        PayoutModel
      )
    ]);

    return {
      thisWeek: {
        amount: thisWeekEarnings,
        percentageChange: calculatePercentageChange(thisWeekEarnings, lastWeekEarnings),
        comparisonPeriod: 'vs previous week'
      },
      thisMonth: {
        amount: thisMonthEarnings,
        percentageChange: calculatePercentageChange(thisMonthEarnings, lastMonthEarnings),
        comparisonPeriod: 'vs previous month'
      },
      thisYear: {
        amount: thisYearEarnings,
        percentageChange: calculatePercentageChange(thisYearEarnings, lastYearEarnings),
        comparisonPeriod: 'vs previous year'
      }
    };
  },

  // Get optimized earnings trend using aggregation Much faster than multiple queries
  async getEarningsTrend(
    userId: string,
    period: 'weekly' | 'monthly' | 'yearly',
    PayoutModel: any
  ) {
    const now = new Date();
    const receiverMatch = buildReceiverMatch(userId);

    let groupBy: any;
    let sortBy: any;
    let dateRange: { start: Date; end: Date };
    let labelFormat: (date: Date, index?: number) => string;

    if (period === 'weekly') {
      // Last 12 weeks
      const startDate = new Date(now);
      startDate.setDate(now.getDate() - 11 * 7);
      startDate.setHours(0, 0, 0, 0);

      dateRange = { start: startDate, end: now };

      // ISO week avoids JS getWeekNumber mismatch
      groupBy = {
        year: { $isoWeekYear: '$createdAt' },
        week: { $isoWeek: '$createdAt' }
      };
      sortBy = { '_id.year': 1, '_id.week': 1 };

      labelFormat = (_date: Date, index: number = 0) => `Week ${index + 1}`;
    } else if (period === 'monthly') {
      const startDate = new Date(now.getFullYear(), 0, 1);
      const endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);

      dateRange = { start: startDate, end: endDate };

      groupBy = {
        year: { $year: '$createdAt' },
        month: { $month: '$createdAt' }
      };
      sortBy = { '_id.year': 1, '_id.month': 1 };

      const monthNames = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec'
      ];
      labelFormat = (date: Date) => monthNames[date.getMonth()];
    } else {
      // yearly: last 5 years
      const startDate = new Date(now.getFullYear() - 4, 0, 1);
      dateRange = { start: startDate, end: now };

      groupBy = { year: { $year: '$createdAt' } };
      sortBy = { '_id.year': 1 };

      labelFormat = (date: Date) => String(date.getFullYear());
    }

    const results = await PayoutModel.aggregate([
      {
        $match: {
          ...receiverMatch,
          status: { $in: ['PAID', 'PROCESSING', 'PENDING'] },
          createdAt: { $gte: dateRange.start, $lte: dateRange.end }
        }
      },
      {
        $group: {
          _id: groupBy,
          totalAmount: { $sum: { $ifNull: ['$netAmount', 0] } },
          count: { $sum: 1 }
        }
      },
      { $sort: sortBy }
    ]);

    return this.formatTrendData(results, period, now, labelFormat);
  },

  // keep your existing formatter but fix weekly matcher to ISO week
  formatTrendData(
    results: any[],
    period: 'weekly' | 'monthly' | 'yearly',
    now: Date,
    labelFormat: (date: Date, index?: number) => string
  ) {
    const dataPoints: Array<{ label: string; amount: number }> = [];

    if (period === 'weekly') {
      for (let i = 0; i < 12; i++) {
        const weekDate = new Date(now);
        weekDate.setDate(now.getDate() - (11 - i) * 7);

        // compute ISO week+year in JS to match Mongo isoWeek
        const { isoWeek, isoWeekYear } = getISOWeekParts(weekDate);

        const matchingData = results.find(
          r => r._id.week === isoWeek && r._id.year === isoWeekYear
        );

        dataPoints.push({
          label: labelFormat(weekDate, i),
          amount: matchingData ? matchingData.totalAmount / 100 : 0
        });
      }
    } else if (period === 'monthly') {
      // Generate all 12 months for current year
      for (let month = 0; month < 12; month++) {
        const monthDate = new Date(now.getFullYear(), month, 1);

        const matchingData = results.find(
          r => r._id.year === now.getFullYear() && r._id.month === month + 1
        );

        dataPoints.push({
          label: labelFormat(monthDate),
          amount: matchingData ? matchingData.totalAmount / 100 : 0
        });
      }
    } else {
      // Generate 5 years
      for (let i = 4; i >= 0; i--) {
        const yearDate = new Date(now.getFullYear() - i, 0, 1);

        const matchingData = results.find(r => r._id.year === yearDate.getFullYear());

        dataPoints.push({
          label: labelFormat(yearDate),
          amount: matchingData ? matchingData.totalAmount / 100 : 0
        });
      }
    }

    return dataPoints;
  },

  async transformPayoutData(payouts: any[]) {
    return payouts.map(payout => {
      const transaction = payout.transaction;
      const booking = transaction?.booking;
      const course = booking?.course;

      let lessonService = 'Unknown Service';
      let lessonType: string | undefined;

      if (course) {
        lessonService = course.title || 'Untitled Course';
        lessonType = course.lessonType;
      }

      return {
        _id: payout._id.toString(),
        date: payout.createdAt,
        lessonService,
        amount: payout.amount / 100, // Convert cents to dollars
        currency: payout.currency.toUpperCase(),
        status: payout.status,
        lessonType
      };
    });
  },

  async listPayouts(query: any) {
    const {
      toUser,
      lessonType,
      status,
      minAmount,
      maxAmount,
      startDate,
      endDate,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = query;

    const toUserObj = toObjectId(toUser);
    if (!toUserObj) {
      return {
        data: [],
        pagination: { total: 0, page, limit, totalPages: 0 }
      };
    }

    // Amount ranges (cents)
    const ranges: Record<string, { min: number; max: number }> = {
      '0-50': { min: 0, max: 5000 },
      '50-100': { min: 5000, max: 10000 },
      '100-200': { min: 10000, max: 20000 },
      '200+': { min: 20000, max: Number.MAX_SAFE_INTEGER }
    };

    const match: any = {
      $or: [
        { toUser: toUserObj }, // ✅ new payouts
        { 'metadata.raw.payoutReceiverId': toUser }, // ✅ old payouts (string)
        { 'metadata.schoolId': toUser } // ✅ new school payouts store schoolId as string
      ]
    };

    // Payment status filter
    if (status) match.status = status;

    if (minAmount || maxAmount) {
      if (minAmount === '200' && !maxAmount) {
        match.amount = { $gte: ranges['200+'].min };
      } else {
        const r = ranges[`${minAmount}-${maxAmount}`];
        if (r) match.amount = { $gte: r.min, $lte: r.max };
      }
    }

    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = new Date(startDate);
      if (endDate) match.createdAt.$lte = new Date(endDate);
    }

    const sortStage: any = { [sortBy]: sortOrder === 'asc' ? 1 : -1, _id: 1 };
    const skip = (page - 1) * limit;

    // ---- Pipeline ----
    const pipeline: any[] = [
      { $match: match },

      // join transaction -> booking -> course
      {
        $lookup: {
          from: 'transactions',
          localField: 'transaction',
          foreignField: '_id',
          as: 'tx'
        }
      },
      { $unwind: { path: '$tx', preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: 'bookings',
          localField: 'tx.booking',
          foreignField: '_id',
          as: 'booking'
        }
      },
      { $unwind: { path: '$booking', preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: 'courses',
          localField: 'booking.course',
          foreignField: '_id',
          as: 'course'
        }
      },
      { $unwind: { path: '$course', preserveNullAndEmptyArrays: true } }
    ];

    // Apply lessonType filter BEFORE pagination (fixes totals + pages)
    if (lessonType) {
      pipeline.push({ $match: { 'course.lessonType': lessonType } });
    }

    // total count (after all filters)
    const countPipeline = [...pipeline, { $count: 'total' }];

    // data query (sort + paginate + shape)
    pipeline.push(
      { $sort: sortStage },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          _id: 1,
          createdAt: 1,
          status: 1,
          currency: 1,
          amount: 1,
          toType: 1,
          toUser: 1,
          lessonService: { $ifNull: ['$course.title', 'Untitled Course'] },
          lessonType: '$course.lessonType'
        }
      }
    );

    const [rows, count] = await Promise.all([
      payoutModel.aggregate(pipeline),
      payoutModel.aggregate(countPipeline)
    ]);

    const total = count?.[0]?.total || 0;

    const data = rows.map((p: any) => ({
      _id: String(p._id),
      date: p.createdAt,
      lessonService: p.lessonService,
      amount: (p.amount || 0) / 100,
      currency: String(p.currency || '').toUpperCase(),
      status: p.status,
      lessonType: p.lessonType
    }));

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  },

  async getTotalPayoutsAfterCommission(userId: string, filters?: any) {
    const { startDate, endDate } = filters;

    const query: any = {
      'metadata.raw.payoutReceiverId': userId,
      status: 'PAID'
    };

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = startDate;
      if (endDate) query.createdAt.$lte = endDate;
    }

    const total = await payoutModel.countDocuments(query);

    const payouts = await payoutModel
      .find(query)
      .populate({
        path: 'transaction',
        select: 'downloadUrl reference'
      })
      .populate({
        path: 'invoice',
        select: 'invoiceNumber'
      })
      .sort({ createdAt: -1 })
      .lean();

    const formattedPayouts: any = payouts.map((payout: any) => ({
      _id: payout._id.toString(),
      invoiceNumber: payout.transaction.reference,
      date: payout.createdAt,
      amount: payout.netAmount,
      status: payout.status,
      downloadUrl: payout.transaction?.downloadUrl || `/api/payouts/${payout._id}/download`
    }));

    return {
      payouts: formattedPayouts,
      total
    };
  }
};
