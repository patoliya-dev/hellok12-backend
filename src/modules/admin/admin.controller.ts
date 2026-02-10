import { Request, Response } from 'express';
import { AdminService } from './admin.service';
import { createSuccessResponse, createErrorResponse } from '../../utils/apiResponse';

function handle(res: Response, error: any) {
  const status = error?.statusCode || 500;
  return res.status(status).json(createErrorResponse(error.message || 'Error', 'Error', status));
}

export const adminController = {
  getSchools: async (req: Request, res: Response) => {
    try {
      const { page = '1', limit = '50', search = '' } = req.query;

      const out = await AdminService.getSchools({
        page: String(page),
        limit: String(limit),
        search: String(search || '')
      });

      return res.status(200).json(createSuccessResponse(out, 'Schools fetched'));
    } catch (e: any) {
      return res
        .status(e.statusCode || 400)
        .json(createErrorResponse(e.message, 'failed get school'));
    }
  },

  getParents: async (req: Request, res: Response) => {
    try {
      const { page = '1', limit = '10', search = '', status = '', school = '' } = req.query as any;
      const out = await AdminService.getParents({ page, limit, search, status, school });
      return res.status(200).json(createSuccessResponse(out, 'Parents Fetched Successfully'));
    } catch (e: any) {
      return handle(res, e);
    }
  },

  updateUser: async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const out = await AdminService.updateUser(userId, req.body);
      return res.status(200).json(createSuccessResponse(out, 'User Updated Successfully'));
    } catch (e: any) {
      return handle(res, e);
    }
  }
};
