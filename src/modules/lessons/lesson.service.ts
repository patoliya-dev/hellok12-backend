import { Lesson, LessonDoc } from '../../models/lesson.model';
import { Course } from '../../models/course.model';
import { FilterQuery, Types } from 'mongoose';
import { LessonItemInput } from './lesson.schemas';
import { normalizeToHHMM24, parseStartEnd } from './lesson.util';
import { SessionModel, SessionStatus } from '../../models/sessions.model';
import {
  addPaginationToPipeline,
  addSortToPipeline,
  buildBaseFilter,
  buildLessonsPipeline,
  getPendingCount,
  getTotalCount
} from './lesson.queries';
import { transformSessionToLesson } from './lesson.helper';
import sessionService from '../sessions/sessions.service';
import Logger from '../../utils/winstonLogger.utils';

interface GetLessonsQuery {
  teacherId: string;
  startDate?: string;
  endDate?: string;
  status?: SessionStatus | 'all';
  studentName?: string;
  sortBy?: 'date' | 'student' | 'status' | 'subject';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

interface LessonResponse {
  _id: string;
  dateTime: {
    date: string;
    time: string;
  };
  student:
    | {
        _id: string;
        name: string;
        age: number;
      }
    | Array<{
        _id: string;
        name: string;
        age: number;
      }>;
  courseType: '1-on-1' | 'group';
  subject: {
    name: string;
    mode: 'online' | 'in-person';
  };
  duration: number;
  status: SessionStatus;
}

interface PaginatedResponse {
  lessons: LessonResponse[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  pendingCount: number;
}

type CreateArgs = { courseId: Types.ObjectId; lessons: LessonItemInput[] };
type UpdateArgs = {
  courseId: Types.ObjectId;
  updates: Array<{
    lessonId: string;
    title?: string;
    description?: string;
    schedule?: { date?: Date; time?: string; duration?: number };
    status?: 'draft' | 'active' | 'archived';
    isTrialAvailable?: boolean;
    trialCapacity?: number;
    order?: number;
    vocabulary?: string[];
  }>;
  deletes: string[];
};

type ListOpts = {
  search?: string;
  status?: 'draft' | 'active' | 'archived';
  isTrialAvailable?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
  sort?: Record<string, 1 | -1>;
  page: number;
  limit: number;
};

// Calendar types
interface CalendarQuery {
  userId: Types.ObjectId;
  userRole: string;
  month: number;
  year: number;
  courseId?: string;
}

interface MonthOverview {
  [date: string]: { count: number; lessons: { id: string; title: string; time: string }[] };
}

interface DaySession {
  _id: Types.ObjectId;
  title: string;
  time: string;
  duration: number;
  status: string;
  courseTitle?: string;
  lessonId: Types.ObjectId;
  order: number;
}

interface QuickStats {
  total: number;
  pending: number;
  completed: number;
}

const defaultSort: Record<string, 1 | -1> = { startAt: -1, _id: 1 };

const sortMap: Record<string, Record<string, 1 | -1>> = {
  newest: { createdAt: -1, _id: 1 },
  titleAsc: { title: 1, _id: 1 },
  titleDesc: { title: -1, _id: 1 },
  startAtAsc: { startAt: 1, _id: 1 },
  startAtDesc: { startAt: -1, _id: 1 },
  statusAsc: { status: 1, _id: 1 },
  statusDesc: { status: -1, _id: 1 }
};

function fromKeyDir(key?: string, dir?: 'asc' | 'desc') {
  if (!key || !dir) return undefined;
  const d = dir.toLowerCase() === 'asc' ? 1 : -1;
  return { [key]: d, _id: 1 } as Record<string, 1 | -1>;
}

async function getNextOrderForCourse(courseId: Types.ObjectId) {
  const latest = await Lesson.findOne({ courseId }).sort({ order: -1 }).select({ order: 1 }).lean();
  return (latest?.order ?? -1) + 1;
}

async function checkOverlap({
  teacherId,
  courseId,
  startAt,
  endAt,
  exceptId
}: {
  teacherId: Types.ObjectId;
  courseId: Types.ObjectId;
  startAt: Date;
  endAt: Date;
  exceptId?: Types.ObjectId;
}) {
  const q: any = {
    teacherId,
    courseId,
    status: { $ne: 'archived' },
    startAt: { $lt: endAt },
    endAt: { $gt: startAt }
  };
  if (exceptId) q._id = { $ne: exceptId };
  const clash = await Lesson.findOne(q).select({ _id: 1 }).lean();
  if (clash) {
    const e = new Error('Lesson time overlaps with an existing lesson');
    (e as any).code = '409_CONFLICT_OVERLAP';
    throw e;
  }
}

async function recomputeCourseTrialAvailability(courseId: Types.ObjectId) {
  const now = new Date();
  const trial = await Lesson.exists({
    courseId,
    isTrialAvailable: true,
    startAt: { $gte: now },
    status: { $ne: 'archived' }
  })
    .select({ _id: 1 })
    .lean();

  await Course.updateOne({ _id: courseId }, { $set: { isTrialAvailable: !!trial } });
}

// Helper functions for calendar
function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC'
  });
}

function calculateDuration(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

export const LessonService = {
  async getCalendarOverview(
    userId: Types.ObjectId | string,
    userRole: 'teacher' | 'student' | 'school',
    month: number,
    year: number
  ) {
    const uid = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    const role = userRole?.toLowerCase();

    const startOfMonth = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

    // Build user filter
    const userFilter: any = {};

    if (role === 'teacher') {
      userFilter.teacher = uid;
    } else if (role === 'student') {
      userFilter.students = uid;
    } else if (role === 'school') {
      const schoolCourses = await Course.find({
        ownerId: uid,
        ownerType: 'school'
      })
        .select('_id')
        .lean();

      if (schoolCourses.length > 0) {
        userFilter.course = { $in: schoolCourses.map(c => c._id) };
      }
    }

    const monthFilter = {
      ...userFilter,
      start: { $gte: startOfMonth, $lte: endOfMonth }
    };

    const allSessions = await SessionModel.find(monthFilter)
      .populate('lesson', 'title')
      .sort({ start: 1 })
      .lean();

    // Build month overview (grouped by date)
    const monthOverview: Record<
      string,
      {
        count: number;
        lessons: { id: string; title: string; time: string }[];
      }
    > = {};

    for (const session of allSessions) {
      const dateKey = session.start.toISOString().split('T')[0];

      if (!monthOverview[dateKey]) {
        monthOverview[dateKey] = { count: 0, lessons: [] };
      }

      monthOverview[dateKey].count++;
      monthOverview[dateKey].lessons.push({
        id: session._id.toString(),
        title: (session.lesson as any)?.title || 'Untitled',
        time: formatTime(session.start)
      });
    }

    // Calculate stats
    const stats = {
      total: allSessions.length,
      pending: allSessions.filter(
        s => s.status === SessionStatus.SCHEDULED || s.status === SessionStatus.IN_PROGRESS
      ).length,
      completed: allSessions.filter(s => s.status === SessionStatus.COMPLETED).length
    };

    return { monthOverview, stats };
  },

  async getSessionsByDate(
    userId: Types.ObjectId | string,
    userRole: 'teacher' | 'student' | 'school',
    date: string
  ) {
    const uid = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    const role = userRole?.toLowerCase();

    // Parse date
    const [yearStr, monthStr, dayStr] = date.split('-');
    const y = parseInt(yearStr);
    const m = parseInt(monthStr) - 1;
    const d = parseInt(dayStr);

    const startOfDay = new Date(y, m, d, 0, 0, 0, 0);
    const endOfDay = new Date(y, m, d, 23, 59, 59, 999);

    // Build user filter
    const userFilter: any = {};

    if (role === 'teacher') {
      userFilter.teacher = uid;
    } else if (role === 'student') {
      userFilter.students = uid;
    } else if (role === 'school') {
      const schoolCourses = await Course.find({
        ownerId: uid,
        ownerType: 'school'
      })
        .select('_id')
        .lean();

      if (schoolCourses.length > 0) {
        userFilter.course = { $in: schoolCourses.map(c => c._id) };
      }
    }

    const filter = {
      ...userFilter,
      start: { $gte: startOfDay, $lte: endOfDay }
    };

    const sessions = await SessionModel.find(filter)
      .populate('lesson', 'title schedule')
      .populate('course', 'title')
      .sort({ start: 1 })
      .lean();

    return sessions.map((s, idx) => ({
      _id: s._id,
      title: (s.lesson as any)?.title || 'Untitled',
      time: formatTime(s.start),
      duration: calculateDuration(s.start, s.end),
      status: s.status,
      courseTitle: (s.course as any)?.title,
      lessonId: s.lesson,
      order: idx + 1
    }));
  },

  async getLessonsDashboard(userId: string) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const lessons = await SessionModel.find({ teacher: userId, start: { $gte: start, $lt: end } })
      .populate({
        path: 'lesson',
        select: 'title _id schedule status startAt endAt description isTrialAvailable',
        populate: {
          path: 'teacherId',
          select: 'name _id',
          populate: { path: 'profileImage', select: 'url' }
        }
      })
      .populate({
        path: 'course',
        select: 'title _id mode description lessonType',
        populate: { path: 'introImageRef', select: 'url' }
      })
      .select('joinUrl status')
      .lean();

    return lessons;
  },

  async create(data: Partial<LessonDoc>) {
    if (typeof data.order !== 'number') {
      const last = await Lesson.findOne({ courseId: data.courseId }).sort({ order: -1 }).lean();
      data.order = last ? (last.order || 0) + 1 : 0;
    }

    if (data.schedule) {
      const normalizedTime = normalizeToHHMM24((data.schedule as any).time);
      if (normalizedTime) (data.schedule as any).time = normalizedTime;
      if (data.startAt && typeof data.startAt === 'string') {
        data.startAt = new Date(data.startAt);
      }
      if (!(data as any).startAt) {
        const { startAt, endAt } = parseStartEnd({
          date: (data.schedule as any).date,
          time: (data.schedule as any).time,
          duration: (data.schedule as any).duration
        });
        (data as any).startAt = startAt;
        (data as any).endAt = endAt;
      } else {
        if (!(data as any).endAt) {
          const dur = Number((data.schedule as any).duration || 0);
          (data as any).endAt = new Date((data as any).startAt.getTime() + dur * 60000);
        }
      }
    }

    const doc = await Lesson.create(data);

    if (data.courseId) {
      const hasTrial = await Lesson.exists({
        courseId: data.courseId,
        isTrialAvailable: true,
        startAt: { $gte: new Date() }
      });
      await Course.findByIdAndUpdate(data.courseId, { $set: { isTrialAvailable: !!hasTrial } });
    }

    return doc.toObject();
  },

  async update(id: string, patch: Partial<LessonDoc>) {
    const before = await Lesson.findById(id).lean();
    if (!before) return null;

    if (patch.isTrialAvailable) {
      const exists = await Lesson.exists({
        courseId: before.courseId,
        isTrialAvailable: true,
        _id: { $ne: id },
        startAt: { $gte: new Date() }
      });
      if (exists) throw new Error('TRIAL_EXISTS');
    }

    if (patch.schedule) {
      const normalizedTime = normalizeToHHMM24((patch.schedule as any).time);
      if (normalizedTime) (patch.schedule as any).time = normalizedTime;
      if ((patch.schedule as any).startAt) {
        (patch as any).startAt = new Date((patch.schedule as any).startAt as any);
      } else {
        const { startAt, endAt } = parseStartEnd({
          date: (patch.schedule as any).date ?? before.schedule?.date,
          time: (patch.schedule as any).time ?? before.schedule?.time,
          duration: (patch.schedule as any).duration ?? before.schedule?.duration
        });
        (patch as any).startAt = startAt;
        (patch as any).endAt = endAt;
      }
    }

    const updated = await Lesson.findByIdAndUpdate(
      id,
      { $set: patch },
      { new: true, runValidators: true }
    ).lean();

    if (updated) {
      const hasTrial = await Lesson.exists({
        courseId: updated.courseId,
        isTrialAvailable: true,
        startAt: { $gte: new Date() }
      });
      await Course.findByIdAndUpdate(updated.courseId, { $set: { isTrialAvailable: !!hasTrial } });
    }

    return updated;
  },

  async remove(id: string) {
    const removed = await Lesson.findByIdAndDelete(id).lean();
    if (removed) {
      const hasTrial = await Lesson.exists({
        courseId: removed.courseId,
        isTrialAvailable: true,
        startAt: { $gte: new Date() }
      });
      await Course.findByIdAndUpdate(removed.courseId, { $set: { isTrialAvailable: !!hasTrial } });
    }
    return removed;
  },

  async duplicate(id: string) {
    const src = await Lesson.findById(id).lean();
    if (!src) return null;
    const copy = await Lesson.create({
      ...src,
      _id: undefined,
      title: `${src.title} (Copy)`,
      isTrialAvailable: false,
      order: (src.order || 0) + 1
    });
    return copy.toObject();
  },

  async reorder(courseId: string, pairs: { lessonId: string; order: number }[]) {
    const bulk = pairs.map(p => ({
      updateOne: { filter: { _id: p.lessonId, courseId }, update: { $set: { order: p.order } } }
    }));
    if (bulk.length) await Lesson.bulkWrite(bulk);
    return true;
  },

  resolveSort(q: {
    sortBy?: keyof typeof sortMap;
    sortKey?: 'title' | 'startAt' | 'createdAt' | 'status';
    sortDirection?: 'asc' | 'desc';
  }) {
    if (q.sortBy && sortMap[q.sortBy]) return sortMap[q.sortBy];
    const kd = fromKeyDir(q.sortKey, q.sortDirection);
    return kd || defaultSort;
  },

  async listByCourse(courseId: string, opts: ListOpts) {
    const filter: FilterQuery<LessonDoc> = { courseId: new Types.ObjectId(courseId) };

    if (opts.status) filter.status = opts.status;
    if (typeof opts.isTrialAvailable === 'boolean') {
      filter.isTrialAvailable = opts.isTrialAvailable;
    }

    if (opts.dateFrom || opts.dateTo) {
      filter.startAt = {};
      if (opts.dateFrom) filter.startAt.$gte = opts.dateFrom;
      if (opts.dateTo) filter.startAt.$lte = opts.dateTo;
    }

    if (opts.search) {
      filter.$or = [
        { title: { $regex: opts.search, $options: 'i' } },
        { description: { $regex: opts.search, $options: 'i' } }
      ];
    }

    const sort = opts.sort || defaultSort;
    const skip = (opts.page - 1) * opts.limit;

    const [items, total] = await Promise.all([
      Lesson.find(filter).sort(sort).skip(skip).limit(opts.limit).lean(),
      Lesson.countDocuments(filter)
    ]);

    return {
      items,
      pagination: {
        page: opts.page,
        limit: opts.limit,
        total,
        pages: Math.ceil(total / opts.limit)
      }
    };
  },

  async bulkCreateForCourse({ courseId, lessons }: CreateArgs) {
    const course = await Course.findById(courseId).lean();
    if (!course) {
      const e = new Error('Course not found');
      (e as any).code = '404_NOT_FOUND';
      throw e;
    }
    const teacherId: Types.ObjectId = (course as any).teacherId || (course as any).ownerId;

    if (!teacherId) {
      const e = new Error('Course missing assigned teacher');
      (e as any).code = '422_VALIDATION';
      (e as any).fields = [{ path: 'course.teacherId', message: 'Assigned teacher is required' }];
      throw e;
    }

    let nextOrder = await getNextOrderForCourse(courseId);
    const docs = [];

    for (let i = 0; i < lessons.length; i++) {
      const l = lessons[i];
      if (!l.schedule?.time || !l.schedule?.date) {
        const e = new Error('Missing schedule time/date');
        (e as any).code = '422_VALIDATION';
        (e as any).fields = [
          { path: `lessons.${i}.schedule.time`, message: 'Time is required' },
          { path: `lessons.${i}.schedule.date`, message: 'Date is required' }
        ];
        throw e;
      }

      const normalizedTime = normalizeToHHMM24(l.schedule.time);
      if (!normalizedTime) {
        const e = new Error('Invalid schedule.time');
        (e as any).code = '422_VALIDATION';
        (e as any).fields = [
          { path: `lessons.${i}.schedule.time`, message: 'Invalid time format' }
        ];
        throw e;
      }
      l.schedule.time = normalizedTime;

      const { startAt, endAt } = parseStartEnd(l.schedule as any);
      await checkOverlap({ teacherId, courseId, startAt, endAt });

      docs.push({
        courseId,
        teacherId,
        title: l.title,
        description: l.description?.trim() ?? undefined,
        schedule: l.schedule,
        startAt,
        endAt,
        status: l.status || 'draft',
        isTrialAvailable: !!l.isTrialAvailable,
        trialCapacity: l.isTrialAvailable ? (l.trialCapacity ?? 1) : undefined,
        order: typeof l.order === 'number' ? l.order : nextOrder++
      });
    }

    const created = await Lesson.insertMany(docs);
    await recomputeCourseTrialAvailability(courseId);

    return { items: created.map(d => d.toObject()), count: created.length };
  },

  async bulkUpdateForCourse({ courseId, updates, deletes }: UpdateArgs) {
    const course = await Course.findById(courseId).lean();
    if (!course) {
      const e = new Error('Course not found');
      (e as any).code = '404_NOT_FOUND';
      throw e;
    }
    const teacherId: Types.ObjectId = (course as any).teacherId || (course as any).ownerId;

    const ops: any[] = [];
    const sessionsToUpdate: Array<{ lessonId: string; startAt: Date; endAt: Date }> = [];

    for (const id of deletes || []) {
      if (!Types.ObjectId.isValid(id)) continue;
      ops.push({ deleteOne: { filter: { _id: new Types.ObjectId(id), courseId } } });
    }

    for (const u of updates || []) {
      if (!Types.ObjectId.isValid(u.lessonId)) continue;
      const _id = new Types.ObjectId(u.lessonId);

      const $set: Record<string, any> = {};
      if (u.title !== undefined) $set.title = u.title;
      if (u.description !== undefined) $set.description = u.description ?? '';
      if (u.isTrialAvailable !== undefined) $set.isTrialAvailable = !!u.isTrialAvailable;
      if (u.trialCapacity !== undefined) $set.trialCapacity = u.trialCapacity;
      if (u.order !== undefined) $set.order = u.order;
      if (u.vocabulary !== undefined) $set.vocabulary = u.vocabulary;
      if (u.status !== undefined) $set.status = u.status;

      if (u.schedule) {
        const base = await Lesson.findOne({ _id, courseId })
          .select({ schedule: 1, startAt: 1, endAt: 1 })
          .lean();
        const merged = {
          date: u.schedule.date ?? base?.schedule?.date,
          time: u.schedule.time ?? base?.schedule?.time,
          duration: u.schedule.duration ?? base?.schedule?.duration
        } as any;

        if (merged.time) {
          const nt = normalizeToHHMM24(merged.time);
          if (!nt) {
            const e = new Error('Invalid schedule.time');
            (e as any).code = '422_VALIDATION';
            (e as any).fields = [{ path: `updates.schedule.time`, message: 'Invalid time format' }];
            throw e;
          }
          merged.time = nt;
        }

        const { startAt, endAt } = parseStartEnd(merged as any);
        await checkOverlap({ teacherId, courseId, startAt, endAt, exceptId: _id });
        $set.schedule = merged;
        $set.startAt = startAt;
        $set.endAt = endAt;

        sessionsToUpdate.push({ lessonId: _id.toString(), startAt, endAt });
      }

      if (Object.keys($set).length) {
        ops.push({ updateOne: { filter: { _id, courseId }, update: { $set } } });
      }
    }

    if (ops.length === 0) {
      const current = await Lesson.find({ courseId }).lean();
      await recomputeCourseTrialAvailability(courseId);
      return { items: current, count: current.length };
    }

    await Lesson.bulkWrite(ops, { ordered: false });
    await recomputeCourseTrialAvailability(courseId);

    const refreshed = await Lesson.find({ courseId }).sort({ order: 1 }).lean();
    if (course?.mode === 'in-person') {
      return { items: refreshed, count: refreshed.length };
    }

    // Update sessions for lessons with schedule changes
    if (sessionsToUpdate.length > 0) {
      await Promise.all(
        sessionsToUpdate.map(async ({ lessonId, startAt, endAt }) => {
          try {
            await sessionService.updateSessionForLesson({
              lessonId,
              courseId: courseId.toString(),
              teacherId: teacherId.toString(),
              start: startAt,
              end: endAt
            });
          } catch (error: any) {
            Logger.error(`Failed to update session for lesson ${lessonId}:`, error);
          }
        })
      );
    }
    return { items: refreshed, count: refreshed.length };
  },

  getLessons: async (query: GetLessonsQuery) => {
    const {
      teacherId,
      startDate,
      endDate,
      status,
      studentName,
      sortBy = 'dateTime',
      sortOrder = 'desc',
      page = 1,
      limit = 10
    } = query;

    // Build base filter
    const filter = buildBaseFilter(teacherId, startDate, endDate, status);

    // Build aggregation pipeline
    const pipeline = buildLessonsPipeline(filter, studentName);

    // Add sorting
    addSortToPipeline(pipeline, sortBy, sortOrder);

    // Get total count
    const total = await getTotalCount(pipeline);

    // Add pagination
    addPaginationToPipeline(pipeline, page, limit);

    // Execute aggregation
    const sessions = await SessionModel.aggregate(pipeline);

    // Get pending count
    const pendingCount = await getPendingCount(teacherId);

    // Transform data
    const lessons = sessions.map(session => transformSessionToLesson(session));

    return {
      lessons,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      pendingCount
    };
  }
};
