import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth';
import { createErrorResponse, createSuccessResponse } from '../../utils/apiResponse';
import { payoutAccountService } from './payoutAccount.service';

const unauthorized = (res: Response) =>
  res.status(401).json(createErrorResponse('Authentication required', 'Unauthorized', 401));

const handleError = (res: Response, error: any) => {
  const statusCode = Number(error?.statusCode || 500);
  return res
    .status(statusCode)
    .json(
      createErrorResponse(
        error?.message || 'Failed to process payout account request',
        'Error',
        statusCode
      )
    );
};

export const payoutAccountController = {
  async getMe(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user?.id) return unauthorized(res);
      const data = await payoutAccountService.getMyAccount(req.user.id);
      return res.status(200).json(createSuccessResponse(data, 'Payout account fetched'));
    } catch (error: any) {
      return handleError(res, error);
    }
  },

  async createMe(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user?.id) return unauthorized(res);
      const body = (req as any).validatedBody || req.body;
      const data = await payoutAccountService.createMyAccount(req.user.id, body);
      return res.status(201).json(createSuccessResponse(data, 'Payout account created'));
    } catch (error: any) {
      return handleError(res, error);
    }
  },

  async patchMe(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user?.id) return unauthorized(res);
      const body = (req as any).validatedBody || req.body;
      const data = await payoutAccountService.patchMyAccount(req.user.id, body);
      return res.status(200).json(createSuccessResponse(data, 'Payout account updated'));
    } catch (error: any) {
      return handleError(res, error);
    }
  },

  async deleteMe(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user?.id) return unauthorized(res);
      const data = await payoutAccountService.deleteMyAccount(req.user.id);
      return res.status(200).json(createSuccessResponse(data, 'Payout account deleted'));
    } catch (error: any) {
      return handleError(res, error);
    }
  },

  async listAdmin(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user?.id) return unauthorized(res);
      const query = (req as any).validatedQuery || req.query;
      const data = await payoutAccountService.listAdmin({
        ownerType: query.ownerType,
        status: query.status,
        q: query.q,
        page: Number(query.page || 1),
        limit: Number(query.limit || 10)
      });
      return res.status(200).json(createSuccessResponse(data, 'Payout accounts fetched'));
    } catch (error: any) {
      return handleError(res, error);
    }
  },

  async getAdminById(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user?.id) return unauthorized(res);
      const params = (req as any).validatedParams || req.params;
      const data = await payoutAccountService.getAdminById(params.id);
      return res.status(200).json(createSuccessResponse(data, 'Payout account fetched'));
    } catch (error: any) {
      return handleError(res, error);
    }
  },

  async verifyAdmin(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user?.id) return unauthorized(res);
      const params = (req as any).validatedParams || req.params;
      const data = await payoutAccountService.verifyByAdmin(params.id, req.user.id);
      return res.status(200).json(createSuccessResponse(data, 'Payout account verified'));
    } catch (error: any) {
      return handleError(res, error);
    }
  },

  async rejectAdmin(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user?.id) return unauthorized(res);
      const params = (req as any).validatedParams || req.params;
      const body = (req as any).validatedBody || req.body;
      const data = await payoutAccountService.rejectByAdmin(params.id, req.user.id, body.reason);
      return res.status(200).json(createSuccessResponse(data, 'Payout account rejected'));
    } catch (error: any) {
      return handleError(res, error);
    }
  }
};
