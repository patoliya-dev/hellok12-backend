import { Types } from 'mongoose';
import { User } from '../../models/user.model';
import { StudentProfileModel } from '../../models/studentProfile.model';
import { ParentProfileModel } from '../../models/parentProfile.model';

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

export const AdminService = {
  getSchools: async ({ page, limit, search }: { page: string; limit: string; search: string }) => {
    const pageNum = Math.max(1, parseInt(String(page || '1'), 10) || 1);
    const limitNum = Math.max(1, Math.min(200, parseInt(String(limit || '50'), 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const q: any = { role: 'school' };

    const term = String(search || '').trim();
    if (term) {
      const rx = new RegExp(escapeRegex(term), 'i');
      q.$or = [{ name: rx }, { email: rx }, { 'profile.schoolName': rx }];
    }

    const [total, schools] = await Promise.all([
      User.countDocuments(q),
      User.find(q)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select('name email status profile createdAt')
        .lean()
    ]);

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
    if (!Types.ObjectId.isValid(userId))
      throw Object.assign(new Error('Invalid user id'), { statusCode: 400 });

    const user = await User.findById(userId);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    // Allow updating these on User
    const userPatch = pick<{ name: string; phone?: string; school?: Types.ObjectId }>(payload, [
      'name',
      'phone',
      'school'
    ] as any);

    // Basic
    if (userPatch.name !== undefined) user.name = String(userPatch.name).trim();
    if (userPatch.phone !== undefined) user.phone = String(userPatch.phone).trim();

    // school only for students/teachers – for now, allow only if role=student
    if (payload?.school !== undefined) {
      if (user.role === 'student') {
        if (payload.school && Types.ObjectId.isValid(String(payload.school))) {
          user.school = new Types.ObjectId(String(payload.school));
        } else {
          user.school = undefined;
        }
      }
    }

    // profile patch (embedded)
    const profile = payload?.profile || {};
    user.profile = user.profile || {};

    // Common editable profile fields
    if (profile.address !== undefined) user.profile.address = String(profile.address);
    if (profile.languages !== undefined)
      user.profile.languages = Array.isArray(profile.languages) ? profile.languages : [];

    // Student-only fields
    if (user.role === 'student') {
      if (profile.age !== undefined)
        user.profile.age = profile.age === null ? undefined : Number(profile.age);
      if (profile.gender !== undefined) user.profile.gender = profile.gender || undefined;

      // Keep StudentProfile collection in sync (if you still use it)
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

    // Parent-only: keep ParentProfile synced if needed
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
  }
};
