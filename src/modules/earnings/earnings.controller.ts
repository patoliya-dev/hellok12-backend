import { EarningsService } from './earnings.service';
import { Request, Response } from 'express';
import PayoutModel from '../../models/payout.model';
import payoutModel from '../../models/payout.model';

export const EarningsController = {
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

  getPayoutAfterCommission: async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const filters = req.query;

      const result = await EarningsService.getTotalPayoutsAfterCommission(
        userId as string,
        filters
      );

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch earnings commission',
        error: error.message
      });
    }
  }
};
