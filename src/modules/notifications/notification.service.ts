import { Types } from 'mongoose';
import { NotificationType, INotification, Notification } from '../../models/notification.model';
import { UserPayload } from '../../types/UserPayload';
import { User } from '../../models/user.model';
import { Course } from '../../models/course.model';
import BookingModel from '../../models/booking.model';
import { NotificationRepository } from './notification.repository';
import { NotificationDiffEntry } from './notificationDiff.util';

type CreateNotificationInput = {
  recipientUserId?: string;
  audienceRoles?: UserPayload['role'][];
  audienceSchoolId?: string;
  title: string;
  message: string;
  type: NotificationType;
  metadata?: Record<string, any>;
};

type CreateNotificationOnceInput = CreateNotificationInput & {
  idempotencyKey: string;
};

type EventActor = {
  id?: string;
  role?: string;
  displayName?: string;
};

type LessonEventInput = {
  event: 'LESSON_SCHEDULED' | 'LESSON_UPDATED' | 'LESSON_CANCELLED';
  actorUserId?: string;
  actorRole?: string;
  courseId: string;
  teacherId?: string;
  lessonId: string;
  title?: string;
  diff?: NotificationDiffEntry[];
  changedAt?: string;
};

type CourseUpdatedInput = {
  actorUserId?: string;
  actorRole?: string;
  courseId: string;
  title?: string;
  diff?: NotificationDiffEntry[];
  changedAt?: string;
};

type SchoolCustomMessageInput = {
  senderUser: UserPayload;
  schoolId?: string;
  teacherId: string;
  title?: string;
  message: string;
  context?: string;
};

const roleBasePath: Record<UserPayload['role'], string> = {
  super_admin: '/admin',
  school: '/school',
  teacher: '/teacher',
  parent: '/parent',
  student: '/student'
};

const lessonDeepLinkByRole: Record<UserPayload['role'], string> = {
  super_admin: '/admin/courses',
  school: '/school/lessons',
  teacher: '/teacher/manage-lessons',
  parent: '/parent/lessons',
  student: '/student/lessons'
};

const courseDeepLinkByRole: Record<UserPayload['role'], string> = {
  super_admin: '/admin/courses',
  school: '/school/manage-courses',
  teacher: '/teacher/manage-courses',
  parent: '/parent/lessons',
  student: '/student/lessons'
};

const titleByLessonEvent: Record<LessonEventInput['event'], string> = {
  LESSON_SCHEDULED: 'Lesson scheduled',
  LESSON_UPDATED: 'Lesson updated',
  LESSON_CANCELLED: 'Lesson cancelled'
};

const messageByLessonEvent: Record<LessonEventInput['event'], (lessonTitle: string) => string> = {
  LESSON_SCHEDULED: lessonTitle => `A new lesson "${lessonTitle}" has been scheduled.`,
  LESSON_UPDATED: lessonTitle => `Lesson "${lessonTitle}" was updated.`,
  LESSON_CANCELLED: lessonTitle => `Lesson "${lessonTitle}" was cancelled.`
};

const toObjectIdIfValid = (value?: string) =>
  value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;

const uniqueValidObjectIds = (values: Array<string | undefined | null>) =>
  [...new Set(values.filter(Boolean) as string[])].filter(v => Types.ObjectId.isValid(v));

const resolveActor = async (actorUserId?: string, actorRole?: string): Promise<EventActor> => {
  if (actorUserId && Types.ObjectId.isValid(actorUserId)) {
    const actor = await User.findById(actorUserId).select('_id role name').lean();
    if (actor) {
      return {
        id: String(actor._id),
        role: String(actor.role),
        displayName: String(actor.name || '')
      };
    }
  }

  return {
    id: actorUserId,
    role: actorRole
  };
};

const buildChangedMessage = (baseMessage: string, diff?: NotificationDiffEntry[]) => {
  const changeCount = Array.isArray(diff) ? diff.length : 0;
  if (changeCount <= 0) return baseMessage;
  return `${baseMessage} ${changeCount} field${changeCount > 1 ? 's' : ''} changed.`;
};

const PROFILE_REMINDER_CONTEXT = 'PROFILE_COMPLETION';
const PROFILE_REMINDER_COOLDOWN_HOURS = Number(process.env.PROFILE_REMINDER_COOLDOWN_HOURS || 24);

export const notificationService = {
  async list(user: UserPayload, filters: any) {
    const page = Number(filters.page || 1);
    const limit = Number(filters.limit || 20);

    return NotificationRepository.list(user, filters, page, limit);
  },

  async unreadCount(user: UserPayload) {
    return NotificationRepository.unreadCount(user);
  },

  async markAsRead(user: UserPayload, notificationId: string) {
    return NotificationRepository.markAsRead(user, notificationId);
  },

  async markAllAsRead(user: UserPayload, type?: string) {
    return NotificationRepository.markAllAsRead(user, type);
  },

  async removeForUser(user: UserPayload, notificationId: string) {
    return NotificationRepository.removeForUser(user, notificationId);
  },

  async create(input: CreateNotificationInput) {
    const payload: Partial<INotification> = {
      recipientUserId: toObjectIdIfValid(input.recipientUserId) || null,
      audienceRoles: input.audienceRoles || [],
      audienceSchoolId: toObjectIdIfValid(input.audienceSchoolId),
      title: input.title,
      message: input.message,
      type: input.type,
      metadata: input.metadata || {},
      isRead: false,
      readAt: null
    };

    await NotificationRepository.createMany([payload]);
  },

  async createOnce(input: CreateNotificationOnceInput) {
    const key = String(input.idempotencyKey || '').trim();
    if (!key) {
      await this.create(input);
      return true;
    }

    const recipientObjectId = toObjectIdIfValid(input.recipientUserId);
    const existing = await Notification.findOne({
      recipientUserId: recipientObjectId || null,
      type: input.type,
      'metadata.idempotencyKey': key
    })
      .select('_id')
      .lean();
    if (existing?._id) return false;

    const metadata = {
      ...(input.metadata || {}),
      idempotencyKey: key
    };
    await this.create({
      ...input,
      metadata
    });
    return true;
  },

  async createManyForUsers(
    userIds: string[],
    payload: Omit<CreateNotificationInput, 'recipientUserId'>
  ) {
    const deduped = [...new Set(userIds.filter(Boolean))].filter(v => Types.ObjectId.isValid(v));
    if (!deduped.length) return;

    const rows: Array<Partial<INotification>> = deduped.map(userId => ({
      recipientUserId: new Types.ObjectId(userId),
      audienceRoles: [],
      audienceSchoolId: null,
      title: payload.title,
      message: payload.message,
      type: payload.type,
      metadata: payload.metadata || {},
      isRead: false,
      readAt: null
    }));

    await NotificationRepository.createMany(rows);
  },

  async notifyLessonLifecycle(input: LessonEventInput) {
    const courseId = toObjectIdIfValid(input.courseId);
    if (!courseId) return;

    const [course, enrollmentRows, actor] = await Promise.all([
      Course.findById(courseId).select('ownerType ownerId title').lean(),
      BookingModel.find({
        course: courseId,
        paymentStatus: { $in: ['PAID', 'NOT_REQUIRED'] }
      })
        .select('student')
        .lean(),
      resolveActor(input.actorUserId, input.actorRole)
    ]);

    if (!course) return;

    const recipientIds = uniqueValidObjectIds([
      input.teacherId,
      course.ownerType === 'school' ? String(course.ownerId) : undefined,
      ...enrollmentRows.map((row: any) => String(row.student))
    ]).filter(id => id !== input.actorUserId);

    if (!recipientIds.length) return;

    const users = await User.find({ _id: { $in: recipientIds } })
      .select('_id role')
      .lean();
    const changedAt = input.changedAt || new Date().toISOString();

    const notifications = users.map(user => {
      const role = user.role as UserPayload['role'];
      const lessonTitle = input.title || course.title || 'Lesson';
      const deepLink = lessonDeepLinkByRole[role] || `${roleBasePath[role]}/notifications`;
      const baseMessage = messageByLessonEvent[input.event](lessonTitle);

      return {
        recipientUserId: user._id,
        audienceRoles: [],
        audienceSchoolId: null,
        title: titleByLessonEvent[input.event],
        message: buildChangedMessage(baseMessage, input.diff),
        type: input.event as NotificationType,
        metadata: {
          lessonId: input.lessonId,
          courseId: String(input.courseId),
          schoolId: course.ownerType === 'school' ? String(course.ownerId) : null,
          deepLink,
          action: input.event.toLowerCase(),
          diff: input.diff || [],
          actor,
          changedAt
        },
        isRead: false,
        readAt: null
      };
    });

    await NotificationRepository.createMany(notifications as any);
  },

  async notifyCourseUpdated(input: CourseUpdatedInput) {
    const courseId = toObjectIdIfValid(input.courseId);
    if (!courseId) return;

    const [course, enrollmentRows, actor] = await Promise.all([
      Course.findById(courseId).select('ownerType ownerId title teachers').lean(),
      BookingModel.find({
        course: courseId,
        paymentStatus: { $in: ['PAID', 'NOT_REQUIRED'] }
      })
        .select('student')
        .lean(),
      resolveActor(input.actorUserId, input.actorRole)
    ]);

    if (!course) return;

    const recipientIds = uniqueValidObjectIds([
      course.ownerType === 'school' ? String(course.ownerId) : undefined,
      ...(course.teachers || []).map((id: any) => String(id)),
      ...enrollmentRows.map((row: any) => String(row.student))
    ]).filter(id => id !== input.actorUserId);

    if (!recipientIds.length) return;

    const users = await User.find({ _id: { $in: recipientIds } })
      .select('_id role')
      .lean();
    const changedAt = input.changedAt || new Date().toISOString();
    const courseTitle = input.title || String(course.title || 'Course');

    const notifications = users.map(user => {
      const role = user.role as UserPayload['role'];
      const deepLink = courseDeepLinkByRole[role] || `${roleBasePath[role]}/notifications`;
      const baseMessage = `Course "${courseTitle}" was updated.`;

      return {
        recipientUserId: user._id,
        audienceRoles: [],
        audienceSchoolId: null,
        title: 'Course updated',
        message: buildChangedMessage(baseMessage, input.diff),
        type: 'COURSE_UPDATED' as NotificationType,
        metadata: {
          courseId: String(courseId),
          schoolId: course.ownerType === 'school' ? String(course.ownerId) : null,
          deepLink,
          action: 'course_updated',
          diff: input.diff || [],
          actor,
          changedAt
        },
        isRead: false,
        readAt: null
      };
    });

    await NotificationRepository.createMany(notifications as any);
  },

  async sendSchoolCustomMessage(input: SchoolCustomMessageInput) {
    const senderId = String(input.senderUser?.id || '');
    if (!Types.ObjectId.isValid(senderId)) {
      throw Object.assign(new Error('Invalid sender id'), { statusCode: 400 });
    }

    const teacherId = String(input.teacherId || '');
    const senderRole = String(input.senderUser?.role || '');

    if (!Types.ObjectId.isValid(teacherId)) {
      throw Object.assign(new Error('Invalid teacherId'), { statusCode: 400 });
    }

    const [teacher, sender] = await Promise.all([
      User.findOne({ _id: teacherId, role: 'teacher' }).select('_id name school').lean(),
      User.findById(senderId).select('_id role name').lean()
    ]);
    if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 404 });
    if (!sender) throw Object.assign(new Error('Sender not found'), { statusCode: 404 });

    let resolvedSchoolId = '';
    if (senderRole === 'school') {
      resolvedSchoolId = String(senderId);
      if (!teacher.school || String(teacher.school) !== resolvedSchoolId) {
        throw Object.assign(new Error('Teacher does not belong to this school'), {
          statusCode: 404
        });
      }
    } else if (senderRole === 'super_admin') {
      const explicitSchoolId = String(input.schoolId || '').trim();
      if (explicitSchoolId) {
        if (!Types.ObjectId.isValid(explicitSchoolId)) {
          throw Object.assign(new Error('Invalid schoolId'), { statusCode: 400 });
        }
        resolvedSchoolId = explicitSchoolId;
      } else if (teacher.school) {
        resolvedSchoolId = String(teacher.school);
      }
    } else {
      throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    }

    let schoolName = 'HelloK12';
    if (resolvedSchoolId && Types.ObjectId.isValid(resolvedSchoolId)) {
      const school = await User.findOne({ _id: resolvedSchoolId, role: 'school' })
        .select('_id name')
        .lean();
      if (school) schoolName = String(school.name || schoolName);
      if (!school && senderRole === 'school') {
        throw Object.assign(new Error('School not found'), { statusCode: 404 });
      }
    }

    const since = new Date(Date.now() - 60 * 1000);
    const recentCount = await Notification.countDocuments({
      type: 'SCHOOL_CUSTOM_MESSAGE',
      createdAt: { $gte: since },
      'metadata.sentBy.id': senderId
    });
    if (recentCount >= 20) {
      throw Object.assign(new Error('Rate limit exceeded. Try again in a minute.'), {
        statusCode: 429
      });
    }

    const context =
      String(input.context || PROFILE_REMINDER_CONTEXT).trim() || PROFILE_REMINDER_CONTEXT;
    if (context === PROFILE_REMINDER_CONTEXT) {
      const cooldownStart = new Date(Date.now() - PROFILE_REMINDER_COOLDOWN_HOURS * 60 * 60 * 1000);
      const recentReminder = await Notification.findOne({
        type: 'SCHOOL_CUSTOM_MESSAGE',
        recipientUserId: new Types.ObjectId(teacherId),
        'metadata.context': PROFILE_REMINDER_CONTEXT,
        ...(resolvedSchoolId ? { 'metadata.schoolId': resolvedSchoolId } : {}),
        createdAt: { $gte: cooldownStart }
      })
        .sort({ createdAt: -1 })
        .select('createdAt')
        .lean();

      if (recentReminder?.createdAt) {
        const nextAllowedAt = new Date(
          new Date(recentReminder.createdAt).getTime() +
            PROFILE_REMINDER_COOLDOWN_HOURS * 60 * 60 * 1000
        );
        const remainingMs = Math.max(0, nextAllowedAt.getTime() - Date.now());
        const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));
        throw Object.assign(
          new Error(`Reminder recently sent. Try again in ${remainingMinutes} minute(s).`),
          {
            statusCode: 429,
            remainingMs,
            nextAllowedAt: nextAllowedAt.toISOString()
          }
        );
      }
    }

    const title = String(input.title || '').trim() || 'Complete your profile';
    const idempotencyKey = `school_custom:${context}:${resolvedSchoolId || 'platform'}:${teacherId}:${new Date()
      .toISOString()
      .slice(0, 16)}`;

    await this.createOnce({
      recipientUserId: teacherId,
      idempotencyKey,
      type: 'SCHOOL_CUSTOM_MESSAGE',
      title,
      message: String(input.message || '').trim(),
      metadata: {
        schoolId: resolvedSchoolId || null,
        schoolName,
        teacherId,
        context,
        sentBy: {
          id: String(sender._id),
          role: String(sender.role),
          displayName: String(sender.name || '')
        },
        deepLink: '/teacher/profile-settings',
        changedAt: new Date().toISOString()
      }
    });
  }
};
