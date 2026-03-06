import { Types } from 'mongoose';
import { User } from '../../models/user.model';
import { StudentProfileModel } from '../../models/studentProfile.model';
import { ParentProfileModel } from '../../models/parentProfile.model';
import { Course } from '../../models/course.model';
import bookingModel from '../../models/booking.model';
import { SchoolProfileModel } from '../../models/schoolProfile.model';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function pick<T extends object>(obj: any, keys: Array<keyof T>) {
  const out: any = {};
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k];
  return out as Partial<T>;
}

function parseRange(raw: string): { min?: number; max?: number } {
  const v = String(raw || '').trim();
  if (!v || v.toLowerCase() === 'all') return {};
  if (v.includes('+')) {
    const min = Number(v.replace('+', '').trim());
    return Number.isFinite(min) ? { min } : {};
  }
  if (v.includes('-')) {
    const [a, b] = v.split('-').map(x => Number(String(x).trim()));
    const min = Number.isFinite(a) ? a : undefined;
    const max = Number.isFinite(b) ? b : undefined;
    return { min, max };
  }
  const exact = Number(v);
  return Number.isFinite(exact) ? { min: exact, max: exact } : {};
}

const clampInt = (value: any, min: number, max: number, fallback: number) => {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const monthKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

const monthLabel = (d: Date) =>
  d.toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC'
  });

function buildMonthlyBuckets(months: number) {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1, 0, 0, 0, 0)
  );
  const end = new Date();

  const buckets: Array<{ key: string; label: string; start: Date; end: Date }> = [];
  for (let i = 0; i < months; i++) {
    const bucketStart = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1, 0, 0, 0, 0)
    );
    const bucketEnd = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i + 1, 0, 23, 59, 59, 999)
    );
    buckets.push({
      key: monthKey(bucketStart),
      label: monthLabel(bucketStart),
      start: bucketStart,
      end: bucketEnd
    });
  }

  return { start, end, buckets };
}

function computeDeltaPct(current: number, previous: number) {
  if (!Number.isFinite(previous) || previous <= 0) return current > 0 ? 100 : 0;
  const v = ((current - previous) / previous) * 100;
  const out = Number(v.toFixed(1));
  return Object.is(out, -0) ? 0 : out;
}

export const AdminService = {
  getDashboardOverview: async ({ months }: { months?: string } = {}) => {
    const monthCount = clampInt(months, 6, 24, 9);
    const { start, end, buckets } = buildMonthlyBuckets(monthCount);
    const [roleCountsAgg, totalCourses, growthAgg] = await Promise.all([
      User.aggregate([
        { $match: { role: { $in: ['school', 'teacher', 'student'] } } },
        { $group: { _id: '$role', count: { $sum: 1 } } }
      ]),
      Course.countDocuments({ status: { $ne: 'archived' } }),
      User.aggregate([
        {
          $match: {
            role: { $in: ['teacher', 'student'] },
            createdAt: { $gte: start, $lte: end }
          }
        },
        {
          $project: {
            role: 1,
            y: { $year: { date: '$createdAt', timezone: 'UTC' } },
            m: { $month: { date: '$createdAt', timezone: 'UTC' } },
            teacherType: {
              $cond: [
                { $ne: ['$role', 'teacher'] },
                null,
                {
                  $cond: [{ $eq: [{ $type: '$school' }, 'objectId'] }, 'school', 'independent']
                }
              ]
            }
          }
        },
        {
          $group: {
            _id: {
              y: '$y',
              m: '$m',
              role: '$role',
              teacherType: '$teacherType'
            },
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const roleCounts = new Map<string, number>();
    roleCountsAgg.forEach((r: any) => roleCounts.set(String(r?._id || ''), Number(r?.count || 0)));

    const schoolGrowthLookup = new Map<string, number>();
    const independentGrowthLookup = new Map<string, number>();
    const studentGrowthLookup = new Map<string, number>();

    growthAgg.forEach((r: any) => {
      const key = `${r?._id?.y}-${String(r?._id?.m || '').padStart(2, '0')}`;
      const count = Number(r?.count || 0);
      if (r?._id?.role === 'student') {
        studentGrowthLookup.set(key, count);
        return;
      }
      if (r?._id?.teacherType === 'school') {
        schoolGrowthLookup.set(key, count);
      } else {
        independentGrowthLookup.set(key, count);
      }
    });

    const schoolGrowth = buckets.map(b => ({
      label: b.label,
      value: schoolGrowthLookup.get(b.key) || 0
    }));
    const independentGrowth = buckets.map(b => ({
      label: b.label,
      value: independentGrowthLookup.get(b.key) || 0
    }));
    const studentGrowth = buckets.map(b => ({
      label: b.label,
      value: studentGrowthLookup.get(b.key) || 0
    }));

    const last = studentGrowth?.[studentGrowth.length - 1]?.value || 0;
    const prev = studentGrowth?.[studentGrowth.length - 2]?.value || 0;
    const deltaPercentage = computeDeltaPct(last, prev);

    return {
      period: {
        months: monthCount,
        start,
        end
      },
      cards: {
        totalSchools: roleCounts.get('school') || 0,
        totalTeachers: roleCounts.get('teacher') || 0,
        totalStudents: roleCounts.get('student') || 0,
        totalCourses
      },
      charts: {
        schoolTeachersGrowth: schoolGrowth,
        independentTeachersGrowth: independentGrowth,
        studentRegistrationGrowth: studentGrowth
      },
      trends: {
        studentRegistration: {
          deltaPercentage,
          direction: deltaPercentage >= 0 ? 'up' : 'down'
        }
      }
    };
  },

  getSchools: async ({ page, limit, search }: { page: string; limit: string; search: string }) => {
    const pageNum = Math.max(1, parseInt(String(page || '1'), 10) || 1);
    const limitNum = Math.max(1, Math.min(200, parseInt(String(limit || '50'), 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const term = String(search || '').trim();
    const rx = term ? new RegExp(escapeRegex(term), 'i') : null;

    /**
     * We use aggregation so we can:
     * - join SchoolProfileModel (schoolprofiles) to fetch schoolName
     * - search on that joined field
     * - keep pagination in 1 roundtrip (facet)
     */
    const pipeline: any[] = [
      { $match: { role: 'school' } },

      // Join SchoolProfileModel
      {
        $lookup: {
          from: 'schoolprofiles',
          localField: '_id',
          foreignField: 'user',
          as: 'schoolProfile'
        }
      },
      { $unwind: { path: '$schoolProfile', preserveNullAndEmptyArrays: true } },

      // Join profileImage (attachments)
      {
        $lookup: {
          from: 'attachments',
          let: { userId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$entityId', '$$userId'] },
                entityType: 'User',
                status: 'READY'
              }
            },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
            { $project: { _id: 0, url: 1 } }
          ],
          as: 'profileImage'
        }
      },
      { $unwind: { path: '$profileImage', preserveNullAndEmptyArrays: true } },

      // Normalize schoolName for FE:
      // 1) schoolprofiles.schoolName (source of truth)
      // 2) user.profile.schoolName (legacy)
      // 3) user.name (fallback)
      {
        $addFields: {
          schoolName: {
            $ifNull: ['$schoolProfile.schoolName', { $ifNull: ['$profile.schoolName', '$name'] }]
          }
        }
      },

      // Search across name/email/schoolName (from school profile)
      ...(rx
        ? [
            {
              $match: {
                $or: [{ name: rx }, { email: rx }, { schoolName: rx }]
              }
            }
          ]
        : []),

      {
        $facet: {
          items: [
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: limitNum },
            {
              $project: {
                _id: 1,
                name: 1,
                email: 1,
                status: 1,
                createdAt: 1,
                profileImage: 1,

                // keep a profile object for FE compatibility
                profile: {
                  $mergeObjects: [
                    '$profile',
                    {
                      schoolName: '$schoolName'
                    }
                  ]
                }
              }
            }
          ],
          total: [{ $count: 'count' }]
        }
      }
    ];

    const agg = await User.aggregate(pipeline);

    const schools = agg?.[0]?.items || [];
    const total = agg?.[0]?.total?.[0]?.count || 0;

    const pages = Math.max(1, Math.ceil(total / limitNum));

    return {
      schools,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages,
        hasNextPage: pageNum < pages,
        hasPrevPage: pageNum > 1
      }
    };
  },

  getParents: async ({
    page,
    limit,
    search,
    status,
    school
  }: {
    page: string;
    limit: string;
    search?: string;
    status?: string;
    school?: string;
  }) => {
    const pageNum = Math.max(1, parseInt(String(page || '1'), 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(String(limit || '10'), 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const match: any = { role: 'parent' };

    const normalizedStatus = String(status || '')
      .trim()
      .toLowerCase();
    if (normalizedStatus && normalizedStatus !== 'all') match.status = normalizedStatus;

    const term = String(search || '').trim();
    if (term) {
      const maybeId = Types.ObjectId.isValid(term) ? new Types.ObjectId(term) : null;
      const rx = new RegExp(escapeRegex(term), 'i');
      match.$or = [
        ...(maybeId ? [{ _id: maybeId }] : []),
        { name: rx },
        { email: rx },
        { phone: rx }
      ];
    }

    const schoolId =
      school && Types.ObjectId.isValid(String(school)) ? new Types.ObjectId(String(school)) : null;

    const pipeline: any[] = [
      { $match: match },

      // If school filter exists: only parents who have at least one student child in that school
      ...(schoolId
        ? [
            {
              $lookup: {
                from: 'users',
                let: { parentId: '$_id', sid: schoolId },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ['$parent', '$$parentId'] },
                          { $eq: ['$role', 'student'] },
                          { $eq: ['$school', '$$sid'] }
                        ]
                      }
                    }
                  },
                  { $project: { _id: 1 } },
                  { $limit: 1 }
                ],
                as: '_childrenInSchool'
              }
            },
            { $match: { _childrenInSchool: { $ne: [] } } }
          ]
        : []),

      // Lookup parent profile (if exists as separate collection)
      {
        $lookup: {
          from: 'parentprofiles',
          localField: '_id',
          foreignField: 'user',
          as: 'parentProfile'
        }
      },
      { $unwind: { path: '$parentProfile', preserveNullAndEmptyArrays: true } },

      // Merge profile: prefer parentProfile, fallback to embedded profile
      {
        $addFields: {
          profile: {
            $cond: [
              { $ifNull: ['$parentProfile', false] },
              '$parentProfile',
              { $ifNull: ['$profile', {}] }
            ]
          }
        }
      },

      // profileImage lookup (Attachment)
      {
        $lookup: {
          from: 'attachments',
          let: { uid: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$entityId', '$$uid'] },
                    { $eq: ['$entityType', 'User'] },
                    { $eq: ['$status', 'READY'] }
                  ]
                }
              }
            },
            { $project: { url: 1 } },
            { $limit: 1 }
          ],
          as: 'profileImage'
        }
      },
      { $unwind: { path: '$profileImage', preserveNullAndEmptyArrays: true } },

      {
        $facet: {
          items: [
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: limitNum },
            {
              $project: {
                name: 1,
                email: 1,
                phone: 1,
                status: 1,
                profile: 1,
                createdAt: 1,
                updatedAt: 1,
                profileImage: 1
              }
            }
          ],
          total: [{ $count: 'count' }]
        }
      }
    ];

    const agg = await User.aggregate(pipeline);
    const items = agg?.[0]?.items || [];
    const total = agg?.[0]?.total?.[0]?.count || 0;

    const pages = Math.max(1, Math.ceil(total / limitNum));

    return {
      parents: items,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages,
        hasNextPage: pageNum < pages,
        hasPrevPage: pageNum > 1
      }
    };
  },
  getTeachers: async ({
    page,
    limit,
    search,
    status,
    school,
    experience,
    teacherType // school | independent
  }: {
    page: string;
    limit: string;
    search?: string;
    status?: string;
    school?: string;
    experience?: string; // "0-2" | "3-5" | "5+" | "all"
    teacherType?: string;
  }) => {
    const pageNum = Math.max(1, parseInt(String(page || '1'), 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(String(limit || '10'), 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const match: any = { role: 'teacher' };

    // status
    const normalizedStatus = String(status || '')
      .trim()
      .toLowerCase();
    if (normalizedStatus && normalizedStatus !== 'all') match.status = normalizedStatus;

    // search
    const term = String(search || '').trim();
    if (term) {
      const maybeId = Types.ObjectId.isValid(term) ? new Types.ObjectId(term) : null;
      const rx = new RegExp(escapeRegex(term), 'i');
      match.$or = [
        ...(maybeId ? [{ _id: maybeId }] : []),
        { name: rx },
        { email: rx },
        { phone: rx }
      ];
    }

    // teacherType scope
    if (teacherType === 'school') {
      match.school = { $type: 'objectId' };
    } else if (teacherType === 'independent') {
      match.$and = match.$and || [];
      match.$and.push({ $or: [{ school: { $exists: false } }, { school: null }] });
    }

    // optional school filter (only meaningful for school teachers)
    const schoolId =
      school && school !== 'all' && Types.ObjectId.isValid(String(school))
        ? new Types.ObjectId(String(school))
        : null;

    if (schoolId && teacherType === 'school') {
      match.school = schoolId;
    }

    // experience filter (works for: user.profile.experience OR teacherProfile.experience, number OR string)
    const { min: expMin, max: expMax } = parseRange(String(experience || ''));

    const pipeline: any[] = [
      { $match: match },

      // teacherProfile lookup (many apps store experience here)
      {
        $lookup: {
          from: 'teacherprofiles',
          localField: '_id',
          foreignField: 'user',
          as: 'teacherProfile'
        }
      },
      { $unwind: { path: '$teacherProfile', preserveNullAndEmptyArrays: true } },

      // compute _expNum safely (handles number/string/empty)
      {
        $addFields: {
          _expNum: {
            $let: {
              vars: {
                expCandidate: {
                  $ifNull: [
                    '$teacherProfile.yearsOfExperience',
                    { $ifNull: ['$profile.yearsOfExperience', null] }
                  ]
                }
              },
              in: {
                $convert: {
                  input: '$$expCandidate',
                  to: 'double',
                  onError: null,
                  onNull: null
                }
              }
            }
          }
        }
      },

      // apply exp filter on _expNum
      ...(expMin !== undefined || expMax !== undefined
        ? [
            {
              $match: {
                _expNum: {
                  ...(expMin !== undefined ? { $gte: expMin } : {}),
                  ...(expMax !== undefined ? { $lte: expMax } : {})
                }
              }
            }
          ]
        : []),

      // profileImage lookup (Attachment)
      {
        $lookup: {
          from: 'attachments',
          let: { uid: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$entityId', '$$uid'] },
                    { $eq: ['$entityType', 'User'] },
                    { $eq: ['$status', 'READY'] }
                  ]
                }
              }
            },
            { $project: { url: 1 } },
            { $limit: 1 }
          ],
          as: 'profileImage'
        }
      },
      { $unwind: { path: '$profileImage', preserveNullAndEmptyArrays: true } },

      // School name
      {
        $lookup: {
          from: 'users',
          localField: 'school',
          foreignField: '_id',
          as: 'schoolUser'
        }
      },
      { $unwind: { path: '$schoolUser', preserveNullAndEmptyArrays: true } },

      {
        $facet: {
          items: [
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: limitNum },
            {
              $project: {
                name: 1,
                email: 1,
                phone: 1,
                status: 1,
                school: 1,
                schoolUser: { _id: 1, name: 1, profile: 1 },
                profile: 1,
                teacherProfile: 1, // helpful for FE
                _expNum: 1, // optional, for debugging/FE use
                createdAt: 1,
                updatedAt: 1,
                profileImage: 1
              }
            }
          ],
          total: [{ $count: 'count' }]
        }
      }
    ];

    const agg = await User.aggregate(pipeline);
    const items = agg?.[0]?.items || [];
    const total = agg?.[0]?.total?.[0]?.count || 0;

    const pages = Math.max(1, Math.ceil(total / limitNum));

    return {
      teachers: items,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages,
        hasNextPage: pageNum < pages,
        hasPrevPage: pageNum > 1
      }
    };
  },
  updateUser: async (userId: string, payload: any) => {
    if (!Types.ObjectId.isValid(userId)) {
      throw Object.assign(new Error('Invalid user id'), { statusCode: 400 });
    }

    const user = await User.findById(userId);
    if (!user) {
      throw Object.assign(new Error('User not found'), { statusCode: 404 });
    }

    // -----------------------------
    // A) Update User base fields
    // -----------------------------
    const userPatch = pick<{ name?: string; phone?: string; school?: Types.ObjectId }>(payload, [
      'name',
      'phone',
      'school'
    ] as any);

    if (userPatch.name !== undefined) {
      user.name = String(userPatch.name).trim();
    }

    if (userPatch.phone !== undefined) {
      user.phone = String(userPatch.phone).trim();
    }

    // Allow school change only for students
    if (payload?.school !== undefined && user.role === 'student') {
      if (payload.school && Types.ObjectId.isValid(String(payload.school))) {
        user.school = new Types.ObjectId(String(payload.school));
      } else {
        user.school = undefined;
      }
    }

    // -----------------------------
    // B) Embedded profile update
    // -----------------------------
    const profile = payload?.profile || {};
    user.profile = user.profile || {};

    if (profile.languages !== undefined) {
      user.profile.languages = Array.isArray(profile.languages) ? profile.languages : [];
    }

    if (profile.address !== undefined) {
      user.profile.address = String(profile.address);
    }

    // -----------------------------
    // C) Role specific updates
    // -----------------------------

    // STUDENT
    if (user.role === 'student') {
      if (profile.age !== undefined) {
        user.profile.age = profile.age === null ? undefined : Number(profile.age);
      }

      if (profile.gender !== undefined) {
        user.profile.gender = profile.gender || undefined;
      }

      await StudentProfileModel.updateOne(
        { user: user._id },
        {
          $set: {
            address: user.profile.address || '',
            languages: user.profile.languages || [],
            age: user.profile.age ?? null,
            gender: user.profile.gender || 'other'
          }
        },
        { upsert: true }
      );
    }

    // PARENT
    if (user.role === 'parent') {
      await ParentProfileModel.updateOne(
        { user: user._id },
        {
          $set: {
            address: user.profile.address || ''
          }
        },
        { upsert: true }
      );
    }

    if (user.role === 'school') {
      const schoolName = String(profile.schoolName || user.name || '').trim();

      if (!schoolName) {
        throw Object.assign(new Error('School name is required'), {
          statusCode: 400
        });
      }

      const rawAddresses = Array.isArray(profile.addresses) ? profile.addresses : [];

      const addresses = rawAddresses.map((x: any) => String(x || '').trim()).filter(Boolean);

      const address1 = String(profile.address1 || addresses?.[0] || '').trim();
      const address2 = String(profile.address2 || addresses?.[1] || '').trim();

      await SchoolProfileModel.updateOne(
        { user: user._id },
        {
          $set: {
            user: user._id,
            schoolName,
            description: String(profile.description || '').trim(),
            website: String(profile.website || '').trim(),
            teachersDisplayLink: String(profile.teachersDisplayLink || '').trim(),
            addresses,
            address1,
            address2
          }
        },
        { upsert: true }
      );

      // Optional mirror for backward compatibility
      user.profile.schoolName = schoolName;
      user.profile.website = String(profile.website || '').trim();
      user.profile.description = String(profile.description || '').trim();
      user.profile.addresses = addresses;
    }

    await user.save();

    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      school: user.school,
      profile: user.profile
    };
  },

  async getSchoolById(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new Error('Invalid ID');

    const school = await User.findOne({ _id: id, role: 'school' })
      .populate('profileImage', 'url')
      .lean();

    if (!school) throw new Error('School not found');

    const teacherCount = await User.countDocuments({
      role: 'teacher',
      school: id
    });

    const studentCount = await User.countDocuments({
      role: 'student',
      school: id
    });

    const courseCount = await Course.countDocuments({ ownerId: id });

    const bookings = await bookingModel.aggregate([
      { $match: { school: new Types.ObjectId(id) } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    return {
      school,
      stats: {
        teacherCount,
        studentCount,
        courseCount,
        revenue: bookings?.[0]?.total || 0
      }
    };
  },

  getSchoolDetails: async (schoolId: string) => {
    if (!Types.ObjectId.isValid(schoolId)) {
      throw Object.assign(new Error('Invalid schoolId'), { statusCode: 400 });
    }

    const sid = new Types.ObjectId(schoolId);

    // Fetch school + schoolProfile + summary in parallel (fast)
    const [schoolUser, schoolProfile, summary] = await Promise.all([
      User.findOne({ _id: sid, role: 'school' })
        .select('name email phone status createdAt') // keep minimal + stable
        .populate({
          path: 'profileImage',
          select: 'url',
          match: { status: 'READY', entityType: 'User' },
          options: { lean: true }
        })
        .lean({ virtuals: true }),

      // Pull schoolName from SchoolProfile
      SchoolProfileModel.findOne({
        $or: [{ school: sid }, { user: sid }]
      })
        .select('schoolName description website phone addresses address createdAt updatedAt')
        .lean(),

      (async () => {
        const [totalTeachers, totalStudents, totalCourses, totalRevenue] = await Promise.all([
          User.countDocuments({ role: 'teacher', school: sid }),
          User.countDocuments({ role: 'student', school: sid }),
          Course.countDocuments({ ownerId: sid }),
          (async () => {
            const courseIds = await Course.distinct('_id', { ownerId: sid });
            if (!courseIds?.length) return 0;

            const revAgg = await bookingModel.aggregate([
              { $match: { course: { $in: courseIds } } },
              // If you have payment status, you can add:
              // { $match: { paymentStatus: 'paid' } },
              {
                $group: {
                  _id: null,
                  totalRevenue: {
                    $sum: {
                      $let: {
                        vars: {
                          // "normal" totals (usually dollars)
                          totalAmount: { $ifNull: ['$totalAmount', null] },
                          amount: { $ifNull: ['$amount', null] },
                          grandTotal: { $ifNull: ['$grandTotal', null] },

                          // Stripe minor units (cents)
                          stripeAmount: { $ifNull: ['$meta.amount', null] }
                        },
                        in: {
                          $cond: [
                            // 1) Prefer totalAmount if present
                            { $ne: ['$$totalAmount', null] },
                            { $toDouble: '$$totalAmount' },

                            {
                              $cond: [
                                // 2) Else prefer amount if present
                                { $ne: ['$$amount', null] },
                                { $toDouble: '$$amount' },

                                {
                                  $cond: [
                                    // 3) Else prefer grandTotal if present
                                    { $ne: ['$$grandTotal', null] },
                                    { $toDouble: '$$grandTotal' },

                                    {
                                      $cond: [
                                        // 4) Else use Stripe meta.amount (minor units -> divide by 100)
                                        { $ne: ['$$stripeAmount', null] },
                                        {
                                          $divide: [
                                            {
                                              $toDouble: '$$stripeAmount'
                                            },
                                            100
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      }
                    }
                  }
                }
              }
            ]);

            return Number(revAgg?.[0]?.totalRevenue || 0);
          })()
        ]);

        return { totalTeachers, totalStudents, totalCourses, totalRevenue };
      })()
    ]);

    if (!schoolUser) {
      throw Object.assign(new Error('School not found'), { statusCode: 404 });
    }

    // Normalize profile fields from SchoolProfile (preferred) with safe fallbacks
    const profile = {
      schoolName:
        schoolProfile?.schoolName ||
        (schoolUser as any)?.profile?.schoolName || // fallback if older data exists
        schoolUser.name ||
        '',
      description: schoolProfile?.description || (schoolUser as any)?.profile?.description || '',
      website: schoolProfile?.website || (schoolUser as any)?.profile?.website || '',
      phone: schoolUser?.phone || (schoolUser as any)?.profile?.phone || '',
      addresses:
        (schoolProfile as any)?.addresses ||
        ((schoolProfile as any)?.address ? [(schoolProfile as any)?.address] : []) ||
        (schoolUser as any)?.profile?.addresses ||
        [] ||
        ((schoolUser as any)?.profile?.address ? [(schoolUser as any)?.profile?.address] : [])
    };

    // Keep response shape stable for FE
    const school = {
      ...schoolUser,
      profile
    };

    return {
      school,
      summary
    };
  }
};
