import { EarningsService } from './earnings.service';
import { Request, Response } from 'express';
import PayoutModel from '../../models/payout.model';
import payoutModel from '../../models/payout.model';

export const EarningsController = {
  // Get earnings summary
  getSummary: async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id as string;

      const summary = await EarningsService.getEarningsSummary(userId, PayoutModel);

      return res.status(200).json({
        success: true,
        data: summary
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch earnings summary',
        error: error.message
      });
    }
  },

  // Get earnings breakdown for a specific period
  getBreakdown: async (req: any, res: any) => {
    try {
      const userId = req.user._id;
      const { Payout } = req.models;
      const { period = 'month' } = req.query;

      const ranges = EarningsService.getDateRanges();
      let startDate: Date, endDate: Date;

      switch (period) {
        case 'week':
          startDate = ranges.thisWeek.startDate;
          endDate = ranges.thisWeek.endDate;
          break;
        case 'month':
          startDate = ranges.thisMonth.startDate;
          endDate = ranges.thisMonth.endDate;
          break;
        case 'year':
          startDate = ranges.thisYear.startDate;
          endDate = ranges.thisYear.endDate;
          break;
        default:
          return res.status(400).json({
            success: false,
            message: 'Invalid period. Must be week, month, or year'
          });
      }

      const breakdown = await EarningsService.getEarningsBreakdown(
        userId,
        startDate,
        endDate,
        Payout
      );

      return res.status(200).json({
        success: true,
        data: {
          period,
          startDate,
          endDate,
          transactions: breakdown
        }
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch earnings breakdown',
        error: error.message
      });
    }
  },

  // Get earnings for custom date range
  getCustomRange: async (req: any, res: any) => {
    try {
      const userId = req.user._id;
      const { Payout } = req.models;
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: 'startDate and endDate are required'
        });
      }

      const start = new Date(startDate);
      const end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format'
        });
      }

      const earnings = await EarningsService.calculateEarnings(userId, start, end, Payout);
      const breakdown = await EarningsService.getEarningsBreakdown(userId, start, end, Payout);

      return res.status(200).json({
        success: true,
        data: {
          totalEarnings: earnings,
          startDate: start,
          endDate: end,
          transactions: breakdown
        }
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch earnings for custom range',
        error: error.message
      });
    }
  },

  // Get earnings trend data for charts
  getTrend: async (req: Request, res: Response) => {
    try {
      const userId = req?.user?.id;
      const { period = 'weekly', optimized = 'true' } = req.query;

      if (!['weekly', 'monthly', 'yearly'].includes(period as string)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid period. Must be weekly, monthly, or yearly'
        });
      }

      const trendData = await EarningsService.getEarningsTrend(
        userId as string,
        period as 'weekly' | 'monthly' | 'yearly',
        payoutModel
      );

      return res.status(200).json({
        success: true,
        data: {
          period,
          dataPoints: trendData
        }
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch earnings trend',
        error: error.message
      });
    }
  },

  listPayouts: async (req: Request, res: Response) => {
    try {
      const toUser = req.user?.id as string;

      if (!toUser) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required'
        });
      }

      // Build query object
      const query: any = {
        toUser,
        lessonType: req.query.lessonType as any,
        status: req.query.status as any,
        minAmount: req.query.minAmount as any,
        maxAmount: req.query?.maxAmount as any,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 10,
        sortBy: (req.query.sortBy as string) || 'createdAt',
        sortOrder: (req.query.sortOrder as 'asc' | 'desc') || 'desc'
      };

      const result = await EarningsService.listPayouts(query);

      return res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch earnings',
        error: error.message
      });
    }
  },

  // GET /api/payouts/stats
  getPayoutStats: async (req: Request, res: Response) => {
    try {
      const toUser = req.user?.id || (req.query.toUser as string);

      if (!toUser) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required'
        });
      }

      const stats = await EarningsService.getPayoutStats(toUser);

      return res.status(200).json({
        success: true,
        data: stats
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch payout stats',
        error: (error as Error).message
      });
    }
  },

  async convertToCSV(data: any[]) {
    if (data.length === 0) return '';

    const headers = ['Date', 'Lesson/Service', 'Amount'];
    const rows = data.map(item => [
      new Date(item.date).toLocaleDateString(),
      item.lessonService,
      `$${item.amount.toFixed(2)}`
    ]);

    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');

    return csvContent;
  },

  // Export payouts as CSV
  async exportPayouts(req: Request, res: Response) {
    try {
      const toUser = req.user?.id || req.body.toUser;

      if (!toUser) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required'
        });
      }

      // Build query without pagination for export
      const query: any = {
        toUser,
        lessonType: req.body.lessonType,
        paymentStatus: req.body.paymentStatus,
        amountRange: req.body.amountRange,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        page: 1,
        limit: 10000, // Large limit for export
        sortBy: 'createdAt',
        sortOrder: 'desc'
      };

      const result = await EarningsService.listPayouts(query);

      // Convert to CSV
      const csv = this.convertToCSV(result.data);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=payouts.csv');

      return res.status(200).send(csv);
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to export payouts',
        error: error.message
      });
    }
  }
};
