import { Types } from 'mongoose';

export const findTeacherQuery = ({ filters, teacherQuery, offset, limit }: any) => {
  const pipeline: any[] = [];
  const { priceRange } = teacherQuery;

  pipeline.push({
    $match: {
      role: 'teacher',
      ...(filters.school && { school: new Types.ObjectId(filters.school) })
    }
  });

  pipeline.push({
    $lookup: {
      from: 'teacherprofiles',
      localField: '_id',
      foreignField: 'user',
      as: 'profile'
    }
  });

  pipeline.push({ $unwind: { path: '$profile' } });

  const profileMatchFilters: any = {};

  if (filters.languages) {
    profileMatchFilters['profile.teachingLanguages'] = filters.languages;
  }

  if (filters.experience) {
    const [min, max] = filters.experience.split('-').map(Number);
    profileMatchFilters['profile.yearsOfExperience'] = { $gte: min, $lte: max };
  }

  if (filters.ageRange) {
    profileMatchFilters['profile.ageGroupTeach'] = filters.ageRange;
  }

  if (profileMatchFilters && Object.keys(profileMatchFilters).length > 0) {
    pipeline.push({ $match: profileMatchFilters });
  }

  if (filters.rating) {
    pipeline.push({
      $lookup: {
        from: 'feedbackratings',
        localField: '_id',
        foreignField: 'teacher',
        as: 'feedbacks'
      }
    });

    pipeline.push({
      $addFields: {
        averageRating: {
          $cond: [{ $gt: [{ $size: '$feedbacks' }, 0] }, { $avg: '$feedbacks.rating' }, null]
        }
      }
    });
    pipeline.push({
      $match: { averageRating: { $gte: Number(filters.rating) } }
    });
  }

  if (priceRange) {
    const { min, max } = priceRange;
    pipeline.push({
      $lookup: {
        from: 'courses',
        let: { teacherId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ['$$teacherId', '$teachers'] },
                  { $gte: ['$price', min] },
                  { $lte: ['$price', max] }
                ]
              }
            }
          },
          { $limit: 1 },
          { $project: { _id: 1, price: 1 } }
        ],
        as: 'courses'
      }
    });
  }

  if (filters.price && Array.isArray(filters.price)) {
    pipeline.push({
      $match: {
        courses: { $ne: [] }
      }
    });
  }

  pipeline.push({
    $lookup: {
      from: 'attachments',
      localField: '_id',
      foreignField: 'entityId',
      pipeline: [{ $match: { status: 'READY', entityType: 'User' } }, { $project: { url: 1 } }],
      as: 'profileImage'
    }
  });
  pipeline.push({
    $addFields: { profileImage: { $arrayElemAt: ['$profileImage.url', 0] } }
  });

  pipeline.push({
    $project: {
      _id: 1,
      name: 1,
      role: 1,
      profileImage: 1,
      isVerified: 1,
      'profile.teachingLanguages': 1,
      'profile.location': 1,
      'profile.teachingSpecialties': 1,
      averageRating: 1,
      'profile.yearsOfExperience': 1
    }
  });
  if (offset) pipeline.push({ $skip: offset });
  if (limit) pipeline.push({ $limit: limit });

  return pipeline;
};
