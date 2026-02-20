import { Request, Response } from 'express';
import { AdminService } from './admin.service';
import { createSuccessResponse, createErrorResponse } from '../../utils/apiResponse';

function handle(res: Response, error: any) {
  const status = error?.statusCode || 500;
  return res.status(status).json(createErrorResponse(error.message || 'Error', 'Error', status));
}

export const adminController = {
  getDashboardOverview: async (req: Request, res: Response) => {
    try {
      const data = await AdminService.getDashboardOverview({
        months: req.query.months ? String(req.query.months) : undefined
      });
      return res.status(200).json(createSuccessResponse(data, 'Dashboard overview fetched'));
    } catch (e: any) {
      return handle(res, e);
    }
  },

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

  getTeachers: async (req: Request, res: Response) => {
    try {
      const result = await AdminService.getTeachers({
        page: String(req.query.page || '1'),
        limit: String(req.query.limit || '10'),
        search: req.query.search ? String(req.query.search) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        school: req.query.school ? String(req.query.school) : undefined,
        experience: req.query.experience ? String(req.query.experience) : undefined,
        teacherType: req.query.teacherType ? String(req.query.teacherType) : 'school' // school | independent
      });

      return res.status(200).json(createSuccessResponse(result));
    } catch (e: any) {
      return res.status(e?.statusCode || 500).json(createErrorResponse(e?.message || 'Error', e));
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
  },

  getSchoolDetails: async (req: Request, res: Response) => {
    try {
      const { schoolId } = req.params;
      const data = await AdminService.getSchoolDetails(schoolId);
      return res.status(200).json(createSuccessResponse(data, 'School details fetched'));
    } catch (e: any) {
      return handle(res, e);
    }
  }
};
