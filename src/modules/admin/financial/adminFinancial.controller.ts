import { Request, Response } from 'express';
import { adminFinancialService } from './adminFinancial.service';
import { createErrorResponse, createSuccessResponse } from '../../../utils/apiResponse';

type PeriodQuery = 'weekly' | 'monthly' | 'yearly';
type TrendTab = 'payout' | 'revenue' | 'commission';
type SortOrder = 'asc' | 'desc';

const VALID_PERIODS: PeriodQuery[] = ['weekly', 'monthly', 'yearly'];
const VALID_TABS: TrendTab[] = ['payout', 'revenue', 'commission'];

function toSafeSortOrder(v?: string): SortOrder | undefined {
  if (!v) return undefined;
  const value = String(v).toLowerCase();
  if (value === 'asc' || value === 'desc') return value;
  return undefined;
}

function handle(res: Response, error: any) {
  const status = error?.statusCode || 500;
  return res.status(status).json(createErrorResponse(error.message || 'Error', 'Error', status));
}

export const adminFinancialController = {
  getSummary: async (req: Request, res: Response) => {
    try {
      const period = String(req.query.period || 'weekly');
      if (!VALID_PERIODS.includes(period as PeriodQuery)) {
        return res
          .status(400)
          .json(
            createErrorResponse('Invalid period. Must be weekly, monthly, or yearly', 'Error', 400)
          );
      }
      const data = await adminFinancialService.getSummary({ period: period as PeriodQuery });
      return res.status(200).json(createSuccessResponse(data, 'Fetched'));
    } catch (e: any) {
      return handle(res, e);
    }
  },

  getTrend: async (req: Request, res: Response) => {
    try {
      const tab = String(req.query.tab || 'payout');
      const period = String(req.query.period || 'weekly');
      if (!VALID_TABS.includes(tab as TrendTab)) {
        return res
          .status(400)
          .json(
            createErrorResponse('Invalid tab. Must be payout, revenue, or commission', 'Error', 400)
          );
      }
      if (!VALID_PERIODS.includes(period as PeriodQuery)) {
        return res
          .status(400)
          .json(
            createErrorResponse('Invalid period. Must be weekly, monthly, or yearly', 'Error', 400)
          );
      }
      const data = await adminFinancialService.getTrend({
        tab: tab as TrendTab,
        period: period as PeriodQuery
      });
      return res.status(200).json(createSuccessResponse(data, 'Fetched'));
    } catch (e: any) {
      return handle(res, e);
    }
  },

  listPayouts: async (req: Request, res: Response) => {
    try {
      const data = await adminFinancialService.listPayouts({
        page: String(req.query.page || '1'),
        limit: String(req.query.limit || '10'),
        search: String(req.query.search || ''),
        sortBy: req.query.sortBy ? String(req.query.sortBy) : undefined,
        sortOrder: toSafeSortOrder(req.query.sortOrder ? String(req.query.sortOrder) : undefined),
        startDate: req.query.startDate ? String(req.query.startDate) : undefined,
        endDate: req.query.endDate ? String(req.query.endDate) : undefined
      });
      return res.status(200).json(createSuccessResponse(data, 'Fetched'));
    } catch (e: any) {
      return handle(res, e);
    }
  },

  listRevenue: async (req: Request, res: Response) => {
    try {
      const data = await adminFinancialService.listRevenue({
        page: String(req.query.page || '1'),
        limit: String(req.query.limit || '10'),
        search: String(req.query.search || ''),
        sortBy: req.query.sortBy ? String(req.query.sortBy) : undefined,
        sortOrder: toSafeSortOrder(req.query.sortOrder ? String(req.query.sortOrder) : undefined),
        startDate: req.query.startDate ? String(req.query.startDate) : undefined,
        endDate: req.query.endDate ? String(req.query.endDate) : undefined
      });
      return res.status(200).json(createSuccessResponse(data, 'Fetched'));
    } catch (e: any) {
      return handle(res, e);
    }
  },

  downloadRevenueReport: async (req: Request, res: Response) => {
    try {
      const data = await adminFinancialService.getRevenueReportPdf({
        courseId: String(req.params.courseId || ''),
        startDate: req.query.startDate ? String(req.query.startDate) : undefined,
        endDate: req.query.endDate ? String(req.query.endDate) : undefined
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${data.fileName}"`);
      return res.status(200).send(data.buffer);
    } catch (e: any) {
      return handle(res, e);
    }
  },

  downloadCommissionReport: async (req: Request, res: Response) => {
    try {
      const data = await adminFinancialService.getCommissionReportPdf({
        courseId: String(req.params.courseId || ''),
        startDate: req.query.startDate ? String(req.query.startDate) : undefined,
        endDate: req.query.endDate ? String(req.query.endDate) : undefined
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${data.fileName}"`);
      return res.status(200).send(data.buffer);
    } catch (e: any) {
      return handle(res, e);
    }
  },

  listCommission: async (req: Request, res: Response) => {
    try {
      const data = await adminFinancialService.listCommission({
        page: String(req.query.page || '1'),
        limit: String(req.query.limit || '10'),
        search: String(req.query.search || ''),
        sortBy: req.query.sortBy ? String(req.query.sortBy) : undefined,
        sortOrder: toSafeSortOrder(req.query.sortOrder ? String(req.query.sortOrder) : undefined),
        startDate: req.query.startDate ? String(req.query.startDate) : undefined,
        endDate: req.query.endDate ? String(req.query.endDate) : undefined
      });
      return res.status(200).json(createSuccessResponse(data, 'Fetched'));
    } catch (e: any) {
      return handle(res, e);
    }
  }
};
