import { DateTime } from 'luxon';
import { FilterQuery, Types } from 'mongoose';
import { Lesson, LessonDoc } from '../../models/lesson.model';
import { Course } from '../../models/course.model';
import { LessonItemInput } from './lesson.schemas';
import { getDayRangeFromISO, normalizeToHHMM24, parseStartEnd } from './lesson.util';
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
import { FeedbackRating } from '../../models/feedbackRatings.model';
import bookingModel from '../../models/booking.model';
import { CourseOption, LessonItem, LessonListQuery, LessonViewType } from '../../types/LessonTypes';

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

type CreateArgs = {
  courseId: Types.ObjectId;
  lessons: LessonItemInput[];
  timeZone?: string;
  userRole?: string;
};
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
  timeZone?: string;
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
  const query: any = {
    teacherId,
    courseId,
    status: { $ne: 'archived' },
    // find any lesson where start < endAt and end > startAt
    startAt: { $lt: endAt },
    endAt: { $gt: startAt }
  };
  if (exceptId) query._id = { $ne: exceptId };
  const clash = await Lesson.findOne(query)
    .select({ _id: 1, title: 1, startAt: 1, endAt: 1 })
    .lean();
  if (clash) {
    const e: any = new Error('Lesson time overlaps with an existing lesson');
    e.code = '409_CONFLICT_OVERLAP';
    e.meta = { clash };
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
function formatTime(date: Date, timeZone: string): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone
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
    year: number,
    timeZone: string
  ) {
    const uid = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    const role = userRole?.toLowerCase();

    // choose a timezone. If controller passes user timezone, receive it (see below).
    // For teacher/student views prefer user's timezone; if not available default to UTC.
    const startOfMonth = DateTime.fromObject({ year, month }, { zone: timeZone })
      .startOf('month')
      .toUTC()
      .toJSDate();
    const endOfMonth = DateTime.fromObject({ year, month }, { zone: timeZone })
      .endOf('month')
      .toUTC()
      .toJSDate();

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
        time: formatTime(session.start, timeZone)
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
    date: string,
    timeZone: string = 'UTC'
  ) {
    const uid = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    const role = userRole?.toLowerCase();

    // Parse date
    const [yearStr, monthStr, dayStr] = date.split('-');
    const y = parseInt(yearStr);
    const m = parseInt(monthStr) - 1;
    const d = parseInt(dayStr);

    // import { DateTime } from 'luxon';
    // tz should be passed from controller (req.userTimezone), default UTC if not provided
    const startOfDay = DateTime.fromObject({ year: y, month: m + 1, day: d }, { zone: timeZone })
      .startOf('day')
      .toUTC()
      .toJSDate();
    const endOfDay = DateTime.fromObject({ year: y, month: m + 1, day: d }, { zone: timeZone })
      .endOf('day')
      .toUTC()
      .toJSDate();

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
      time: formatTime(s.start, timeZone),
      duration: calculateDuration(s.start, s.end),
      status: s.status,
      courseTitle: (s.course as any)?.title,
      lessonId: s.lesson,
      order: idx + 1
    }));
  },

  async getLessonsDashboard(userId: string, timeZone: string) {
    const start = DateTime.now().setZone(timeZone).startOf('day').toUTC().toJSDate();
    const end = DateTime.now().setZone(timeZone).endOf('day').toUTC().toJSDate();

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

  async create(data: Partial<LessonDoc>, timeZone: string = 'UTC') {
    if (typeof data.order !== 'number') {
      const last = await Lesson.findOne({ courseId: data.courseId }).sort({ order: -1 }).lean();
      data.order = last ? (last.order || 0) + 1 : 0;
    }

    if (data.schedule) {
      const normalizedTime = normalizeToHHMM24((data.schedule as any).time);
      if (normalizedTime) (data.schedule as any).time = normalizedTime;
      const { startAt, endAt } = await parseStartEnd(
        {
          date: (data.schedule as any).date,
          time: (data.schedule as any).time,
          duration: (data.schedule as any).duration
        },
        undefined,
        undefined,
        timeZone
      );
      // (data as any).startAt = startAt;
      // (data as any).endAt = endAt;
      (data as any).startAt = new Date(startAt.toISOString());
      (data as any).endAt = new Date(endAt.toISOString());
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

  async update(id: string, patch: Partial<LessonDoc>, timeZone: string = 'UTC') {
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
        // If caller directly provided startAt, coerce to canonical UTC Date
        (patch as any).startAt = new Date(
          new Date((patch.schedule as any).startAt as any).toISOString()
        );
      } else {
        const { startAt, endAt } = await parseStartEnd(
          {
            date: (patch.schedule as any).date ?? before.schedule?.date,
            time: (patch.schedule as any).time ?? before.schedule?.time,
            duration: (patch.schedule as any).duration ?? before.schedule?.duration
          },
          undefined,
          undefined,
          timeZone
        );

        // Coerce
        (patch as any).startAt = new Date(startAt.toISOString());
        (patch as any).endAt = new Date(endAt.toISOString());
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
    const lesson: any = await Lesson.findById(id).populate('courseId').lean();
    if (!lesson) return null;

    if (lesson.courseId.enrolledCount > 0) {
      const e = new Error('Lesson cannot be removed because student is already enrolled');
      (e as any).code = '409_CONFLICT_OVERLAP';
      throw e;
    }
    const session = await SessionModel.findOneAndDelete({ lesson: new Types.ObjectId(id) }).lean();
    if (!session) return null;

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

  async bulkCreateForCourse({ courseId, lessons, timeZone = 'UTC', userRole }: CreateArgs) {
    const course = await Course.findById(courseId).lean();
    if (!course) {
      const e = new Error('Course not found');
      (e as any).code = '404_NOT_FOUND';
      throw e;
    }

    // Step 1 — Parse & normalize all incoming lessons, compute their UTC start/end (respecting timeZone)
    const parsed: Array<{
      index: number;
      teacherId: Types.ObjectId;
      original: any;
      schedule: any;
      startAtUtc: Date;
      endAtUtc: Date;
    }> = [];

    for (let i = 0; i < lessons.length; i++) {
      const l = lessons[i];
      const teacherId: Types.ObjectId =
        userRole === 'teacher' ? (course as any).ownerId : l.teacherId;

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

      // defensive: require local-date or Date object (reject full ISO with offset in bulk create)
      if (
        typeof l.schedule.date === 'string' &&
        !/^\d{4}-\d{2}-\d{2}$/.test(String(l.schedule.date).trim())
      ) {
        const err = new Error(
          'schedule.date must be YYYY-MM-DD (local date) or Date object - do not send full ISO with offsets'
        );
        (err as any).code = '422_VALIDATION';
        (err as any).fields = [
          { path: `lessons.${i}.schedule.date`, message: 'Use YYYY-MM-DD (local date)' }
        ];
        throw err;
      }

      // compute canonical start/end instants (UTC) for this lesson
      const { startAt, endAt } = await parseStartEnd(
        { date: l.schedule.date, time: normalizedTime, duration: l.schedule.duration },
        undefined,
        undefined,
        timeZone
      );

      const startAtUtc = new Date(startAt.toISOString());
      const endAtUtc = new Date(endAt.toISOString());

      parsed.push({
        index: i,
        teacherId,
        original: l,
        schedule: { ...l.schedule, time: normalizedTime },
        startAtUtc,
        endAtUtc
      });
    }

    // Step 2 — DB-level overlap detection (any incoming interval vs any existing lesson)
    if (parsed.length > 0) {
      // Build $or clauses to find any existing lesson overlapping any incoming interval
      const orClauses = parsed.map(p => ({
        teacherId: p.teacherId,
        courseId,
        status: { $ne: 'archived' },
        startAt: { $lt: p.endAtUtc },
        endAt: { $gt: p.startAtUtc }
      }));

      const existingClash = await Lesson.findOne({ $or: orClauses })
        .select({ _id: 1, title: 1, startAt: 1, endAt: 1 })
        .lean();
      if (existingClash) {
        const e: any = new Error('Lesson time overlaps with an existing lesson');
        e.code = '409_CONFLICT_OVERLAP';
        e.meta = { clash: existingClash };
        throw e;
      }
    }

    // Step 3 — Intra-batch overlap detection (two incoming lessons overlapping each other)
    if (parsed.length > 1) {
      // Sort by start time
      const sorted = parsed.slice().sort((a, b) => a.startAtUtc.getTime() - b.startAtUtc.getTime());
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        if (a.endAtUtc.getTime() > b.startAtUtc.getTime()) {
          const e: any = new Error('Incoming lessons overlap with each other');
          e.code = '409_CONFLICT_OVERLAP';
          e.meta = {
            conflictBetween: [a.index, b.index],
            a: { startAt: a.startAtUtc.toISOString(), endAt: a.endAtUtc.toISOString() },
            b: { startAt: b.startAtUtc.toISOString(), endAt: b.endAtUtc.toISOString() }
          };
          throw e;
        }
      }
    }

    // Step 4 — Build docs array (now that all checks passed)
    let nextOrder = await getNextOrderForCourse(courseId);
    const docs: any[] = parsed.map(p => ({
      courseId,
      teacherId: p.teacherId,
      title: p.original.title,
      description: p.original.description?.trim() ?? undefined,
      schedule: {
        ...p.schedule, // keep date string, normalized time (HH:mm)
        time: p.schedule.time
      },
      startAt: p.startAtUtc,
      endAt: p.endAtUtc,
      status: p.original.status || 'draft',
      isTrialAvailable: !!p.original.isTrialAvailable,
      trialCapacity: p.original.isTrialAvailable ? (p.original.trialCapacity ?? 1) : undefined,
      order: typeof p.original.order === 'number' ? p.original.order : nextOrder++
    }));

    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.debug(
        '[LessonService.bulkCreateForCourse] documents to insert (first 3):',
        docs.slice(0, 3).map(d => ({
          startAt: d.startAt.toISOString(),
          endAt: d.endAt.toISOString(),
          schedule: d.schedule
        }))
      );
    }

    const created = await Lesson.insertMany(docs);
    await recomputeCourseTrialAvailability(courseId);

    return { items: created.map(d => d.toObject()), count: created.length };
  },

  async bulkUpdateForCourse({ courseId, updates, deletes, timeZone = 'UTC' }: UpdateArgs) {
    const course = await Course.findById(courseId).lean();
    if (!course) {
      const e = new Error('Course not found');
      (e as any).code = '404_NOT_FOUND';
      throw e;
    }
    const teacherId: Types.ObjectId = (course as any).teacherId || (course as any).ownerId;

    const ops: any[] = [];
    const sessionsToUpdate: Array<{ lessonId: string; startAt: Date; endAt: Date }> = [];

    // collect delete ops first
    for (const id of deletes || []) {
      if (!Types.ObjectId.isValid(id)) continue;
      ops.push({ deleteOne: { filter: { _id: new Types.ObjectId(id), courseId } } });
    }

    // 1) Pre-parse all updates that contain schedule changes and compute canonical UTC intervals
    const parsedUpdates: Array<{
      lessonId: Types.ObjectId;
      index: number;
      original: any;
      mergedSchedule?: { date: any; time: string; duration: number };
      startAtUtc?: Date;
      endAtUtc?: Date;
      setFields?: Record<string, any>;
    }> = [];

    let updIndex = 0;
    for (const u of updates || []) {
      if (!Types.ObjectId.isValid(u.lessonId)) {
        updIndex++;
        continue;
      }
      const _id = new Types.ObjectId(u.lessonId);

      const setFields: Record<string, any> = {};
      if (u.title !== undefined) setFields.title = u.title;
      if (u.description !== undefined) setFields.description = u.description ?? '';
      if (u.isTrialAvailable !== undefined) setFields.isTrialAvailable = !!u.isTrialAvailable;
      if (u.trialCapacity !== undefined) setFields.trialCapacity = u.trialCapacity;
      if (u.order !== undefined) setFields.order = u.order;
      if (u.vocabulary !== undefined) setFields.vocabulary = u.vocabulary;
      if (u.status !== undefined) setFields.status = u.status;

      const entry: any = {
        lessonId: _id,
        index: updIndex,
        original: u,
        setFields
      };

      if (u.schedule) {
        // fetch base to merge existing schedule values
        const base = await Lesson.findOne({ _id, courseId })
          .select({ schedule: 1, startAt: 1, endAt: 1 })
          .lean();
        const merged = {
          date: u.schedule.date ?? base?.schedule?.date,
          time: u.schedule.time ?? base?.schedule?.time,
          duration: u.schedule.duration ?? base?.schedule?.duration
        } as any;

        // validate/normalize time if present
        if (merged.time) {
          const nt = normalizeToHHMM24(merged.time);
          if (!nt) {
            const e = new Error('Invalid schedule.time');
            (e as any).code = '422_VALIDATION';
            (e as any).fields = [
              { path: `updates.${updIndex}.schedule.time`, message: 'Invalid time format' }
            ];
            throw e;
          }
          merged.time = nt;
        }

        // compute start/end instants
        const { startAt, endAt } = await parseStartEnd(
          { date: merged.date, time: merged.time, duration: merged.duration },
          undefined,
          undefined,
          timeZone
        );
        const startUtc = new Date(startAt.toISOString());
        const endUtc = new Date(endAt.toISOString());

        entry.mergedSchedule = merged;
        entry.startAtUtc = startUtc;
        entry.endAtUtc = endUtc;
        entry.setFields = { ...setFields, schedule: merged, startAt: startUtc, endAt: endUtc };
      }

      parsedUpdates.push(entry);
      updIndex++;
    }

    // 2) DB-level overlap detection:
    // Build a single query that checks the incoming intervals against DB lessons, **excluding all lessons
    // that are present in this same update payload** (they'll be moved by this request).
    if (parsedUpdates.length > 0) {
      // collect only updates that have start/end computed
      const intervals = parsedUpdates
        .filter(p => p.startAtUtc && p.endAtUtc)
        .map(p => ({ start: p.startAtUtc!, end: p.endAtUtc!, id: p.lessonId }));

      if (intervals.length > 0) {
        // ids being updated - exclude them from DB clash check
        const updatedIds = intervals.map(i => i.id);

        // Build OR clauses comparing each incoming interval against any existing lesson (teacher-scope).
        // Note: keep the scope to the teacher (we want to prevent teacher double-booking).
        const orClauses = intervals.map(i => ({
          startAt: { $lt: i.end },
          endAt: { $gt: i.start }
        }));

        // Single DB query: teacher + active status + exclude updatedIds + any overlap
        const existingClash = await Lesson.findOne({
          teacherId,
          status: { $ne: 'archived' },
          _id: { $nin: updatedIds },
          $or: orClauses
        })
          .select({ _id: 1, title: 1, startAt: 1, endAt: 1 })
          .lean();

        if (existingClash) {
          const e: any = new Error('Lesson time overlaps with an existing lesson');
          e.code = '409_CONFLICT_OVERLAP';
          e.meta = { clash: existingClash };
          throw e;
        }
      }
    }

    // 3) Intra-payload overlap detection among parsedUpdates (ignore items without schedule changes)
    const toCheck = parsedUpdates
      .filter(p => p.startAtUtc && p.endAtUtc)
      .map(p => ({
        id: p.lessonId.toString(),
        start: p.startAtUtc!,
        end: p.endAtUtc!,
        idx: p.index
      }));
    if (toCheck.length > 1) {
      toCheck.sort((a, b) => a.start.getTime() - b.start.getTime());
      for (let i = 0; i < toCheck.length - 1; i++) {
        const a = toCheck[i];
        const b = toCheck[i + 1];
        if (a.end.getTime() > b.start.getTime()) {
          const e: any = new Error('Incoming updates overlap with each other');
          e.code = '409_CONFLICT_OVERLAP';
          e.meta = {
            conflictBetween: [a.idx, b.idx],
            a: { start: a.start.toISOString(), end: a.end.toISOString() },
            b: { start: b.start.toISOString(), end: b.end.toISOString() }
          };
          throw e;
        }
      }
    }

    // 4) Build ops for updates (include schedule/startAt/endAt where present)
    for (const p of parsedUpdates) {
      if (Object.keys(p.setFields || {}).length) {
        ops.push({
          updateOne: { filter: { _id: p.lessonId, courseId }, update: { $set: p.setFields } }
        });
        if (p.startAtUtc && p.endAtUtc) {
          sessionsToUpdate.push({
            lessonId: p.lessonId.toString(),
            startAt: p.startAtUtc,
            endAt: p.endAtUtc
          });
        }
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

    const enrolledStudents = await bookingModel
      .find({
        course: courseId,
        paymentStatus: 'PAID'
      })
      .select('student')
      .lean();

    const studentIds = enrolledStudents.map((booking: any) => booking.student.toString());

    if (sessionsToUpdate.length > 0) {
      await Promise.all(
        sessionsToUpdate.map(async ({ lessonId, startAt, endAt }) => {
          try {
            await sessionService.updateSessionForLesson({
              lessonId,
              courseId: courseId.toString(),
              teacherId: teacherId.toString(),
              start: startAt,
              end: endAt,
              students: studentIds
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
  },
  async getLessonsForStudent(studentId: string, timeZone: string) {
    const { start, end } = getDayRangeFromISO(undefined, timeZone);

    const lessons: any = await SessionModel.find({
      students: { $in: studentId },
      start: { $gte: start, $lt: end }
    })
      .populate({
        path: 'lesson',
        select: 'title _id schedule status description isTrialAvailable',
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
      .select('joinUrl status start end')
      .lean();

    const teacherIds = lessons.map((lesson: any) => lesson.lesson?.teacherId?._id).filter(Boolean);

    const ratings = await FeedbackRating.aggregate([
      {
        $match: {
          teacher: { $in: teacherIds }
        }
      },
      {
        $group: {
          _id: '$teacher',
          averageRating: { $avg: '$rating' },
          totalRatings: { $count: {} }
        }
      }
    ]);

    const ratingsMap = new Map(
      ratings.map(r => [
        r._id.toString(),
        { averageRating: r.averageRating, totalRatings: r.totalRatings }
      ])
    );

    const lessonsWithRatings = lessons.map((lesson: any) => {
      if (lesson.lesson?.teacherId?._id) {
        const teacherRating = ratingsMap.get(lesson.lesson.teacherId._id.toString());
        return {
          ...lesson,
          lesson: {
            ...lesson.lesson,
            teacherId: {
              ...lesson.lesson.teacherId,
              rating: teacherRating || { averageRating: 0, totalRatings: 0 }
            }
          }
        };
      }
      return lesson;
    });

    return lessonsWithRatings;
  },

  async getStudentCalendarOverview(
    studentId: Types.ObjectId | string,
    month: number,
    year: number,
    timezone: string = 'UTC'
  ) {
    const startOfMonth = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

    const monthFilter = {
      students: { $in: new Types.ObjectId(studentId) },
      start: { $gte: startOfMonth, $lte: endOfMonth }
    };

    const allSessions = await SessionModel.find(monthFilter)
      .populate('lesson', 'title')
      .sort({ start: 1 })
      .lean();

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
        time: formatTime(session.start, timezone)
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

  async getStudentSessionsByDate(
    studentId: Types.ObjectId | string,
    date: string,
    timezone: string = 'UTC'
  ) {
    const [yearStr, monthStr, dayStr] = date.split('-');
    const y = parseInt(yearStr);
    const m = parseInt(monthStr) - 1;
    const d = parseInt(dayStr);

    const startOfDay = new Date(y, m, d, 0, 0, 0, 0);
    const endOfDay = new Date(y, m, d, 23, 59, 59, 999);

    const filter = {
      students: { $in: new Types.ObjectId(studentId) },
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
      time: formatTime(s.start, timezone),
      duration: calculateDuration(s.start, s.end),
      status: s.status,
      courseTitle: (s.course as any)?.title,
      lessonId: s.lesson,
      order: idx + 1
    }));
  },

  async getStudentCourses(studentId: string): Promise<CourseOption[]> {
    // Find all sessions where the student is enrolled
    const sessions = await SessionModel.find({
      students: studentId,
      status: { $ne: SessionStatus.CANCELLED }
    })
      .populate('course', 'title')
      .select('course')
      .lean();

    // Get unique course IDs
    const courseIds = [...new Set(sessions.map((s: any) => s.course._id.toString()))];

    // Get course details with lesson count
    const courses = await Promise.all(
      courseIds.map(async courseId => {
        const course = await Course.findById(courseId).select('title').lean();
        const lessonCount = await SessionModel.countDocuments({
          course: courseId,
          students: studentId,
          status: { $ne: SessionStatus.CANCELLED }
        });

        return {
          _id: courseId,
          title: course?.title || '',
          lessonCount
        };
      })
    );

    return courses.filter(c => c.title);
  },

  /**
   * Get lessons for a student (both upcoming and history)
   */
  async getStudentLessons(query: LessonListQuery) {
    const { studentId, courseId, view = LessonViewType.UPCOMING, page = 1, limit = 10 } = query;

    const now = new Date();
    const skip = (page - 1) * limit;

    // Build query filters
    const filters: any = {
      students: studentId,
      status: { $ne: SessionStatus.CANCELLED }
    };

    if (courseId) {
      filters.course = courseId;
    }

    if (view === LessonViewType.UPCOMING) {
      filters.start = { $gte: now };
    } else {
      filters.end = { $lt: now };
    }

    // Get total count
    const totalItems = await SessionModel.countDocuments(filters);

    // Fetch sessions with populated data
    const sessions = await SessionModel.find(filters)
      .populate({
        path: 'course',
        select: 'title lessonType mode',
        populate: { path: 'introImageRef', select: 'url' }
      })
      .populate('lesson', 'title isTrialAvailable schedule description')
      .populate({
        path: 'teacher',
        select: 'name',
        populate: { path: 'profileImage', select: 'url' }
      })
      .sort(view === LessonViewType.UPCOMING ? { start: 1 } : { start: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    const teacherIds = sessions.map((lesson: any) => lesson?.teacher?._id).filter(Boolean);
    const ratings = await FeedbackRating.aggregate([
      {
        $match: {
          teacher: { $in: teacherIds }
        }
      },
      {
        $group: {
          _id: '$teacher',
          averageRating: { $avg: '$rating' },
          totalRatings: { $count: {} }
        }
      }
    ]);

    const ratingsMap = new Map(
      ratings.map(r => [
        r._id.toString(),
        { averageRating: r.averageRating, totalRatings: r.totalRatings }
      ])
    );

    const lessons: LessonItem[] = sessions.map((session: any) => {
      const duration = Math.round((session.end - session.start) / (1000 * 60)); // minutes
      const teacherRating = ratingsMap.get(session.teacher._id.toString());

      const lessonItem: LessonItem = {
        sessionId: session._id.toString(),
        lessonTitle: session.lesson?.title || 'Untitled Lesson',
        courseTitle: session.course?.title || 'Untitled Course',
        teacher: {
          _id: session.teacher._id.toString(),
          name: session.teacher.name,
          profileImage: session.teacher.profileImage,
          rating: teacherRating || { averageRating: 0, totalRatings: 0 }
        },
        startTime: session.start,
        endTime: session.end,
        duration,
        status: session.status,
        lessonType: session.course?.lessonType || '1-on-1',
        courseMode: session.course?.mode || 'online',
        isTrialLesson: session.lesson?.isTrialAvailable || false,
        description: session.lesson?.description
      };

      if (session.course?.mode === 'online' && session.joinUrl) {
        lessonItem.meetingUrl = session.joinUrl;
      }

      return lessonItem;
    });

    return {
      lessons,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalItems / limit),
        totalItems,
        itemsPerPage: limit
      },
      view
    };
  }
};
