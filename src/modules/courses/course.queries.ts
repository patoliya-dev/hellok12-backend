import mongoose from 'mongoose';

export const getCourseDetails = (id: string) => {
  const pipeline = [];

  pipeline.push({
    $match: {
      _id: new mongoose.Types.ObjectId(id)
    }
  });

  pipeline.push({
    $lookup: {
      from: 'users',
      localField: 'teachers',
      foreignField: '_id',
      pipeline: [{ $project: { _id: 1, name: 1 } }],
      as: 'teachers'
    }
  });

  pipeline.push({
    $lookup: {
      from: 'attachments',
      localField: 'introImageRef',
      foreignField: '_id',
      pipeline: [{ $match: { status: 'READY' } }, { $project: { url: 1 } }],
      as: 'introImageRef'
    }
  });

  pipeline.push({
    $addFields: {
      introImageRef: { $arrayElemAt: ['$introImageRef', 0] }
    }
  });

  pipeline.push({
    $lookup: {
      from: 'lessons',
      localField: '_id',
      foreignField: 'courseId',
      as: 'lessons'
    }
  });

  pipeline.push({
    $lookup: {
      from: 'feedbackratings',
      localField: '_id',
      foreignField: 'course',
      pipeline: [
        {
          $lookup: {
            from: 'users',
            localField: 'author',
            foreignField: '_id',
            pipeline: [
              {
                $lookup: {
                  from: 'attachments',
                  localField: '_id',
                  foreignField: 'entityId',
                  pipeline: [
                    { $match: { status: 'READY', entityType: 'User' } },
                    { $project: { url: 1 } }
                  ],
                  as: 'profileImage'
                }
              },
              {
                $addFields: { profileImage: { $arrayElemAt: ['$profileImage', 0] } }
              },
              {
                $project: {
                  _id: 1,
                  name: 1,
                  createdAt: 1,
                  profileImage: 1
                }
              }
            ],
            as: 'author'
          }
        },
        { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } }
      ],
      as: 'ratings'
    }
  });

  pipeline.push({
    $lookup: {
      from: 'feedbackratings',
      localField: '_id',
      foreignField: 'course',
      as: 'feedbacks'
    }
  });

  pipeline.push({
    $addFields: {
      averageRating: {
        $cond: [{ $gt: [{ $size: '$feedbacks' }, 0] }, { $avg: '$feedbacks.rating' }, null]
      },
      reviewsCount: { $size: '$feedbacks' }
    }
  });

  pipeline.push({
    $project: {
      _id: 1,
      title: 1,
      description: 1,
      enrolledCount: 1,
      startDate: 1,
      endDate: 1,
      price: 1,
      isTrialAvailable: 1,
      lessons: 1,
      introImageRef: 1,
      ratings: 1,
      averageRating: 1,
      reviewsCount: 1,
      teachers: 1,
      lessonType: 1,
      mode: 1
    }
  });

  return pipeline;
};
