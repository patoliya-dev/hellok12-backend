import { Types } from 'mongoose';
import { AGE_GROUPS } from '../../utils/constants';

export const findTeacherQuery = ({ filters = {}, priceRange, offset, limit }: any) => {
  const pipeline: any[] = [];

  // normalize incoming filters (defensive)
  const modes = Array.isArray(filters.mode)
    ? filters.mode
    : filters.mode
      ? typeof filters.mode === 'string' && filters.mode.startsWith('[')
        ? JSON.parse(filters.mode)
        : [filters.mode]
      : [];
  const lessonTypes = Array.isArray(filters.lessonType)
    ? filters.lessonType
    : filters.lessonType
      ? typeof filters.lessonType === 'string' && filters.lessonType.startsWith('[')
        ? JSON.parse(filters.lessonType)
        : [filters.lessonType]
      : [];
  const languages = Array.isArray(filters.languages)
    ? filters.languages
    : filters.languages
      ? typeof filters.languages === 'string' && filters.languages.startsWith('[')
        ? JSON.parse(filters.languages)
        : [filters.languages]
      : [];

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

  pipeline.push({ $unwind: { path: '$profile' } });

  const profileMatchFilters: any = {};

  // Match languages (use normalized languages)
  if (languages && languages.length > 0) {
    profileMatchFilters['profile.teachingLanguages'] = { $in: languages };
  }

  // Match experience
  if (filters.experience) {
    const [min, max] = filters.experience.split('-').map(Number);
    profileMatchFilters['profile.yearsOfExperience'] = { $gte: min, $lte: max };
  }

  // Match ageRange
  if (filters.ageRange) {
    const ageRangesToMatch = getOverlappingAgeRanges(filters.ageRange);
    profileMatchFilters['profile.ageGroupTeach'] = { $in: ageRangesToMatch };
  }

  if (profileMatchFilters && Object.keys(profileMatchFilters).length > 0) {
    pipeline.push({ $match: profileMatchFilters });
  }

  // Availability
  if (filters.availability) {
    pipeline.push({
      $lookup: {
        from: 'teacherschedules',
        localField: '_id',
        foreignField: 'teacherId',
        as: 'schedule'
      }
    });
    pipeline.push({
      $unwind: {
        path: '$schedule'
      }
    });
    const availabilityMatch = buildAvailabilityMatch(filters.availability);

    if (availabilityMatch) {
      pipeline.push({
        $match: availabilityMatch
      });
    }
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
        $expr: { $in: ['$$teacherId', { $ifNull: ['$teachers', []] }] }
      }
    }
  ];

  // priceRange filter in lookup
  if (priceRange && typeof priceRange.min === 'number' && typeof priceRange.max === 'number') {
    const { min, max } = priceRange;
    courseLookupPipeline.push({
      $match: {
        $expr: {
          $and: [{ $gte: ['$price', min] }, { $lte: ['$price', max] }]
        }
      }
    });
  }

  // Add mode filter if we have normalized modes
  if (modes && modes.length > 0) {
    courseLookupPipeline.push({
      $match: {
        mode: { $in: modes }
      }
    });
  }

  // Add lessonType filter if normalized
  if (lessonTypes && lessonTypes.length > 0) {
    courseLookupPipeline.push({
      $match: {
        lessonType: { $in: lessonTypes }
      }
    });
  }

  // isTrialAvailable
  if (filters.isTrialAvailable === true || filters.isTrialAvailable === 'true') {
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
    (priceRange && priceRange.min != null && priceRange.max != null) ||
    (modes && modes.length > 0) ||
    (lessonTypes && lessonTypes.length > 0) ||
    filters.isTrialAvailable === true ||
    filters.isTrialAvailable === 'true';

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
            $expr: { $in: ['$$teacherId', { $ifNull: ['$teachers', []] }] }
          }
        },
        {
          $group: {
            _id: null,
            totalStudents: { $sum: { $ifNull: ['$enrolledCount', 0] } }
          }
        }
      ],
      as: 'studentStats'
    }
  });

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

  // Project (exclude schedule from final output)
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

function getOverlappingAgeRanges(inputAgeRange: string): string[] {
  const normalized = String(inputAgeRange).trim();
  const parsedInputRange = parseNumericRange(normalized);

  if (!parsedInputRange) {
    return [normalized];
  }

  const overlaps = AGE_GROUPS.filter(group => {
    const parsedGroupRange = parseNumericRange(group);
    if (!parsedGroupRange) return false;

    const [inputMin, inputMax] = parsedInputRange;
    const [groupMin, groupMax] = parsedGroupRange;
    return Math.max(inputMin, groupMin) <= Math.min(inputMax, groupMax);
  });

  return Array.from(new Set([normalized, ...overlaps]));
}

function parseNumericRange(value: string): [number, number] | null {
  const match = value.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return null;

  const min = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

  return min <= max ? [min, max] : [max, min];
}

/**
 * Build MongoDB match condition for availability filter
 */
function buildAvailabilityMatch(availability: any) {
  if (!availability) return null;

  const { type, value, start, end, dates } = availability;

  switch (type) {
    case 'single':
      return buildSingleDateMatch(value);

    case 'range':
      return buildDateRangeMatch(start, end);

    case 'multiple':
      return buildMultipleDatesMatch(dates);

    default:
      return null;
  }
}

/**
 * Check if teacher has availability on a single date/datetime
 */
function buildSingleDateMatch(dateString: string) {
  const parsedDate = new Date(dateString);
  const dateOnly = dateString.split('T')[0]; // "2025-12-05"
  const dayOfWeek = parsedDate.getDay(); // 0-6
  const yearMonth = dateOnly.substring(0, 7); // "2025-12"

  let timeInMinutes: number | null = null;
  if (dateString.includes('T')) {
    const time = dateString.split('T')[1];
    const [hours, minutes] = time.split(':').map(Number);
    timeInMinutes = hours * 60 + minutes;
  }

  const conditions: any[] = [];

  if (timeInMinutes !== null) {
    conditions.push({
      $or: [
        { [`schedule.overrides.${dateOnly}`]: timeInMinutes },
        {
          $and: [
            { [`schedule.overrides.${dateOnly}`]: { $exists: false } },
            { [`schedule.monthly.${yearMonth}.${dayOfWeek}`]: timeInMinutes }
          ]
        },
        {
          $and: [
            { [`schedule.overrides.${dateOnly}`]: { $exists: false } },
            { [`schedule.monthly.${yearMonth}`]: { $exists: false } },
            { [`schedule.weekly.${dayOfWeek}`]: timeInMinutes }
          ]
        }
      ]
    });
  } else {
    conditions.push({
      $or: [
        {
          $and: [
            { [`schedule.overrides.${dateOnly}`]: { $exists: true } },
            { [`schedule.overrides.${dateOnly}`]: { $ne: [] } }
          ]
        },
        {
          $and: [
            { [`schedule.overrides.${dateOnly}`]: { $exists: false } },
            { [`schedule.monthly.${yearMonth}.${dayOfWeek}`]: { $exists: true } },
            { [`schedule.monthly.${yearMonth}.${dayOfWeek}`]: { $ne: [] } }
          ]
        },
        // Check weekly baseline has slots
        {
          $and: [
            { [`schedule.overrides.${dateOnly}`]: { $exists: false } },
            { [`schedule.monthly.${yearMonth}`]: { $exists: false } },
            { [`schedule.weekly.${dayOfWeek}`]: { $exists: true } },
            { [`schedule.weekly.${dayOfWeek}`]: { $ne: [] } }
          ]
        }
      ]
    });
  }

  return { $and: conditions };
}

/**
 * Check if teacher has ANY schedule setup that MIGHT overlap
 */
function buildDateRangeMatch(startDate: string, endDate: string) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const monthsInRange = new Set<string>();
  const daysOfWeekInRange = new Set<number>();

  const currentDate = new Date(start);
  while (currentDate <= end) {
    const yearMonth = currentDate.toISOString().substring(0, 7); // "2025-12"
    const dayOfWeek = currentDate.getDay(); // 0-6

    monthsInRange.add(yearMonth);
    daysOfWeekInRange.add(dayOfWeek);

    currentDate.setDate(currentDate.getDate() + 1);
  }

  const conditions: any[] = [];

  const overrideConditions: any[] = [];
  const checkDate = new Date(start);
  while (checkDate <= end) {
    const dateKey = checkDate.toISOString().split('T')[0];
    overrideConditions.push({
      $and: [
        { [`schedule.overrides.${dateKey}`]: { $exists: true } },
        { [`schedule.overrides.${dateKey}`]: { $ne: [] } }
      ]
    });
    checkDate.setDate(checkDate.getDate() + 1);
  }
  if (overrideConditions.length > 0) {
    conditions.push({ $or: overrideConditions });
  }

  const monthlyConditions: any[] = [];
  monthsInRange.forEach(yearMonth => {
    daysOfWeekInRange.forEach(dayOfWeek => {
      monthlyConditions.push({
        $and: [
          { [`schedule.monthly.${yearMonth}.${dayOfWeek}`]: { $exists: true } },
          { [`schedule.monthly.${yearMonth}.${dayOfWeek}`]: { $ne: [] } }
        ]
      });
    });
  });
  if (monthlyConditions.length > 0) {
    conditions.push({ $or: monthlyConditions });
  }

  const weeklyConditions: any[] = [];
  daysOfWeekInRange.forEach(dayOfWeek => {
    weeklyConditions.push({
      $and: [
        { [`schedule.weekly.${dayOfWeek}`]: { $exists: true } },
        { [`schedule.weekly.${dayOfWeek}`]: { $ne: [] } }
      ]
    });
  });
  if (weeklyConditions.length > 0) {
    conditions.push({ $or: weeklyConditions });
  }

  return conditions.length > 0 ? { $or: conditions } : null;
}

/**
 * Check if teacher has availability on multiple specific dates
 */
function buildMultipleDatesMatch(dates: string[]) {
  const dateConditions = dates.map(dateString => {
    const parsedDate = new Date(dateString);
    const dateOnly = dateString.split('T')[0];
    const dayOfWeek = parsedDate.getDay();
    const yearMonth = dateOnly.substring(0, 7);

    return {
      $or: [
        {
          $and: [
            { [`schedule.overrides.${dateOnly}`]: { $exists: true } },
            { [`schedule.overrides.${dateOnly}`]: { $ne: [] } }
          ]
        },
        {
          $and: [
            { [`schedule.overrides.${dateOnly}`]: { $exists: false } },
            { [`schedule.monthly.${yearMonth}.${dayOfWeek}`]: { $exists: true } },
            { [`schedule.monthly.${yearMonth}.${dayOfWeek}`]: { $ne: [] } }
          ]
        },
        {
          $and: [
            { [`schedule.overrides.${dateOnly}`]: { $exists: false } },
            { [`schedule.monthly.${yearMonth}`]: { $exists: false } },
            { [`schedule.weekly.${dayOfWeek}`]: { $exists: true } },
            { [`schedule.weekly.${dayOfWeek}`]: { $ne: [] } }
          ]
        }
      ]
    };
  });
  return { $and: dateConditions };
}

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
  // Unwind profile - keep doc even if profile missing (defensive)
  pipeline.push({ $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } });
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
  // Lookup highlights (profile.highlights may be missing or empty - lookup handles that)
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
  // Lookup Courses -> studentStats (make $in robust with $ifNull)
  pipeline.push({
    $lookup: {
      from: 'courses',
      let: { teacherId: '$_id' },
      pipeline: [
        {
          $match: {
            $expr: { $in: ['$$teacherId', { $ifNull: ['$teachers', []] }] },
            status: 'active'
          }
        },
        {
          $group: {
            _id: null,
            totalStudents: { $sum: { $ifNull: ['$enrolledCount', 0] } }
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
  // Lookup Courses -> course list (again make $in robust)
  pipeline.push({
    $lookup: {
      from: 'courses',
      let: { teacherId: '$_id' },
      pipeline: [
        {
          $match: {
            $expr: { $in: ['$$teacherId', { $ifNull: ['$teachers', []] }] },
            status: 'active'
          }
        },
        {
          $lookup: {
            from: 'sessions',
            let: { courseId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$course', '$$courseId'] }
                }
              },
              {
                $group: {
                  _id: null,
                  lastLessonDate: { $max: '$end' }
                }
              }
            ],
            as: 'sessionStats'
          }
        },
        {
          $addFields: {
            lastLessonDate: {
              $ifNull: [{ $arrayElemAt: ['$sessionStats.lastLessonDate', 0] }, '$endDate']
            }
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
            mode: 1,
            lastLessonDate: 1
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

  // Lookup School Profile (to get schoolName via teacher.school -> schoolprofiles.user)
  pipeline.push({
    $lookup: {
      from: 'schoolprofiles',
      let: { schoolUserId: '$school' },
      pipeline: [
        { $match: { $expr: { $eq: ['$user', '$$schoolUserId'] } } },
        { $project: { _id: 0, schoolName: 1 } }
      ],
      as: 'schoolProfile'
    }
  });

  // Add schoolName
  pipeline.push({
    $addFields: {
      schoolName: { $arrayElemAt: ['$schoolProfile.schoolName', 0] }
    }
  });

  // Optional: remove temp array
  pipeline.push({ $project: { schoolProfile: 0 } });

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
      availableCoursesCount: 1,
      school: 1,
      schoolName: 1
    }
  });

  return pipeline;
};
