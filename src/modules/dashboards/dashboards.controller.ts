import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { teacherDashboardService } from './dashboards.service';

export const getDashboardStatsController = async (req: Request, res: Response): Promise<void> => {
  const teacherId = req.user?.id;

  const stats = await teacherDashboardService.getDashboardStats(teacherId as string);

  res.status(200).json({
    success: true,
    data: stats
  });
};
