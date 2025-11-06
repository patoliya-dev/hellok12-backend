export const findTeacherQuery = ({ filters, teacherQuery, offset, limit }: any) => {
  const pipeline: any[] = [];
  const { query, priceRange } = teacherQuery;

  pipeline.push({
    $lookup: {
      from: 'teacherprofiles',
      localField: '_id',
      foreignField: 'user',
      as: 'profile'
    }
  });
  pipeline.push({ $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } });

  //   pipeline.push({
  //     $lookup: {
  //       from: 'teacherfeedbacks',
  //       localField: '_id',
  //       foreignField: 'teacher',
  //       as: 'feedbacks'
  //     }
  //   });

  //   pipeline.push({
  //     $addFields: {
  //       averageRating: {
  //         $cond: [{ $gt: [{ $size: '$feedbacks' }, 0] }, { $avg: '$feedbacks.rating' }, null]
  //       }
  //     }
  //   });

  //   if (filters.rating) {
  //     pipeline.push({
  //       $match: { averageRating: { $gte: Number(filters.ratings) } }
  //     });
  //   }

  pipeline.push({ $match: query });

  if (priceRange) {
    const { min, max } = priceRange;
    pipeline.push({
      $lookup: {
        from: 'courses',
        let: { teacherId: { $toObjectId: '$_id' } },
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
    $addFields: { profileImage: { $arrayElemAt: ['$profileImage', 0] } }
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
      // '$ratings': 1,
      'profile.yearsOfExperience': 1
    }
  });
  pipeline.push({ $skip: offset });
  pipeline.push({ $limit: limit });

  return pipeline;
};
