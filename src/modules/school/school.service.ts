import { Types } from 'mongoose';
import { User } from '../../models/user.model';
import { uuidv4 } from 'zod';
import emailService from '../../utils/email.service';
import Logger from '../../utils/winstonLogger.utils';
import { Course } from '../../models/course.model';
import bookingModel from '../../models/booking.model';
import { SessionModel } from '../../models/sessions.model';
import { Lesson } from '../../models/lesson.model';

export const SchoolService = {
  getSchoolTeachers: async (schoolId: string) => {
    const teachers = await User.find({
      school: new Types.ObjectId(schoolId),
      role: 'teacher'
    }).select('name');
    return {
      teachers
    };
  },

  inviteTeacher: async (schoolId: string, email: string, message?: string) => {
    try {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new Error('Invalid email format');
      }

      const school = await User.findById(schoolId);
      if (!school) {
        throw new Error('School not found');
      }

      if (!school.isVerified) {
        throw new Error('School must be verified before inviting teachers');
      }

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        if (existingUser.role !== 'teacher') {
          throw new Error('A user with this email already exists with a different role');
        }
      }

      try {
        await emailService.sendTeacherInvitation(email, school.name, schoolId, message);
      } catch (emailError) {
        Logger.error('Failed to send invitation email:', emailError);
      }

      Logger.info(`Teacher invitation sent: ${email} from school ${school.name}`);

      return {
        success: true,
        message: 'Invitation sent successfully'
      };
    } catch (error: any) {
      Logger.error('Error inviting teacher:', error);
      throw new Error(error.message || 'Failed to invite teacher');
    }
  },

  inviteStudent: async (schoolId: string, email: string, message?: string) => {
    try {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new Error('Invalid email format');
      }

      const school = await User.findById(schoolId);
      if (!school) {
        throw new Error('School not found');
      }

      if (!school.isVerified) {
        throw new Error('School must be verified before inviting teachers');
      }

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        throw new Error('A user with this email already exists with a different role');
      }

      try {
        await emailService.sendStudentInvitation(email, school.name, schoolId, message);
      } catch (emailError) {
        Logger.error('Failed to send invitation email:', emailError);
      }

      Logger.info(`Student invitation sent: ${email} from school ${school.name}`);

      return {
        success: true,
        message: 'Invitation sent successfully'
      };
    } catch (error: any) {
      Logger.error('Error inviting teacher:', error);
      throw new Error(error.message || 'Failed to invite teacher');
    }
  },

  getStudents: async (schoolId: string, page: string, limit: string) => {
    const courses = await Course.find({
      ownerId: new Types.ObjectId(schoolId)
    });
    const courseIds = courses.map(c => c._id);

    if (courseIds.length === 0) {
      return [];
    }

    const bookingFilter: any = {
      course: { $in: courseIds }
    };

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
          {
            path: 'studentProfile',
            select: 'address languages age gender'
          },
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
    const courseFilter: any = {
      ownerId: schoolId,
      status: 'active'
    };

    if (courseId) {
      courseFilter._id = courseId;
    }

    const courses = await Course.find(courseFilter);
    const courseIds = courses.map(c => c._id);

    if (courseIds.length === 0) {
      return [];
    }

    const lessonFilter: any = {
      courseId: { $in: courseIds },
      status: 'active'
    };

    // Get total count
    const total = await Lesson.countDocuments(lessonFilter);

    // Fetch lessons with populated data
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

    // For each lesson, get session details and enrolled students
    const lessonIds = lessons.map(l => l._id);

    // Fetch sessions for these lessons
    const sessions = await SessionModel.find({
      lesson: { $in: lessonIds }
    })
      .populate({
        path: 'students',
        select: 'name email phone profile.age profile.grade',
        populate: [{ path: 'profileImage', select: 'url' }]
      })
      .exec();

    // Create a map of lesson -> session data
    const sessionMap = new Map();
    sessions.forEach(session => {
      const lessonId = session.lesson.toString();
      if (!sessionMap.has(lessonId)) {
        sessionMap.set(lessonId, []);
      }
      sessionMap.get(lessonId).push(session);
    });

    // Format response
    const upcomingLessons = lessons.map((lesson: any) => {
      const lessonSessions = sessionMap.get(lesson._id.toString()) || [];

      // Get unique enrolled students across all sessions
      const enrolledStudentsMap = new Map();
      lessonSessions.forEach((session: any) => {
        session.students?.forEach((student: any) => {
          if (!enrolledStudentsMap.has(student._id.toString())) {
            enrolledStudentsMap.set(student._id.toString(), {
              id: student._id,
              name: student.name,
              email: student.email,
              phone: student.phone,
              age: student.profile?.age,
              grade: student.profile?.grade,
              profileImage: student.profileImage?.url || null
            });
          }
        });
      });

      return {
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
      };
    });

    return {
      success: true,
      data: {
        lessons: upcomingLessons,
        summary: {
          totalLessons: total
        }
      }
    };
  }
};
