import { Request, Response } from 'express';
import {
  StudentDashboardService,
  teacherDashboardService,
  SchoolDashboardService
} from './dashboards.service';
import { getWeekRangeFromISO, normalizeTimezone } from '../lessons/lesson.util';
import { AuthenticatedRequest } from '../../middlewares/auth';
import { createErrorResponse, createSuccessResponse } from '../../utils/apiResponse';

export const getSchoolMetrics = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schoolId = req.user?.id;
    if (!schoolId) {
      return res.status(401).json(createErrorResponse('Unauthorized', 'Unauthorized', 401));
    }

    const rawTz = req.userTimezone || 'UTC';
    const timeZone = normalizeTimezone(rawTz);

    const data = await SchoolDashboardService.getSchoolMetrics({
      schoolId,
      timeZone
    });

    return res.json(createSuccessResponse(data, 'School metrics', 200));
  } catch (e: any) {
    return res
      .status(500)
      .json(createErrorResponse('Failed to load school metrics', 'Internal Server Error', 500));
  }
};

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
