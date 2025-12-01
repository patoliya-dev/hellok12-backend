// controllers/progress.controller.ts

import { Request, Response, NextFunction } from 'express';
import { ProgressService } from './progress.service';
import { createErrorResponse } from '../../utils/apiResponse';
import { TimeRangeFilter } from '../../types/ProgressTypes';

export const ProgressController = {
  async getUserProgress(req: Request, res: Response, next: NextFunction) {
    try {
      const { studentId } = req.params;

      if (!studentId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized'
        });
      }

      const progress = await ProgressService.getUserProgress(studentId);

      return res.status(200).json({
        success: true,
        data: progress
      });
    } catch (error: any) {
      return res
        .status(500)
        .json(createErrorResponse(error, error.message || 'Internal Server Error', 500));
    }
  },

  async getCourseProgress(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      const { courseId } = req.params;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized'
        });
      }

      if (!courseId) {
        return res.status(400).json({
          success: false,
          message: 'Course ID is required'
        });
      }

      const progress = await ProgressService.getCourseProgress(userId, courseId);

      return res.status(200).json({
        success: true,
        data: progress
      });
    } catch (error: any) {
      if (error instanceof Error && error.message === 'Course not found') {
        return res.status(404).json({
          success: false,
          message: 'Course not found'
        });
      }
      return res
        .status(500)
        .json(createErrorResponse(error, error.message || 'Internal Server Error', 500));
    }
  },

  async getCourseLessonDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      const { courseId } = req.params;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized'
        });
      }

      if (!courseId) {
        return res.status(400).json({
          success: false,
          message: 'Course ID is required'
        });
      }

      const lessons = await ProgressService.getCourseLessonDetails(userId, courseId);

      return res.status(200).json({
        success: true,
        data: lessons
      });
    } catch (error: any) {
      return res
        .status(500)
        .json(createErrorResponse(error, error.message || 'Internal Server Error', 500));
    }
  },

  async getMultipleCourseProgress(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      const { courseIds } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized'
        });
      }

      if (!Array.isArray(courseIds) || courseIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Course IDs array is required'
        });
      }

      const progress = await ProgressService.getMultipleCourseProgress(userId, courseIds);

      return res.status(200).json({
        success: true,
        data: progress
      });
    } catch (error: any) {
      return res
        .status(500)
        .json(createErrorResponse(error, error.message || 'Internal Server Error', 500));
    }
  },

  async getWeeklyStats(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized'
        });
      }

      const stats = await ProgressService.getWeeklyStats(userId);

      return res.status(200).json({
        success: true,
        data: stats
      });
    } catch (error: any) {
      return res
        .status(500)
        .json(createErrorResponse(error, error.message || 'Internal Server Error', 500));
    }
  },

  async getDashboardData(req: Request, res: Response, next: NextFunction) {
    try {
      const { studentId } = req.params;

      if (!studentId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized'
        });
      }

      const [progress, weeklyStats] = await Promise.all([
        ProgressService.getUserProgress(studentId),
        ProgressService.getWeeklyStats(studentId)
      ]);

      return res.status(200).json({
        success: true,
        data: {
          progress,
          weeklyStats
        }
      });
    } catch (error: any) {
      return res
        .status(500)
        .json(createErrorResponse(error, error.message || 'Internal Server Error', 500));
    }
  },

  async getAnalyticsDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const { studentId } = req.params;

      if (!studentId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized'
        });
      }

      // Parse query parameters for filtering
      const filter: TimeRangeFilter = {};

      if (req.query.period) {
        filter.period = req.query.period as TimeRangeFilter['period'];
      }

      if (req.query.startDate) {
        filter.startDate = new Date(req.query.startDate as string);
      }

      if (req.query.endDate) {
        filter.endDate = new Date(req.query.endDate as string);
      }

      const courseId = req.query.courseId as string | undefined;

      const analytics = await ProgressService.getAnalyticsDashboard(studentId, filter, courseId);

      return res.status(200).json({
        success: true,
        data: analytics
      });
    } catch (error) {
      next(error);
    }
  }
};
