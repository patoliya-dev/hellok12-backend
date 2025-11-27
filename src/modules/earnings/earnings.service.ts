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

interface IDateRange {
  startDate: Date;
  endDate: Date;
}

function getWeekNumber(date: Date) {
  const temp = new Date(date);
  temp.setHours(0, 0, 0, 0);

  // Week starts on Sunday → same as MongoDB `$week`
  const firstDayOfYear = new Date(temp.getFullYear(), 0, 1);
  const pastDaysOfYear = (temp.getTime() - firstDayOfYear.getTime()) / 86400000;

  return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

export const EarningsService = {
  // Get date ranges for various periods
  getDateRanges(): {
    thisWeek: IDateRange;
    lastWeek: IDateRange;
    thisMonth: IDateRange;
    lastMonth: IDateRange;
    thisYear: IDateRange;
    lastYear: IDateRange;
  } {
    const now = new Date();

    // This Week (Monday to Sunday)
    const currentDay = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (currentDay === 0 ? 6 : currentDay - 1));
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    // Last Week
    const lastMonday = new Date(monday);
    lastMonday.setDate(monday.getDate() - 7);

    const lastSunday = new Date(sunday);
    lastSunday.setDate(sunday.getDate() - 7);

    // This Month
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Last Month
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    // This Year
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);

    // Last Year
    const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);
    const lastYearEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);

    return {
      thisWeek: { startDate: monday, endDate: sunday },
      lastWeek: { startDate: lastMonday, endDate: lastSunday },
      thisMonth: { startDate: monthStart, endDate: monthEnd },
      lastMonth: { startDate: lastMonthStart, endDate: lastMonthEnd },
      thisYear: { startDate: yearStart, endDate: yearEnd },
      lastYear: { startDate: lastYearStart, endDate: lastYearEnd }
    };
  },

  // Calculate total earnings for a date range
  async calculateEarnings(
    userId: string,
    startDate: Date,
    endDate: Date,
    PayoutModel: any
  ): Promise<number> {
    const result = await PayoutModel.aggregate([
      {
        $match: {
          'metadata.raw.payoutReceiverId': userId,
          status: { $in: ['PAID', 'PROCESSING', 'PENDING'] },
          createdAt: {
            $gte: startDate,
            $lte: endDate
          }
        }
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$netAmount' }
        }
      }
    ]);

    return result.length > 0 ? result[0].totalAmount / 100 : 0; // Convert cents to dollars
  },

  // Calculate percentage change between two periods
  calculatePercentageChange(current: number, previous: number): number {
    if (previous === 0) {
      return current > 0 ? 100 : 0;
    }
    return Number((((current - previous) / previous) * 100).toFixed(1));
  },

  // Get earnings summary for a teacher
  async getEarningsSummary(userId: string, PayoutModel: any): Promise<IEarningsSummary> {
    const ranges = this.getDateRanges();

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
        percentageChange: this.calculatePercentageChange(thisWeekEarnings, lastWeekEarnings),
        comparisonPeriod: 'vs previous week'
      },
      thisMonth: {
        amount: thisMonthEarnings,
        percentageChange: this.calculatePercentageChange(thisMonthEarnings, lastMonthEarnings),
        comparisonPeriod: 'vs previous month'
      },
      thisYear: {
        amount: thisYearEarnings,
        percentageChange: this.calculatePercentageChange(thisYearEarnings, lastYearEarnings),
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
    let groupBy: any;
    let dateRange: { start: Date; end: Date };
    let labelFormat: any;

    if (period === 'weekly') {
      // Last 12 weeks
      const startDate = new Date(now);
      startDate.setDate(now.getDate() - 11 * 7);
      startDate.setHours(0, 0, 0, 0);

      dateRange = { start: startDate, end: now };

      groupBy = {
        year: { $year: '$createdAt' },
        week: { $week: '$createdAt' }
      };

      labelFormat = (date: Date, index: number) => `Week ${index + 1}`;
    } else if (period === 'monthly') {
      // Current year only (Jan to current month or Dec)
      const startDate = new Date(now.getFullYear(), 0, 1);
      const endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);

      dateRange = { start: startDate, end: endDate };

      groupBy = {
        year: { $year: '$createdAt' },
        month: { $month: '$createdAt' }
      };

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
      // Last 5 years
      const startDate = new Date(now.getFullYear() - 4, 0, 1);

      dateRange = { start: startDate, end: now };

      groupBy = {
        year: { $year: '$createdAt' }
      };

      labelFormat = (date: Date) => date.getFullYear().toString();
    }

    const results = await PayoutModel.aggregate([
      {
        $match: {
          'metadata.raw.payoutReceiverId': userId,
          status: { $in: ['PAID', 'PROCESSING', 'PENDING'] },
          createdAt: {
            $gte: dateRange.start,
            $lte: dateRange.end
          }
        }
      },
      {
        $group: {
          _id: groupBy,
          totalAmount: { $sum: '$netAmount' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.week': 1 }
      }
    ]);

    // Format results into chart-friendly data
    const dataPoints = this.formatTrendData(results, period, now, labelFormat);

    return dataPoints;
  },

  // Format aggregated data into chart-friendly format
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

        const matchingData = results.find(r => {
          const week = getWeekNumber(weekDate);
          const year = weekDate.getFullYear();

          return r._id.week === week && r._id.year === year;
        });

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

    // Build filter query
    const filter: any = {
      'metadata.raw.payoutReceiverId': toUser
    };

    // Payment status filter
    if (status) {
      filter.status = status;
    }

    // Amount range filter (convert to cents)
    if (minAmount || maxAmount) {
      const ranges: Record<string, { min: number; max: number }> = {
        '0-50': { min: 0, max: 5000 },
        '50-100': { min: 5000, max: 10000 },
        '100-200': { min: 10000, max: 15000 },
        '200+': { min: 20000, max: Number.MAX_SAFE_INTEGER }
      };
      if (minAmount === '200' && !maxAmount) {
        filter.amount = { $gte: ranges['200+'].min };
      } else {
        const range = ranges[`${minAmount}-${maxAmount}`];
        filter.amount = { $gte: range.min, $lte: range.max };
      }
    }

    // Date range filter
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        filter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        filter.createdAt.$lte = new Date(endDate);
      }
    }

    // Calculate pagination
    const skip = (page - 1) * limit;
    const sortOptions: any = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;
    // Execute query with population
    const payouts = await payoutModel
      .find(filter)
      .populate({
        path: 'transaction',
        select: '_id',
        populate: {
          path: 'booking',
          select: '_id',
          populate: {
            path: 'course',
            select: 'title lessonType'
          }
        }
      })
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .lean();

    // Get total count
    const total = await payoutModel.countDocuments(filter);

    // Transform data and apply lesson type filter
    let transformedData = await this.transformPayoutData(payouts);

    // Add null check here
    if (!transformedData) {
      transformedData = [];
    }

    // Filter by lesson type if specified
    if (lessonType) {
      transformedData = transformedData.filter((item: any) => item.lessonType === lessonType);
    }

    // Recalculate pagination after client-side filtering
    const filteredTotal = lessonType ? transformedData.length : total;
    const totalPages = Math.ceil(filteredTotal / limit);

    return {
      data: transformedData,
      pagination: {
        total: filteredTotal,
        page,
        limit,
        totalPages
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
