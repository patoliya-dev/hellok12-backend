import { Types } from 'mongoose';
import { User } from '../../models/user.model';
import emailService from '../../utils/email.service';
import Logger from '../../utils/winstonLogger.utils';
import { Course } from '../../models/course.model';
import bookingModel from '../../models/booking.model';
import { SessionModel } from '../../models/sessions.model';
import { Lesson } from '../../models/lesson.model';
import { Invitation } from '../../models/invitation.model';
import { normalizeEmail, generateRawToken, hashToken } from '../invitations/invitation.util';
import { TeacherProfileDoc } from '../../models/teacherProfile.model';

type RecipientRole = 'teacher' | 'student';

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
    schoolId: string,
    email: string,
    recipientRole: RecipientRole,
    message?: string
  ) => {
    const recipientEmail = normalizeEmail(email);
    const role = recipientRole as 'teacher' | 'student';

    const school = await User.findById(schoolId).lean();
    if (!school) throw Object.assign(new Error('School not found'), { statusCode: 404 });
    if (!school.isVerified)
      throw Object.assign(new Error('School must be verified'), { statusCode: 403 });

    const existingUser = await User.findOne({ email: recipientEmail }).lean();
    if (existingUser && existingUser.role !== role.toLowerCase()) {
      throw Object.assign(new Error('User exists with different role'), { statusCode: 409 });
    }

    const now = new Date();

    const already = await Invitation.findOne({
      organization: new Types.ObjectId(schoolId),
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
      invitedBy: schoolId,
      organization: schoolId,
      recipientEmail,
      recipientRole: role,
      inviterRole: 'school',
      invitationMessage: message || '',
      inviteToken: tokenHash,
      status: 'pending',
      meta: { flow: 'SCHOOL_INVITE' },
      expiresAt
    });

    const clientURL = process.env.CLIENT_URL!;
    const inviteLink = `${clientURL}/accept-invitation?inviteId=${invitation._id}&ticket=${rawTicket}`;

    if (role === 'teacher') {
      await emailService.sendTeacherInvitation(recipientEmail, school.name, inviteLink, message);
    } else {
      await emailService.sendStudentInvitation(recipientEmail, school.name, inviteLink, message);
    }

    return {
      invitationId: String(invitation._id),
      expiresAt
    };
  },

  listInvitations: async (schoolId: string, role?: string, status?: string) => {
    const query: any = { organization: new Types.ObjectId(schoolId) };
    if (role) query.recipientRole = role;
    if (status) query.status = status;

    const invitations = await Invitation.find(query)
      .sort({ createdAt: -1 })
      .select('recipientEmail recipientRole status expiresAt createdAt invitationMessage')
      .lean();

    return { success: true, data: { invitations } };
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

  // (kept from your existing code)
  getStudents: async (schoolId: string, page: string, limit: string) => {
    // keep your existing enrollment-based student listing for now
    // when you implement Invite Student acceptance linking student.school,
    // you can later list directly by User.school + role=student.
    // ... (your existing getStudents code can remain as-is)

    const courses = await Course.find({ ownerId: new Types.ObjectId(schoolId) });
    const courseIds = courses.map(c => c._id);
    if (courseIds.length === 0) return [];

    const bookingFilter: any = { course: { $in: courseIds } };
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const total = await bookingModel.countDocuments(bookingFilter);

    const bookings = await bookingModel
      .find(bookingFilter)
      .populate({
        path: 'student',
        select: 'name email phone profile.age profile.grade profile.gender status',
        populate: [
          { path: 'studentProfile', select: 'address languages age gender' },
          { path: 'profileImage', select: 'url' }
        ],
        options: { virtuals: true }
      })
      .skip(skip)
      .limit(limitNum);

    const enrollments = bookings.map((booking: any) => ({
      _id: booking.student._id,
      name: booking.student.name,
      email: booking.student.email,
      phone: booking.student.phone,
      profile: booking.student.studentProfile,
      profileImage: booking.student.profileImage,
      status: booking.student.status,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt
    }));

    const pages = Math.ceil(total / limitNum);

    return {
      success: true,
      data: {
        students: enrollments,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages,
          hasNextPage: pageNum < pages,
          hasPrevPage: pageNum > 1
        }
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
