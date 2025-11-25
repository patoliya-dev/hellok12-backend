import { Types } from 'mongoose';
import { FeedbackRating, IFeedbackRatingModel } from '../../models/feedbackRatings.model';
import { buildFilterQuery, buildSortQuery } from './feedbacks.helpers';

export const feedbackRatingsService = {
  getFeedbackRatings: async (params: {
    page: number;
    limit: number;
    rating?: number;
    sortBy: string;
    teacherId?: string;
    courseId?: string;
  }) => {
    const { page, limit, rating, sortBy, teacherId, courseId } = params;

    const filter = buildFilterQuery({ rating, teacherId, courseId });

    const sort = buildSortQuery(sortBy);

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      FeedbackRating.find(filter)
        .populate({
          path: 'author',
          select: 'name email',
          populate: { path: 'profileImage', select: 'url' }
        })
        .populate('lesson', 'title date')
        .populate('course', 'title subject')
        .populate('teacher', 'name')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      FeedbackRating.countDocuments(filter).exec()
    ]);

    return { data, total };
  },

  getFeedbackStats: async (teacherId: string) => {
    const stats = await FeedbackRating.aggregate([
      {
        $match: { teacher: new Types.ObjectId(teacherId) }
      },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalFeedback: { $sum: 1 }
        }
      }
    ]);

    const distribution = await FeedbackRating.aggregate([
      {
        $match: { teacher: new Types.ObjectId(teacherId) }
      },
      {
        $group: {
          _id: '$rating',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    const ratingDistribution: Record<number, number> = {};
    distribution.forEach(item => {
      ratingDistribution[item._id] = item.count;
    });

    return {
      averageRating: stats[0]?.averageRating || 0,
      totalFeedback: stats[0]?.totalFeedback || 0,
      ratingDistribution
    };
  }
};
