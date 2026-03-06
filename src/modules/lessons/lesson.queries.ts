// lessons.queries.ts
import { Types } from 'mongoose';
import { SessionModel, SessionStatus } from '../../models/sessions.model';

const buildDateFilter = (startDate?: string, endDate?: string) => {
  if (!startDate && !endDate) return null;

  const filter: any = {};
  if (startDate) filter.$gte = new Date(startDate);
  if (endDate) filter.$lte = new Date(endDate);

  return filter;
};

export const buildBaseFilter = (
  teacherId: string,
  startDate?: string,
  endDate?: string,
  status?: string
): any => {
  const filter: any = {
    teacher: new Types.ObjectId(teacherId)
  };

  // Date range filter
  const dateFilter = buildDateFilter(startDate, endDate);
  if (dateFilter) {
    filter.start = dateFilter;
  }

  // Status filter
  if (status && status !== 'all') {
    filter.status = status;
  }

  return filter;
};

/**
 * Build the aggregation pipeline for fetching lessons
 */
export const buildLessonsPipeline = (filter: any, studentName?: string): any[] => {
  const pipeline: any[] = [
    { $match: filter },

    // Populate course
    {
      $lookup: {
        from: 'courses',
        localField: 'course',
        foreignField: '_id',
        as: 'courseData'
      }
    },
    { $unwind: '$courseData' },

    // Populate students
    {
      $lookup: {
        from: 'users',
        localField: 'students',
        foreignField: '_id',
        as: 'studentData'
      }
    },

    // Populate student profiles to get age
    {
      $lookup: {
        from: 'studentprofiles',
        localField: 'students',
        foreignField: 'user',
        as: 'studentProfiles'
      }
    },

    // Populate lesson for duration
    {
      $lookup: {
        from: 'lessons',
        localField: 'lesson',
        foreignField: '_id',
        as: 'lessonData'
      }
    },
    { $unwind: '$lessonData' },

    // Lookup bookings to determine trial status
    {
      $lookup: {
        from: 'bookings',
        let: {
          sessionStudents: '$students',
          sessionCourse: '$course'
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$course', '$$sessionCourse'] },
                  { $in: ['$student', '$$sessionStudents'] }
                ]
              }
            }
          },

          // IMPORTANT: only consider confirmed/paid bookings (adjust field name if yours differs)
          // If your schema uses "paymentStatus" (PAID/FAILED/PENDING), use that.
          // If your schema uses "status", change accordingly.
          {
            $match: {
              paymentStatus: 'PAID'
            }
          },

          // Keep only what we need
          { $project: { _id: 1, student: 1, isTrial: 1, createdAt: 1 } },

          // latest first (so newest paid booking wins if duplicates exist)
          { $sort: { createdAt: -1 } }
        ],
        as: 'paidBookings'
      }
    }
  ];

  // Student name filter (case-insensitive search)
  if (studentName && studentName.trim() !== '') {
    pipeline.push({
      $match: {
        studentData: {
          $elemMatch: {
            name: {
              $regex: studentName.trim(),
              $options: 'i'
            }
          }
        }
      }
    });
  }

  // Project fields with age from student profiles and booking type
  pipeline.push({
    $project: {
      _id: 1,
      start: 1,
      end: 1,
      status: 1,
      studentData: {
        $map: {
          input: '$studentData',
          as: 'student',
          in: {
            _id: '$$student._id',
            name: '$$student.name',
            age: {
              $let: {
                vars: {
                  profile: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: '$studentProfiles',
                          as: 'profile',
                          cond: { $eq: ['$$profile.user', '$$student._id'] }
                        }
                      },
                      0
                    ]
                  }
                },
                in: '$$profile.age'
              }
            },
            bookingType: {
              $let: {
                vars: {
                  // all paid bookings for this student in this course
                  bks: {
                    $filter: {
                      input: '$paidBookings',
                      as: 'b',
                      cond: { $eq: ['$$b.student', '$$student._id'] }
                    }
                  }
                },
                in: {
                  $let: {
                    vars: {
                      // newest paid non-trial booking
                      paidNonTrial: {
                        $arrayElemAt: [
                          {
                            $filter: {
                              input: '$$bks',
                              as: 'b2',
                              cond: { $eq: ['$$b2.isTrial', false] }
                            }
                          },
                          0
                        ]
                      },
                      // newest paid trial booking
                      paidTrial: {
                        $arrayElemAt: [
                          {
                            $filter: {
                              input: '$$bks',
                              as: 'b3',
                              cond: { $eq: ['$$b3.isTrial', true] }
                            }
                          },
                          0
                        ]
                      }
                    },
                    in: {
                      // precedence: enrolled wins over trial
                      $cond: [
                        { $ne: ['$$paidNonTrial', null] },
                        'enrolled',
                        {
                          $cond: [{ $ne: ['$$paidTrial', null] }, 'trial', 'enrolled']
                        }
                      ]
                    }
                  }
                }
              }
            }
          }
        }
      },
      courseType: '$courseData.lessonType',
      courseName: '$courseData.title',
      courseMode: '$courseData.mode',
      courseLanguage: '$courseData.language',
      duration: '$lessonData.schedule.duration'
    }
  });

  return pipeline;
};

export const buildCountPipeline = (basePipeline: any[]): any[] => {
  return [...basePipeline, { $count: 'total' }];
};

export const addSortToPipeline = (
  pipeline: any[],
  sortBy: string,
  sortOrder: 'asc' | 'desc'
): void => {
  const order = sortOrder === 'asc' ? 1 : -1;
  const sortConfig: any = {};

  switch (sortBy) {
    case 'dateTime':
      sortConfig.start = order;
      break;
    case 'student':
      sortConfig['studentData.0.name'] = order;
      break;
    case 'status':
      sortConfig.status = order;
      sortConfig.start = -1; // Secondary sort by date
      break;
    case 'subject':
      sortConfig.courseName = order;
      break;
    default:
      sortConfig.start = -1;
  }

  pipeline.push({ $sort: sortConfig });
};

export const addPaginationToPipeline = (pipeline: any[], page: number, limit: number): void => {
  const skip = (page - 1) * limit;
  pipeline.push({ $skip: skip }, { $limit: limit });
};

export const getTotalCount = async (pipeline: any[]): Promise<number> => {
  const countPipeline = buildCountPipeline(pipeline);
  const countResult = await SessionModel.aggregate(countPipeline);
  return countResult[0]?.total || 0;
};

export const getPendingCount = async (teacherId: string): Promise<number> => {
  return await SessionModel.countDocuments({
    teacher: new Types.ObjectId(teacherId),
    status: SessionStatus.SCHEDULED
  });
};
