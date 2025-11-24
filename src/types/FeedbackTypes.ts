import { Document, Model, Types } from 'mongoose';

export interface IFeedbackRating extends Document {
  lesson: Types.ObjectId;
  course: Types.ObjectId;
  author: Types.ObjectId;
  teacher: Types.ObjectId;
  rating: number;
  comment: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeedbackQueryParams {
  page?: string;
  limit?: string;
  rating?: string;
  sortBy?: 'newest' | 'oldest' | 'highest' | 'lowest';
  teacherId?: string;
  courseId?: string;
}

export interface PaginationMeta {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface FeedbackResponse {
  success: boolean;
  data: IFeedbackRating[];
  meta: PaginationMeta;
}
