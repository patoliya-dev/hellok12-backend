import { Request, Response } from 'express';
import { StudentDashboardService, teacherDashboardService } from './dashboards.service';
import { getWeekRangeFromISO, normalizeTimezone } from '../lessons/lesson.util';

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
      // Use shared helper to normalize dates
      const weekRange = getWeekRangeFromISO(req.query.startDate as string);
      startDate = weekRange.start;
      endDate = weekRange.end;
    } else {
      // Default current week
      const weekRange = getWeekRangeFromISO();
      startDate = weekRange.start;
      endDate = weekRange.end;
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

    const rawTz = req.userTimezone || 'UTC';
    const timezone = normalizeTimezone(rawTz);

    const schedule = await StudentDashboardService.getWeeklySchedule({
      studentId,
      startDate,
      endDate,
      timezone
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
