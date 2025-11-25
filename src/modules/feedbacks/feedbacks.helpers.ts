import { Types } from 'mongoose';

export const buildFilterQuery = (params: {
  rating?: number;
  teacherId?: string;
  courseId?: string;
}): Record<string, any> => {
  const filter: Record<string, any> = {};

  if (params.rating && params.rating >= 1 && params.rating <= 5) {
    filter.rating = params.rating;
  }

  if (params.teacherId) {
    filter.teacher = new Types.ObjectId(params.teacherId);
  }

  if (params.courseId) {
    filter.course = new Types.ObjectId(params.courseId);
  }

  return filter;
};

export const buildSortQuery = (sortBy: string) => {
  const sortMap: Record<string, Record<string, 1 | -1>> = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    highest: { rating: -1, createdAt: -1 },
    lowest: { rating: 1, createdAt: -1 }
  };

  return sortMap[sortBy] || sortMap.newest;
};
