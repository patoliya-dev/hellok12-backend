import { Request, Response, NextFunction } from 'express';
import { FindTeacherService } from './findTeacher.service';
import Logger from '../../utils/winstonLogger.utils';
import { getTeacherFilters } from './findTeacher.helper';

export const FindTeacherController = {
  async listSchools(req: Request, res: Response, next: NextFunction) {
    try {
      const schools = await FindTeacherService.listSchools();

      return res.status(200).json({
        message: 'Schools fetched successfully',
        success: true,
        data: schools
      });
    } catch (error: any) {
      Logger.error('Error fetching schools:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch schools',
        error: error.message
      });
    }
  },

  async findTeachers(req: Request, res: Response, next: NextFunction) {
    try {
      const { filters, pagination } = getTeacherFilters(req.query);

      const result = await FindTeacherService.list(filters, pagination);

      return res.status(200).json({
        message: 'Teachers fetched successfully',
        success: true,
        data: result.data,
        count: result.count,
        nextOffset: result.nextOffset
      });
    } catch (error: any) {
      Logger.error('Error fetching teachers:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch teachers',
        error: error.message
      });
    }
  },

  async getTeacher(req: Request, res: Response, next: NextFunction) {
    try {
      const { teacherId } = req.params;

      if (!teacherId) {
        return res.status(400).json({
          success: false,
          message: 'Invalid teacherId',
          error: 'Invalid teacherId'
        });
      }

      const teacher = await FindTeacherService.get(teacherId);

      return res.status(200).json({
        success: true,
        message: 'Teacher fetched successfully',
        data: teacher
      });
    } catch (error: any) {
      Logger.error('Error fetching teacher:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch teacher',
        error: error.message
      });
    }
  }
};
