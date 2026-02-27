import { Response } from 'express';
import { AuthenticatedRequest } from '../../../middlewares/auth';
import { createErrorResponse, createSuccessResponse } from '../../../utils/apiResponse';
import { payoutService } from './payout.service';

const unauthorized = (res: Response) =>
  res.status(401).json(createErrorResponse('Authentication required', 'Unauthorized', 401));

const handleError = (res: Response, error: any) => {
  const statusCode = Number(error?.statusCode || 500);
  return res
    .status(statusCode)
    .json(
      createErrorResponse(error?.message || 'Failed to process payout request', 'Error', statusCode)
    );
};

export const payoutController = {
  async preview(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return unauthorized(res);
      const body = (req as any).validatedBody || req.body;
      const data = await payoutService.previewPayout(body);
      return res.status(200).json(createSuccessResponse(data, 'Payout preview generated'));
    } catch (error: any) {
      return handleError(res, error);
    }
  },

  async create(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return unauthorized(res);
      const body = (req as any).validatedBody || req.body;
      const data = await payoutService.createPayout({
        ...body,
        createdBy: req.user.id
      });
      return res.status(201).json(createSuccessResponse(data, 'Payout created'));
    } catch (error: any) {
      return handleError(res, error);
    }
  },

  async list(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return unauthorized(res);
      const query = (req as any).validatedQuery || req.query;
      const data = await payoutService.listPayouts({
        page: Number(query.page || 1),
        limit: Number(query.limit || 10),
        search: query.search,
        payeeType: query.payeeType,
        payeeId: query.payeeId,
        status: query.status,
        from: query.from,
        to: query.to
      });

      return res.status(200).json(createSuccessResponse(data, 'Payouts fetched'));
    } catch (error: any) {
      return handleError(res, error);
    }
  },

  async getById(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return unauthorized(res);
      const params = (req as any).validatedParams || req.params;
      const data = await payoutService.getPayoutById(params.id);
      return res.status(200).json(createSuccessResponse(data, 'Payout fetched'));
    } catch (error: any) {
      return handleError(res, error);
    }
  },

  async approve(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return unauthorized(res);
      const params = (req as any).validatedParams || req.params;
      const data = await payoutService.approvePayout(params.id);
      return res.status(200).json(createSuccessResponse(data, 'Payout approved'));
    } catch (error: any) {
      return handleError(res, error);
    }
  },

  async markPaid(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return unauthorized(res);
      const params = (req as any).validatedParams || req.params;
      const body = (req as any).validatedBody || req.body;

      const data = await payoutService.markPaid(params.id, {
        paymentRef: body.paymentRef,
        paidAt: body.paidAt,
        note: body.note,
        paidBy: req.user.id
      });

      return res.status(200).json(createSuccessResponse(data, 'Payout marked as paid'));
    } catch (error: any) {
      return handleError(res, error);
    }
  },

  async cancel(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return unauthorized(res);
      const params = (req as any).validatedParams || req.params;
      const body = (req as any).validatedBody || req.body;

      const data = await payoutService.cancelPayout(params.id, body?.note);
      return res.status(200).json(createSuccessResponse(data, 'Payout cancelled'));
    } catch (error: any) {
      return handleError(res, error);
    }
  },

  async download(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return unauthorized(res);
      const params = (req as any).validatedParams || req.params;
      const data = await payoutService.getPayoutReportPdf(params.id);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${data.fileName}"`);
      return res.status(200).send(data.buffer);
    } catch (error: any) {
      return handleError(res, error);
    }
  }
};
