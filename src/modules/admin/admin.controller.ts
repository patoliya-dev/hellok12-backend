import { Request, Response } from 'express';
import { AdminService } from './admin.service';
import { createSuccessResponse, createErrorResponse } from '../../utils/apiResponse';

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
  }
};
