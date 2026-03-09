import { Request, Response } from 'express';
import { EarningsServiceV2 } from './earnings.service';

const isValidLegacyPeriod = (value?: string) =>
  ['weekly', 'monthly', 'yearly'].includes(String(value || '').toLowerCase());

export const EarningsControllerV2 = {
  /**
   * Summary endpoint for teacher/school earnings dashboard cards.
   * Keeps response backward-compatible while exposing new balance metrics.
   */
  getSummary: async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id as string;
      const role = req.user?.role as string;

      const summary = await EarningsServiceV2.getEarningsSummary({
        userId,
        role,
        timeZone: (req as any).userTimezone || 'UTC',
        range: req.query.range as string,
        from: req.query.from as string,
        to: req.query.to as string
      });

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

  getGraph: async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id as string;
      const role = req.user?.role as string;
      const requestedRange = req.query.range as string | undefined;

      const graph = await EarningsServiceV2.getEarningsGraph({
        userId,
        role,
        range: requestedRange,
        from: req.query.from as string,
        to: req.query.to as string,
        timeZone: (req as any).userTimezone || 'UTC'
      });

      return res.status(200).json({
        success: true,
        data: graph
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch earnings graph',
        error: error.message
      });
    }
  },

  getTrend: async (req: Request, res: Response) => {
    try {
      const period = (req.query.period as string) || 'weekly';
      if (!isValidLegacyPeriod(period)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid period. Must be weekly, monthly, or yearly'
        });
      }

      const userId = req.user?.id as string;
      const role = req.user?.role as string;
      const graph = await EarningsServiceV2.getEarningsGraph({
        userId,
        role,
        period: period as 'weekly' | 'monthly' | 'yearly',
        timeZone: (req as any).userTimezone || 'UTC'
      });

      return res.status(200).json({
        success: true,
        data: {
          period,
          range: graph.range,
          from: graph.from,
          to: graph.to,
          buckets: graph.buckets,
          dataPoints: graph.dataPoints
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

  listEarnings: async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id as string;
      const role = req.user?.role as string;

      const result = await EarningsServiceV2.listEarnings({
        userId,
        role,
        lessonType: req.query.lessonType as string,
        status: req.query.status as string,
        minAmount: req.query.minAmount as string,
        maxAmount: req.query.maxAmount as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 10,
        sortBy: (req.query.sortBy as string) || 'date',
        sortOrder: ((req.query.sortOrder as string) || 'desc') as 'asc' | 'desc',
        timeZone: (req as any).userTimezone || 'UTC'
      });

      return res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch earnings list',
        error: error.message
      });
    }
  },

  getPayoutAfterCommission: async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id as string;
      const result = await EarningsServiceV2.getTotalPayoutsAfterCommission({
        userId,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 10,
        timeZone: (req as any).userTimezone || 'UTC'
      });

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
