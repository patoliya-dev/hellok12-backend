import { Types } from 'mongoose';
import { User } from '../../models/user.model';
import emailService from '../../utils/email.service';
import { Course } from '../../models/course.model';
import bookingModel from '../../models/booking.model';
import { SessionModel } from '../../models/sessions.model';
import { Lesson } from '../../models/lesson.model';
import { Invitation } from '../../models/invitation.model';
import { normalizeEmail, generateRawToken, hashToken } from '../invitations/invitation.util';
import { TeacherProfileDoc } from '../../models/teacherProfile.model';

type RecipientRole = 'teacher' | 'student' | 'parent';

type ProfileImageLean = { url?: string } | null;

// IMPORTANT: This is a plain object shape (NOT extending Document)
type TeacherLean = {
  _id: Types.ObjectId;
  name: string;
  email?: string;
  phone?: string;
  status?: 'pending' | 'active' | 'suspended' | 'inactive';
  availabilityStatus?: 'online' | 'offline';
  approvedAt?: Date;
  createdAt: Date;

  // virtual populated fields
  teacherProfile?: (TeacherProfileDoc & { _id: any }) | null;
  profileImage?: ProfileImageLean;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseAgeRange(ageRange: string): { min?: number; max?: number } {
  const raw = String(ageRange || '').trim();
  if (!raw) return {};
  if (raw.includes('+')) {
    const min = Number(raw.replace('+', '').trim());
    return Number.isFinite(min) ? { min } : {};
  }
  if (raw.includes('-')) {
    const [a, b] = raw.split('-').map(x => Number(String(x).trim()));
    const min = Number.isFinite(a) ? a : undefined;
    const max = Number.isFinite(b) ? b : undefined;
    return { min, max };
  }
  const exact = Number(raw);
  return Number.isFinite(exact) ? { min: exact, max: exact } : {};
}

type GetStudentsArgs = {
  inviterId: string;
  inviterRole: string;
  page: string;
  limit: string;
  search?: string;
  status?: string;
  school?: string;
  language?: string;
  ageRange?: string;
};

export const SchoolService = {
  getSchoolTeachers: async (schoolId: string) => {
    const schoolObjectId = new Types.ObjectId(schoolId);

    const teachers = await User.find({
      school: schoolObjectId,
      role: 'teacher'
    })
      .select('name email phone status availabilityStatus approvedAt createdAt') // do not select virtuals here
      .populate({
        path: 'teacherProfile',
        options: { lean: true }
      })
      .populate({
        path: 'profileImage',
        select: 'url',
        match: { status: 'READY', entityType: 'User' },
        options: { lean: true }
      })
      .lean<TeacherLean[]>({ virtuals: true });

    if (!teachers.length) {
      return {
        teachers: [],
        summary: { total: 0, active: 0, pending: 0 }
      };
    }

    const teacherIds = teachers.map(t => t._id);

    const lessonsAgg: Array<{ _id: Types.ObjectId; totalLessons: number }> = await Lesson.aggregate(
      [
        {
          $match: {
            teacherId: { $in: teacherIds },
            status: 'active'
          }
        },
        {
          $group: {
            _id: '$teacherId',
            totalLessons: { $sum: 1 }
          }
        }
      ]
    );

    const lessonsMap = new Map<string, number>(
      lessonsAgg.map(l => [String(l._id), l.totalLessons])
    );

    const studentsAgg: Array<{ _id: Types.ObjectId; totalStudents: number }> =
      await SessionModel.aggregate([
        { $match: { teacher: { $in: teacherIds } } },
        { $unwind: '$students' },
        { $group: { _id: { teacher: '$teacher', student: '$students' } } },
        { $group: { _id: '$_id.teacher', totalStudents: { $sum: 1 } } }
      ]);

    const studentsMap = new Map<string, number>(
      studentsAgg.map(s => [String(s._id), s.totalStudents])
    );

    const mappedTeachers = teachers.map(t => {
      const tid = String(t._id);

      return {
        _id: t._id,
        name: t.name,
        email: t.email,
        phone: t.phone,
        status: t.status,
        availabilityStatus: t.availabilityStatus,
        approvedAt: t.approvedAt,
        createdAt: t.createdAt,

        avatar: t.profileImage?.url ?? null,
        teacherProfile: t.teacherProfile ?? null,

        stats: {
          totalLessons: lessonsMap.get(tid) ?? 0,
          totalStudents: studentsMap.get(tid) ?? 0,
          // NOTE: your TeacherProfile schema doesn’t show averageRating; keep fallback stable for FE
          rating: (t.teacherProfile as any)?.averageRating ?? '—'
        }
      };
    });

    const summary = {
      total: mappedTeachers.length,
      active: mappedTeachers.filter(t => t.status === 'active').length,
      pending: mappedTeachers.filter(t => t.status === 'pending').length
    };

    return { teachers: mappedTeachers, summary };
  },

  inviteUser: async (
    inviterId: string,
    inviterRole: string,
    email: string,
    recipientRole: RecipientRole,
    message?: string
  ) => {
    const recipientEmail = normalizeEmail(email);
    const role = recipientRole as 'teacher' | 'student';

    const inviter = await User.findById(inviterId).lean();
    if (!inviter) throw Object.assign(new Error('School not found'), { statusCode: 404 });
    if (!inviter.isVerified)
      throw Object.assign(new Error('School must be verified'), { statusCode: 403 });

    const existingUser = await User.findOne({ email: recipientEmail }).lean();
    if (existingUser && existingUser.role !== role.toLowerCase()) {
      throw Object.assign(new Error('User exists with different role'), { statusCode: 409 });
    }

    const now = new Date();

    const already = await Invitation.findOne({
      organization: new Types.ObjectId(inviterId),
      recipientEmail,
      recipientRole: role,
      status: 'pending',
      expiresAt: { $gt: now }
    }).lean();

    if (already) {
      return {
        invitationId: String(already._id),
        expiresAt: already.expiresAt,
        alreadyInvited: true
      };
    }

    const rawTicket = generateRawToken();
    const tokenHash = hashToken(rawTicket);
    const expiresAt = new Date(Date.now() + 7 * 86400000);

    const invitation = await Invitation.create({
      invitedBy: inviterId,
      organization: inviterId,
      recipientEmail,
      recipientRole: role,
      inviterRole,
      invitationMessage: message || '',
      inviteToken: tokenHash,
      status: 'pending',
      meta: { flow: `${inviterRole.toUpperCase()}_INVITE` },
      expiresAt
    });

    const clientURL = process.env.CLIENT_URL!;
    const inviteLink = `${clientURL}/accept-invitation?inviteId=${invitation._id}&ticket=${rawTicket}`;

    if (role === 'teacher') {
      await emailService.sendTeacherInvitation(recipientEmail, inviter.name, inviteLink, message);
    } else if (role === 'student') {
      await emailService.sendStudentInvitation(recipientEmail, inviter.name, inviteLink, message);
    } else {
      await emailService.sendParentInvitation(recipientEmail, inviter.name, inviteLink, message);
    }

    return {
      invitationId: String(invitation._id),
      expiresAt
    };
  },

  listInvitations: async (
    schoolId: string,
    role?: string,
    status?: string,
    search?: string,
    page?: string,
    limit?: string
  ) => {
    const schoolObjectId = new Types.ObjectId(schoolId);

    const pageNum = Math.max(1, parseInt(String(page || '1'), 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(String(limit || '10'), 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const query: any = { organization: schoolObjectId };

    const normalizedRole = String(role || '')
      .trim()
      .toLowerCase();
    if (normalizedRole) query.recipientRole = normalizedRole;

    const normalizedStatus = String(status || '')
      .trim()
      .toLowerCase();
    if (normalizedStatus) query.status = normalizedStatus;

    if (search && String(search).trim()) {
      const s = String(search).trim();
      const rx = new RegExp(escapeRegex(s), 'i');

      // searchable fields (safe + useful)
      query.$or = [
        { recipientEmail: rx }
        // { invitationMessage: rx },
        // { recipientRole: rx },
        // { status: rx }
      ];
    }

    const [total, invitations] = await Promise.all([
      Invitation.countDocuments(query),
      Invitation.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select('recipientEmail recipientRole status expiresAt createdAt invitationMessage')
        .lean()
    ]);

    const pages = Math.max(1, Math.ceil(total / limitNum));

    return {
      invitations,
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

  cancelInvitation: async (schoolId: string, invitationId: string) => {
    if (!Types.ObjectId.isValid(invitationId))
      throw Object.assign(new Error('Invalid invitation id'), { statusCode: 400 });

    const inv = await Invitation.findOne({
      _id: new Types.ObjectId(invitationId),
      organization: new Types.ObjectId(schoolId)
    });

    if (!inv) throw Object.assign(new Error('Invitation not found'), { statusCode: 404 });
    if (inv.status !== 'pending')
      throw Object.assign(new Error('Only pending invitations can be cancelled'), {
        statusCode: 409
      });

    inv.status = 'cancelled';
    await inv.save();

    return { success: true, data: { cancelled: true } };
  },

  approveRejectTeacher: async (
    schoolId: string,
    teacherId: string,
    action: 'approve' | 'reject'
  ) => {
    if (!Types.ObjectId.isValid(teacherId))
      throw Object.assign(new Error('Invalid teacher id'), { statusCode: 400 });

    const teacher = await User.findOne({
      _id: new Types.ObjectId(teacherId),
      role: 'teacher',
      school: new Types.ObjectId(schoolId)
    });
    if (!teacher)
      throw Object.assign(new Error('Teacher not found under this school'), { statusCode: 404 });

    if (action === 'approve') {
      teacher.profile = { ...(teacher.profile || {}) };
      teacher.approvedBy = new Types.ObjectId(schoolId);
      teacher.approvedAt = new Date();
      teacher.status = 'active';
      await teacher.save();
      return { success: true, data: { approved: true } };
    }

    // REJECT: unlink (cleanest for school-managed staff)
    teacher.school = undefined;
    teacher.profile = { ...(teacher.profile || {}) };
    teacher.status = 'inactive';
    await teacher.save();
    return { success: true, data: { rejected: true } };
  },

  getStudents: async ({
    inviterId,
    inviterRole,
    page,
    limit,
    search,
    status,
    school,
    language,
    ageRange
  }: GetStudentsArgs) => {
    const pageNum = Math.max(1, parseInt(String(page || '1'), 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(String(limit || '10'), 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const role = String(inviterRole || '').toLowerCase();

    // -----------------------------
    // A) Determine scope
    // -----------------------------
    let scopedIds: Types.ObjectId[] | null = null;

    if (role === 'school') {
      const inviterObjectId = new Types.ObjectId(inviterId);

      const courses = await Course.find({ ownerId: inviterObjectId }).select('_id').lean();
      const courseIds = courses.map(c => c._id);

      let enrolledStudentIds: Types.ObjectId[] = [];
      if (courseIds.length > 0) {
        const raw = await bookingModel.distinct('student', { course: { $in: courseIds } });
        enrolledStudentIds = (raw || [])
          .map((id: any) =>
            id instanceof Types.ObjectId
              ? id
              : Types.ObjectId.isValid(String(id))
                ? new Types.ObjectId(String(id))
                : null
          )
          .filter((x): x is Types.ObjectId => Boolean(x));
      }

      const invitedStudentIds = await User.distinct('_id', {
        role: 'student',
        school: inviterObjectId
      });

      scopedIds = Array.from(
        new Set([...enrolledStudentIds, ...invitedStudentIds].map(id => String(id)))
      ).map(id => new Types.ObjectId(id));

      if (scopedIds.length === 0) {
        return {
          students: [],
          pagination: {
            total: 0,
            page: pageNum,
            limit: limitNum,
            pages: 1,
            hasNextPage: false,
            hasPrevPage: false
          }
        };
      }
    }

    // super_admin: global scope; apply optional school filter

    // -----------------------------
    // B) Build base user match
    // -----------------------------
    const userMatch: any = { role: 'student' };

    if (scopedIds) userMatch._id = { $in: scopedIds };

    const normalizedStatus = String(status || '')
      .trim()
      .toLowerCase();
    if (normalizedStatus && normalizedStatus !== 'all') userMatch.status = normalizedStatus;

    const schoolStr = String(school || '').trim();
    if (schoolStr && schoolStr !== 'all' && Types.ObjectId.isValid(schoolStr)) {
      userMatch.school = new Types.ObjectId(schoolStr);
    }

    const term = String(search || '').trim();
    if (term) {
      const maybeId = Types.ObjectId.isValid(term) ? new Types.ObjectId(term) : null;
      const rx = new RegExp(escapeRegex(term), 'i');
      userMatch.$or = [
        ...(maybeId ? [{ _id: maybeId }] : []),
        { name: rx },
        { email: rx },
        { phone: rx }
      ];
    }

    const lang = String(language || '').trim();
    const { min: ageMin, max: ageMax } = parseAgeRange(String(ageRange || ''));

    // -----------------------------
    // C) Aggregate with lookup to StudentProfile + facet for pagination
    // -----------------------------
    const pipeline: any[] = [
      { $match: userMatch },

      {
        $lookup: {
          from: 'studentprofiles', // collection name (mongoose pluralizes StudentProfile)
          localField: '_id',
          foreignField: 'user',
          as: 'studentProfile'
        }
      },
      { $unwind: { path: '$studentProfile', preserveNullAndEmptyArrays: true } },

      // Profile image lookup
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

      // Apply language filter (supports studentProfile.languages)
      ...(lang
        ? [
            {
              $match: { $or: [{ 'studentProfile.languages': lang }, { 'profile.languages': lang }] }
            }
          ]
        : []),

      // Apply age filter:
      // studentProfile.age is string in your schema, so convert safely
      ...(ageMin !== undefined || ageMax !== undefined
        ? [
            {
              $match: {
                $or: [
                  {
                    'studentProfile.age': {
                      ...(ageMin !== undefined ? { $gte: ageMin } : {}),
                      ...(ageMax !== undefined ? { $lte: ageMax } : {})
                    }
                  },
                  {
                    'profile.age': {
                      ...(ageMin !== undefined ? { $gte: ageMin } : {}),
                      ...(ageMax !== undefined ? { $lte: ageMax } : {})
                    }
                  }
                ]
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
                name: 1,
                email: 1,
                phone: 1,
                status: 1,
                school: 1,
                createdAt: 1,
                updatedAt: 1,
                profile: 1,
                studentProfile: 1,
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

    const students = items.map((u: any) => ({
      _id: u._id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      school: u.school,
      profile: u.studentProfile || u.profile || null,
      profileImage: u.profileImage || null,
      status: u.status,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt
    }));

    return {
      students,
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

  getUpcomingLessons: async (schoolId: string, courseId?: string) => {
    // keep your existing implementation
    // ... (your existing getUpcomingLessons code can remain as-is)

    const courseFilter: any = { ownerId: schoolId, status: 'active' };
    if (courseId) courseFilter._id = courseId;

    const courses = await Course.find(courseFilter);
    const courseIds = courses.map(c => c._id);
    if (courseIds.length === 0) return [];

    const lessonFilter: any = { courseId: { $in: courseIds }, status: 'active' };
    const total = await Lesson.countDocuments(lessonFilter);

    const lessons = await Lesson.find(lessonFilter)
      .populate({
        path: 'courseId',
        select: 'title mode lessonType price currency studentCapacity enrolledCount'
      })
      .populate({
        path: 'teacherId',
        select: 'name email phone',
        populate: { path: 'profileImage', select: 'url' }
      });

    const lessonIds = lessons.map(l => l._id);

    const sessions = await SessionModel.find({ lesson: { $in: lessonIds } })
      .populate({
        path: 'students',
        select: 'name email phone profile.age profile.grade',
        populate: [{ path: 'profileImage', select: 'url' }]
      })
      .exec();

    const sessionMap = new Map();
    sessions.forEach(session => {
      const lessonId = session.lesson.toString();
      if (!sessionMap.has(lessonId)) sessionMap.set(lessonId, []);
      sessionMap.get(lessonId).push(session);
    });

    const upcomingLessons = lessons.map((lesson: any) => ({
      _id: lesson._id,
      subject: lesson.courseId?.title || lesson.title,
      title: lesson.title,
      description: lesson.description || '',
      status: lesson.status,
      startTime: lesson.startAt,
      endTime: lesson.endAt,
      duration: lesson.schedule.duration,
      lessonDate: lesson.schedule.date,
      lessonType: lesson.courseId?.lessonType || '1-on-1',
      lessonMode: lesson.courseId?.mode || 'online',
      isTrailAvailable: lesson.isTrialAvailable,
      teacher: {
        name: lesson.teacherId?.name || 'Unknown',
        avatar: lesson.teacherId?.profileImage?.url || null
      },
      courseId: lesson.courseId?._id || null,
      createdAt: lesson.createdAt
    }));

    return {
      success: true,
      data: { lessons: upcomingLessons, summary: { totalLessons: total } }
    };
  }
};
