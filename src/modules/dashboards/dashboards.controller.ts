import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { StudentDashboardService, teacherDashboardService } from './dashboards.service';

export const getDashboardStatsController = async (req: Request, res: Response): Promise<void> => {
  const teacherId = req.user?.id;

  const stats = await teacherDashboardService.getDashboardStats(teacherId as string);

  res.status(200).json({
    success: true,
    data: stats
  });
};

export const getWeeklySchedule = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { studentId } = req.params;

    if (!studentId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    // Parse query parameters
    let startDate: Date;
    let endDate: Date;

    if (req.query.startDate && req.query.endDate) {
      startDate = new Date(req.query.startDate as string);
      endDate = new Date(req.query.endDate as string);
    } else {
      // Default to current week
      const boundaries = StudentDashboardService.getWeekBoundaries();
      startDate = boundaries.start;
      endDate = boundaries.end;
    }

    // Validate dates
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format'
      });
    }

    if (startDate > endDate) {
      return res.status(400).json({
        success: false,
        error: 'Start date must be before end date'
      });
    }

    const schedule = await StudentDashboardService.getWeeklySchedule({
      studentId,
      startDate,
      endDate,
      timezone: req.query.timezone as string
    });

    return res.status(200).json({
      success: true,
      data: schedule
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch weekly schedule'
    });
  }
};
