import mongoose, { Schema, Document, Model, Types } from 'mongoose';

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

export interface IFeedbackRatingModel extends Model<IFeedbackRating> {
  findByLesson(lessonId: string | Types.ObjectId): Promise<IFeedbackRating[]>;
  findByTeacher(teacherId: string | Types.ObjectId): Promise<IFeedbackRating[]>;
  getAverageRating(teacherId: string | Types.ObjectId): Promise<number>;
}

const feedbackRatingSchema = new Schema<IFeedbackRating, IFeedbackRatingModel>(
  {
    lesson: {
      type: Schema.Types.ObjectId,
      ref: 'Lesson',
      required: [true, 'Lesson is required'],
      index: true
    },
    course: {
      type: Schema.Types.ObjectId,
      ref: 'Course',
      required: [true, 'Course is required'],
      index: true
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Author is required'],
      index: true
    },
    teacher: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Teacher is required'],
      index: true
    },
    rating: {
      type: Number,
      required: [true, 'Rating is required'],
      min: [1, 'Rating must be at least 1'],
      max: [5, 'Rating must be at most 5'],
      validate: {
        validator: Number.isInteger,
        message: 'Rating must be an integer'
      }
    },
    comment: {
      type: String,
      required: [true, 'Comment is required'],
      trim: true,
      maxlength: [1000, 'Comment cannot exceed 1000 characters']
    }
  },
  {
    timestamps: true, // Automatically manages createdAt and updatedAt
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Compound indexes for common queries
feedbackRatingSchema.index({ teacher: 1, createdAt: -1 });
feedbackRatingSchema.index({ lesson: 1, author: 1 }, { unique: true }); // Prevent duplicate ratings
feedbackRatingSchema.index({ course: 1, rating: -1 });
feedbackRatingSchema.index({ author: 1, createdAt: -1 });

feedbackRatingSchema.statics.getAverageRating = async function (
  teacherId: string | Types.ObjectId
): Promise<number> {
  const result = await this.aggregate([
    { $match: { teacher: new Types.ObjectId(teacherId.toString()) } },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating' }
      }
    }
  ]);

  return result.length > 0 ? Math.round(result[0].averageRating * 10) / 10 : 0;
};

// Virtual for rating display
feedbackRatingSchema.virtual('ratingStars').get(function () {
  return '⭐'.repeat(this.rating);
});

// Export the model
export const FeedbackRating = mongoose.model<IFeedbackRating, IFeedbackRatingModel>(
  'FeedbackRating',
  feedbackRatingSchema
);

// Type-safe query helpers
export type FeedbackRatingQuery = {
  lesson?: string | Types.ObjectId;
  course?: string | Types.ObjectId;
  author?: string | Types.ObjectId;
  teacher?: string | Types.ObjectId;
  rating?: number | { $gte?: number; $lte?: number };
  createdAt?: { $gte?: Date; $lte?: Date };
};

// Helper function for creating feedback
export const createFeedbackRating = async (
  data: Omit<IFeedbackRating, keyof Document | 'createdAt' | 'updatedAt'>
): Promise<IFeedbackRating> => {
  const feedback = new FeedbackRating(data);
  return await feedback.save();
};
