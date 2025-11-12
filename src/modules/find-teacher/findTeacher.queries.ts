import { Types } from 'mongoose';

export const findTeacherQuery = ({ filters, priceRange, offset, limit }: any) => {
  const pipeline: any[] = [];

  // Match role and school
  pipeline.push({
    $match: {
      role: 'teacher',
      ...(filters.school && { school: new Types.ObjectId(filters.school) })
    }
  });

  // Match name
  if (filters.name) {
    pipeline.push({
      $match: {
        name: { $regex: filters.name, $options: 'i' }
      }
    });
  }

  // Lookup profile
  pipeline.push({
    $lookup: {
      from: 'teacherprofiles',
      localField: '_id',
      foreignField: 'user',
      as: 'profile'
    }
  });

  // Unwind profile
  pipeline.push({ $unwind: { path: '$profile' } });

  const profileMatchFilters: any = {};

  // Match languages
  if (filters.languages) {
    profileMatchFilters['profile.teachingLanguages'] = filters.languages;
  }

  // Match experience
  if (filters.experience) {
    const [min, max] = filters.experience.split('-').map(Number);
    profileMatchFilters['profile.yearsOfExperience'] = { $gte: min, $lte: max };
  }

  // Match ageRange
  if (filters.ageRange) {
    profileMatchFilters['profile.ageGroupTeach'] = { $in: [filters.ageRange] };
  }

  // Match rating
  if (profileMatchFilters && Object.keys(profileMatchFilters).length > 0) {
    pipeline.push({ $match: profileMatchFilters });
  }

  // Lookup feedbacks
  pipeline.push({
    $lookup: {
      from: 'feedbackratings',
      localField: '_id',
      foreignField: 'teacher',
      as: 'feedbacks'
    }
  });

  // Add averageRating and reviewsCount
  pipeline.push({
    $addFields: {
      averageRating: {
        $cond: [{ $gt: [{ $size: '$feedbacks' }, 0] }, { $avg: '$feedbacks.rating' }, null]
      },
      reviewsCount: { $size: '$feedbacks' }
    }
  });

  // Match rating
  if (filters.rating) {
    const filtersRating = Number(filters.rating);
    pipeline.push({
      $match: {
        averageRating: { $gte: filtersRating, $lt: filtersRating + 1 }
      }
    });
  }

  // Build course lookup pipeline with filters
  const courseLookupPipeline: any[] = [
    {
      $match: {
        $expr: { $in: ['$$teacherId', '$teachers'] }
      }
    }
  ];

  // Add price range filter to course lookup
  if (priceRange && priceRange.min && priceRange.max) {
    const { min, max } = priceRange;
    courseLookupPipeline.push({
      $match: {
        $expr: {
          $and: [{ $gte: ['$price', min] }, { $lte: ['$price', max] }]
        }
      }
    });
  }

  // Add mode filter (online/in-person) to course lookup
  if (filters.mode && Array.isArray(filters.mode) && filters.mode.length > 0) {
    courseLookupPipeline.push({
      $match: {
        mode: { $in: filters.mode }
      }
    });
  }

  // Add lessonType filter (group/1-on-1) to course lookup
  if (filters.lessonType && Array.isArray(filters.lessonType) && filters.lessonType.length > 0) {
    courseLookupPipeline.push({
      $match: {
        lessonType: { $in: filters.lessonType }
      }
    });
  }

  // Add isTrialAvailable filter to course lookup
  if (filters.isTrialAvailable === true) {
    courseLookupPipeline.push({
      $match: {
        isTrialAvailable: true
      }
    });
  }

  // Apply course lookup with all filters
  pipeline.push({
    $lookup: {
      from: 'courses',
      let: { teacherId: '$_id' },
      pipeline: courseLookupPipeline,
      as: 'courses'
    }
  });

  // Filter out teachers with no matching courses if any course filter is applied
  const hasCourseFilters =
    (filters.price && Array.isArray(filters.price)) ||
    (filters.mode && Array.isArray(filters.mode) && filters.mode.length > 0) ||
    (filters.lessonType && Array.isArray(filters.lessonType) && filters.lessonType.length > 0) ||
    filters.isTrialAvailable === true;

  if (hasCourseFilters) {
    pipeline.push({
      $match: {
        courses: { $ne: [] }
      }
    });
  }

  // Get total students taught count (unfiltered - all courses)
  pipeline.push({
    $lookup: {
      from: 'courses',
      let: { teacherId: '$_id' },
      pipeline: [
        {
          $match: {
            $expr: { $in: ['$$teacherId', '$teachers'] }
          }
        },
        {
          $group: {
            _id: null,
            totalStudents: { $sum: '$enrolledCount' }
          }
        }
      ],
      as: 'studentStats'
    }
  });

  // Add studentsTaught
  pipeline.push({
    $addFields: {
      studentsTaught: {
        $ifNull: [{ $arrayElemAt: ['$studentStats.totalStudents', 0] }, 0]
      }
    }
  });

  // Lookup profileImage
  pipeline.push({
    $lookup: {
      from: 'attachments',
      localField: '_id',
      foreignField: 'entityId',
      pipeline: [{ $match: { status: 'READY', entityType: 'User' } }, { $project: { url: 1 } }],
      as: 'profileImage'
    }
  });

  // Add profileImage
  pipeline.push({
    $addFields: { profileImage: { $arrayElemAt: ['$profileImage.url', 0] } }
  });

  // Lookup school
  pipeline.push({
    $lookup: {
      from: 'users',
      localField: 'school',
      foreignField: '_id',
      pipeline: [
        {
          $project: {
            _id: 1,
            name: 1
          }
        }
      ],
      as: 'schoolDetails'
    }
  });

  // Add school
  pipeline.push({
    $addFields: {
      school: {
        $cond: [
          { $gt: [{ $size: '$schoolDetails' }, 0] },
          { $arrayElemAt: ['$schoolDetails', 0] },
          null
        ]
      }
    }
  });

  // Project
  pipeline.push({
    $project: {
      _id: 1,
      name: 1,
      role: 1,
      profileImage: 1,
      isVerified: 1,
      school: 1,
      'profile.teachingLanguages': 1,
      'profile.location': 1,
      'profile.teachingSpecialties': 1,
      averageRating: 1,
      'profile.yearsOfExperience': 1,
      reviewsCount: 1,
      studentsTaught: 1
    }
  });

  if (offset) pipeline.push({ $skip: offset });
  if (limit) pipeline.push({ $limit: limit });

  return pipeline;
};

export const teacherDetailsQuery = ({ teacherId, filter }: any) => {
  const pipeline: any[] = [];

  // Match teacherId
  pipeline.push({
    $match: {
      _id: new Types.ObjectId(teacherId),
      role: 'teacher'
    }
  });

  // Lookup profile
  pipeline.push({
    $lookup: {
      from: 'teacherprofiles',
      localField: '_id',
      foreignField: 'user',
      as: 'profile'
    }
  });

  // Unwind profile
  pipeline.push({ $unwind: { path: '$profile' } });

  // Lookup profileImage
  pipeline.push({
    $lookup: {
      from: 'attachments',
      localField: '_id',
      foreignField: 'entityId',
      pipeline: [{ $match: { status: 'READY', entityType: 'User' } }, { $project: { url: 1 } }],
      as: 'profileImage'
    }
  });

  // Add profileImage
  pipeline.push({
    $addFields: { profileImage: { $arrayElemAt: ['$profileImage.url', 0] } }
  });

  // Lookup highlights
  pipeline.push({
    $lookup: {
      from: 'attachments',
      localField: 'profile.highlights',
      foreignField: '_id',
      pipeline: [
        { $match: { status: 'READY', entityType: 'TeacherProfile' } },
        {
          $project: {
            url: 1,
            key: 1,
            name: 1,
            size: 1,
            createdAt: 1,
            updatedAt: 1,
            mime: 1
          }
        }
      ],
      as: 'highlights'
    }
  });

  // Add highlights
  pipeline.push({
    $addFields: {
      highlights: {
        $cond: [{ $gt: [{ $size: '$highlights' }, 0] }, '$highlights', []]
      }
    }
  });

  // Lookup intro
  pipeline.push({
    $lookup: {
      from: 'attachments',
      localField: 'profile.intro',
      foreignField: '_id',
      pipeline: [
        { $match: { status: 'READY', entityType: 'TeacherProfile' } },
        {
          $project: {
            url: 1,
            key: 1,
            name: 1,
            size: 1,
            createdAt: 1,
            updatedAt: 1,
            mime: 1
          }
        }
      ],
      as: 'intro'
    }
  });

  // Add intro
  pipeline.push({
    $addFields: {
      intro: {
        $cond: [{ $gt: [{ $size: '$intro' }, 0] }, { $arrayElemAt: ['$intro', 0] }, null]
      }
    }
  });

  // Lookup FeedbackRatings And count reviews and other operations
  pipeline.push({
    $lookup: {
      from: 'feedbackratings',
      localField: '_id',
      foreignField: 'teacher',
      pipeline: [
        { $sort: { createdAt: -1 } }, // Sort by latest first
        { $limit: 10 }, // Get only latest 10 reviews
        {
          $lookup: {
            from: 'lessons',
            localField: 'lesson',
            foreignField: '_id',
            as: 'lesson'
          }
        },
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
                $addFields: { profileImage: { $arrayElemAt: ['$profileImage.url', 0] } }
              },
              {
                $project: {
                  _id: 1,
                  name: 1,
                  profileImage: 1
                }
              }
            ],
            as: 'author'
          }
        },
        {
          $addFields: {
            lesson: {
              $arrayElemAt: ['$lesson', 0]
            },
            author: {
              $arrayElemAt: ['$author', 0]
            }
          }
        },
        {
          $project: {
            rating: 1,
            comment: 1,
            author: 1,
            createdAt: 1,
            lesson: 1
          }
        }
      ],
      as: 'feedbacks'
    }
  });

  // Add averageRating and reviewsCount
  pipeline.push({
    $addFields: {
      averageRating: {
        $cond: [{ $gt: [{ $size: '$feedbacks' }, 0] }, { $avg: '$feedbacks.rating' }, null]
      },
      reviewsCount: { $size: '$feedbacks' }
    }
  });

  // Lookup Courses
  pipeline.push({
    $lookup: {
      from: 'courses',
      let: { teacherId: '$_id' },
      pipeline: [
        {
          $match: {
            $expr: { $in: ['$$teacherId', '$teachers'] }
          }
        },
        {
          $group: {
            _id: null,
            totalStudents: { $sum: '$enrolledCount' }
          }
        }
      ],
      as: 'studentStats'
    }
  });

  // Add studentsTaught
  pipeline.push({
    $addFields: {
      studentsTaught: {
        $ifNull: [{ $arrayElemAt: ['$studentStats.totalStudents', 0] }, 0]
      }
    }
  });

  // Lookup Courses
  pipeline.push({
    $lookup: {
      from: 'courses',
      let: { teacherId: '$_id' },
      pipeline: [
        {
          $match: {
            $expr: { $in: ['$$teacherId', '$teachers'] }
          }
        },
        {
          $project: {
            title: 1,
            description: 1,
            enrolledCount: 1,
            price: 1,
            startDate: 1,
            endDate: 1,
            language: 1,
            studentCapacity: 1,
            lessonType: 1,
            location: 1,
            isTrialAvailable: 1,
            mode: 1
            // Add other fields you need
          }
        }
      ],
      as: 'courses'
    }
  });

  // Add available Courses Count
  pipeline.push({
    $addFields: {
      availableCoursesCount: {
        $size: {
          $filter: {
            input: '$courses',
            as: 'course',
            cond: {
              $or: [
                { $eq: ['$$course.lessonType', '1-on-1'] },
                {
                  $and: [
                    { $eq: ['$$course.lessonType', 'group'] },
                    { $lt: ['$$course.enrolledCount', '$$course.studentCapacity'] }
                  ]
                }
              ]
            }
          }
        }
      }
    }
  });

  // Project
  pipeline.push({
    $project: {
      _id: 1,
      name: 1,
      role: 1,
      profileImage: 1,
      isVerified: 1,
      'profile.teachingLanguages': 1,
      'profile.ageGroupTeach': 1,
      'profile.aboutYou': 1,
      'profile.highestEducation': 1,
      'profile.yearsOfExperience': 1,
      'profile.graduationYear': 1,
      'profile.institution': 1,
      'profile.teachingStyle': 1,
      'profile.whyTeaching': 1,
      averageRating: 1,
      highlights: 1,
      intro: 1,
      reviewsCount: 1,
      studentsTaught: 1,
      feedbacks: 1,
      courses: 1,
      availableCoursesCount: 1
    }
  });

  return pipeline;
};
