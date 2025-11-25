import { Request, Response, NextFunction } from 'express';
import { FeedbackQueryParams, FeedbackResponse, PaginationMeta } from '../../types/FeedbackTypes';
import { IFeedbackRatingModel } from '../../models/feedbackRatings.model';
import { feedbackRatingsService } from './feedbacks.service';
import { Types } from 'mongoose';
import { createErrorResponse } from '../../utils/apiResponse';

export const feedbackRatingsController = {
  getFeedbackRatings: async (
    req: Request<object, object, object, FeedbackQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const page = Math.max(1, parseInt(req.query.page || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '10', 10)));
      const rating = req.query.rating ? parseInt(req.query.rating, 10) : undefined;
      const sortBy = req.query.sortBy || 'newest';
      const teacherId = req.user?.id;
      const courseId = req.query.courseId;

      if (rating !== undefined && (rating < 1 || rating > 5)) {
        res.status(400).json({
          success: false,
          error: 'Rating must be between 1 and 5'
        });
        return;
      }

      const validSortOptions = ['newest', 'oldest', 'highest', 'lowest'];
      if (!validSortOptions.includes(sortBy)) {
        res.status(400).json({
          success: false,
          error: 'Invalid sort option'
        });
        return;
      }

      const { data, total } = await feedbackRatingsService.getFeedbackRatings({
        page,
        limit,
        rating,
        sortBy,
        teacherId,
        courseId
      });

      const totalPages = Math.ceil(total / limit);
      const meta: PaginationMeta = {
        currentPage: page,
        totalPages,
        totalItems: total,
        itemsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      };

      const response: any = {
        success: true,
        data,
        meta
      };

      res.status(200).json(response);
    } catch (error: any) {
      res.status(500).json(createErrorResponse(error));
    }
  },

  getFeedbackStats: async (req: Request<{ teacherId: string }>, res: Response): Promise<void> => {
    try {
      const { teacherId } = req.params;

      if (!Types.ObjectId.isValid(teacherId)) {
        res.status(400).json({
          success: false,
          error: 'Invalid teacher ID'
        });
        return;
      }

      const stats = await feedbackRatingsService.getFeedbackStats(teacherId);

      res.status(200).json({
        success: true,
        data: stats
      });
    } catch (error: any) {
      res.status(500).json(createErrorResponse(error));
    }
  }
};
