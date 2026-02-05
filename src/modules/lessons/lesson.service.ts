import { DateTime } from 'luxon';
import { FilterQuery, SortOrder, Types } from 'mongoose';
import { Lesson, LessonDoc } from '../../models/lesson.model';
import { Course } from '../../models/course.model';
import { LessonItemInput } from './lesson.schemas';
import { normalizeTimezone, normalizeToHHMM24, parseStartEnd } from './lesson.util';
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
import BookingModel from '../../models/booking.model';
import { CourseOption, LessonItem, LessonListQuery, LessonViewType } from '../../types/LessonTypes';
import { User } from '../../models/user.model';

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
    teacherId: Types.ObjectId;
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

type CalendarArgs = {
  userId: string;
  role: string;
  month: number;
  year: number;
  timeZone: string;
  teacherId?: string; // school filter
};

type UpcomingOpts = {
  days: number;
  limit: number;
  page: number;
};

export type GetLessonsResult = {
  lessons: any[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  pendingCount: number;
};

export const LessonService = {
  async getCalendarOverview(args: CalendarArgs) {
    const { userId, role, month, year, timeZone, teacherId } = args;
    const r = String(role || '').toLowerCase();

    const uid = new Types.ObjectId(userId);

    // Month boundaries in USER TZ, then convert to UTC for DB filtering
    const startUtc = DateTime.fromObject({ year, month }, { zone: timeZone })
      .startOf('month')
      .toUTC()
      .toJSDate();

    const endUtc = DateTime.fromObject({ year, month }, { zone: timeZone })
      .endOf('month')
      .toUTC()
      .toJSDate();

    // ---- base match ----
    const match: any = {
      start: { $gte: startUtc, $lte: endUtc },
      status: { $ne: SessionStatus.CANCELLED }
    };

    let schoolTeacherOptions: Array<{ value: string; label: string }> | undefined;

    // ---- role constraints ----
    if (r === 'teacher') {
      match.teacher = uid; // teacher’s own sessions
    } else if (r === 'school') {
      // ONLY ACTIVE school-owned courses
      const courseDocs = await Course.find({
        ownerType: 'school',
        ownerId: uid,
        status: 'active'
      })
        .select('_id')
        .lean();

      const ids = courseDocs.map(c => c._id);
      match.course = { $in: ids.length ? ids : [new Types.ObjectId()] };

      // optional teacher filter
      if (teacherId && teacherId !== 'all') {
        match.teacher = new Types.ObjectId(teacherId);
      }

      // dropdown: active teachers under school
      const teachers = await User.find({
        role: 'teacher',
        school: uid,
        status: 'active'
      })
        .select('_id name')
        .sort({ name: 1 })
        .lean();

      schoolTeacherOptions = [
        { value: 'all', label: 'All Teachers' },
        ...teachers.map(t => ({ value: String(t._id), label: t.name }))
      ];
    } else {
      return { monthOverview: {}, stats: { total: 0, pending: 0, completed: 0 } };
    }

    /**
     * IMPORTANT:
     * Enforce "course.status = active" at aggregation level too.
     * This is REQUIRED for teacher role (teacher can have sessions from non-active courses)
     * and is a defensive guarantee for school role.
     */

    const pipeline: any[] = [
      { $match: match },

      // --- join course and enforce active ---
      {
        $lookup: {
          from: 'courses',
          localField: 'course',
          foreignField: '_id',
          as: 'courseDoc'
        }
      },
      { $unwind: { path: '$courseDoc', preserveNullAndEmptyArrays: false } },
      { $match: { 'courseDoc.status': 'active' } }, // active course only

      // join lesson title
      {
        $lookup: {
          from: 'lessons',
          localField: 'lesson',
          foreignField: '_id',
          as: 'lessonDoc'
        }
      },
      { $unwind: { path: '$lessonDoc', preserveNullAndEmptyArrays: true } },

      // join teacher name (important for school UI)
      {
        $lookup: {
          from: 'users',
          localField: 'teacher',
          foreignField: '_id',
          as: 'teacherDoc'
        }
      },
      { $unwind: { path: '$teacherDoc', preserveNullAndEmptyArrays: true } },

      // dateKey in user timezone (critical for calendar rendering)
      {
        $addFields: {
          dateKey: {
            $dateToString: {
              date: '$start',
              format: '%Y-%m-%d',
              timezone: timeZone
            }
          }
        }
      },

      // keep only what we need downstream
      {
        $project: {
          _id: 1,
          start: 1,
          status: 1,
          dateKey: 1,
          title: { $ifNull: ['$lessonDoc.title', 'Untitled'] },
          teacher: {
            _id: '$teacherDoc._id',
            name: '$teacherDoc.name'
          }
        }
      },

      // Use facet so we compute monthOverview + stats in one pass
      {
        $facet: {
          monthGrouped: [
            { $sort: { start: 1 } },
            {
              $group: {
                _id: '$dateKey',
                count: { $sum: 1 },
                lessons: {
                  $push: {
                    id: { $toString: '$_id' },
                    title: '$title',
                    start: '$start',
                    teacher: '$teacher',
                    status: '$status'
                  }
                }
              }
            },
            { $sort: { _id: 1 } }
          ],
          statsAgg: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                pending: {
                  $sum: {
                    $cond: [
                      {
                        $in: ['$status', [SessionStatus.SCHEDULED, SessionStatus.IN_PROGRESS]]
                      },
                      1,
                      0
                    ]
                  }
                },
                completed: {
                  $sum: { $cond: [{ $eq: ['$status', SessionStatus.COMPLETED] }, 1, 0] }
                }
              }
            }
          ]
        }
      }
    ];

    const result = await SessionModel.aggregate(pipeline);

    const monthGrouped = result?.[0]?.monthGrouped || [];
    const statsRow = result?.[0]?.statsAgg?.[0] || { total: 0, pending: 0, completed: 0 };

    // build monthOverview object
    const monthOverview: Record<string, { count: number; lessons: any[] }> = {};
    for (const day of monthGrouped) {
      monthOverview[day._id] = {
        count: day.count,
        lessons: day.lessons
      };
    }

    return {
      monthOverview,
      stats: { total: statsRow.total, pending: statsRow.pending, completed: statsRow.completed },
      ...(schoolTeacherOptions ? { teachers: schoolTeacherOptions } : {})
    };
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

  async getLessonsDashboard(args: { userId: string; role: string; timeZone: string }) {
    const { userId, role, timeZone } = args;

    const start = DateTime.now().setZone(timeZone).startOf('day').toUTC().toJSDate();
    const end = DateTime.now().setZone(timeZone).endOf('day').toUTC().toJSDate();

    const r = String(role || '').toLowerCase();

    // Build filter depending on role
    const filter: any = { start: { $gte: start, $lt: end } };

    if (r === 'teacher') {
      filter.teacher = new Types.ObjectId(userId);
    } else if (r === 'school') {
      // sessions belonging to school's courses
      const schoolCourses = await Course.find({
        ownerId: new Types.ObjectId(userId),
        ownerType: 'school'
      })
        .select('_id')
        .lean();

      const courseIds = schoolCourses.map(c => c._id);
      filter.course = { $in: courseIds.length ? courseIds : [new Types.ObjectId()] }; // safe-empty
    } else {
      // fallback: return empty for other roles
      return [];
    }

    const lessons = await SessionModel.find(filter)
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
        select: 'title _id mode description lessonType address',
        populate: { path: 'introImageRef', select: 'url' }
      })
      .populate({
        path: 'teacher',
        select: 'name _id',
        populate: { path: 'profileImage', select: 'url' }
      })
      .select('joinUrl status start end')
      .sort({ start: 1 })
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
      const teacherId: Types.ObjectId = l.teacherId
        ? new Types.ObjectId(l.teacherId)
        : userRole === 'teacher'
          ? new Types.ObjectId(course.ownerId)
          : (() => {
              const e = new Error('Teacher is required for lesson');
              (e as any).code = '422_VALIDATION';
              throw e;
            })();

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

    const ops: any[] = [];
    const sessionsToUpdate: Array<{
      lessonId: string;
      startAt: Date;
      endAt: Date;
      teacherId: string;
    }> = [];

    // 0) Delete ops
    for (const id of deletes || []) {
      if (!Types.ObjectId.isValid(id)) continue;
      ops.push({
        deleteOne: { filter: { _id: new Types.ObjectId(id), courseId } }
      });
    }

    // 1) Pre-parse updates
    const parsedUpdates: Array<{
      lessonId: Types.ObjectId;
      index: number;
      teacherId: Types.ObjectId;
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

      const lessonId = new Types.ObjectId(u.lessonId);

      // fetch existing lesson ONCE
      const base = await Lesson.findOne({ _id: lessonId, courseId })
        .select({ schedule: 1, teacherId: 1, startAt: 1, endAt: 1 })
        .lean();

      if (!base) {
        updIndex++;
        continue;
      }

      // 🔧 FIX: allow teacher reassignment
      const targetTeacherId = Types.ObjectId.isValid(u.teacherId)
        ? new Types.ObjectId(u.teacherId)
        : base.teacherId;

      const setFields: Record<string, any> = {};
      if (u.title !== undefined) setFields.title = u.title;
      if (u.description !== undefined) setFields.description = u.description ?? '';
      if (u.isTrialAvailable !== undefined) setFields.isTrialAvailable = !!u.isTrialAvailable;
      if (u.trialCapacity !== undefined) setFields.trialCapacity = u.trialCapacity;
      if (u.order !== undefined) setFields.order = u.order;
      if (u.vocabulary !== undefined) setFields.vocabulary = u.vocabulary;
      if (u.status !== undefined) setFields.status = u.status;
      if (u.teacherId) setFields.teacherId = targetTeacherId; // 🔧 FIX

      const entry: any = {
        lessonId,
        index: updIndex,
        teacherId: targetTeacherId,
        setFields
      };

      if (u.schedule) {
        const merged = {
          date: u.schedule.date ?? base.schedule?.date,
          time: u.schedule.time ?? base.schedule?.time,
          duration: u.schedule.duration ?? base.schedule?.duration
        };

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

        const { startAt, endAt } = await parseStartEnd(
          { date: merged.date, time: merged.time, duration: merged.duration },
          undefined,
          undefined,
          timeZone
        );

        entry.mergedSchedule = merged;
        entry.startAtUtc = new Date(startAt.toISOString());
        entry.endAtUtc = new Date(endAt.toISOString());
        entry.setFields = {
          ...setFields,
          schedule: merged,
          startAt: entry.startAtUtc,
          endAt: entry.endAtUtc
        };
      }

      parsedUpdates.push(entry);
      updIndex++;
    }

    // 2) Overlap detection (PER TARGET TEACHER) 🔧 FIX
    for (const p of parsedUpdates) {
      if (!p.startAtUtc || !p.endAtUtc) continue;

      const clash = await Lesson.findOne({
        teacherId: p.teacherId,
        status: { $ne: 'archived' },
        _id: { $ne: p.lessonId },
        startAt: { $lt: p.endAtUtc },
        endAt: { $gt: p.startAtUtc }
      })
        .select('_id title startAt endAt')
        .lean();

      if (clash) {
        const e: any = new Error('Lesson time overlaps with an existing lesson');
        e.code = '409_CONFLICT_OVERLAP';
        e.meta = { clash };
        throw e;
      }
    }

    // 3) Intra-payload overlap (same teacher only)
    const groupedByTeacher = new Map<string, any[]>();
    for (const p of parsedUpdates) {
      if (!p.startAtUtc || !p.endAtUtc) continue;
      const key = String(p.teacherId);
      groupedByTeacher.set(key, [...(groupedByTeacher.get(key) || []), p]);
    }

    for (const [, list] of groupedByTeacher) {
      list.sort((a, b) => a.startAtUtc.getTime() - b.startAtUtc.getTime());
      for (let i = 0; i < list.length - 1; i++) {
        if (list[i].endAtUtc.getTime() > list[i + 1].startAtUtc.getTime()) {
          const e: any = new Error('Incoming updates overlap with each other');
          e.code = '409_CONFLICT_OVERLAP';
          throw e;
        }
      }
    }

    // 4) Build DB ops
    for (const p of parsedUpdates) {
      if (Object.keys(p.setFields || {}).length) {
        ops.push({
          updateOne: {
            filter: { _id: p.lessonId, courseId },
            update: { $set: p.setFields }
          }
        });

        if (p.startAtUtc && p.endAtUtc) {
          sessionsToUpdate.push({
            lessonId: p.lessonId.toString(),
            startAt: p.startAtUtc,
            endAt: p.endAtUtc,
            teacherId: p.teacherId.toString()
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

    // 🔧 FIX: recompute course.teachers[]
    const activeTeacherIds = await Lesson.distinct('teacherId', {
      courseId,
      status: { $ne: 'archived' }
    });

    await Course.updateOne({ _id: courseId }, { $set: { teachers: activeTeacherIds } });

    const refreshed = await Lesson.find({ courseId }).sort({ order: 1 }).lean();

    const enrolledStudents = await BookingModel.find({
      course: courseId,
      paymentStatus: 'PAID'
    })
      .select('student')
      .lean();

    const studentIds = enrolledStudents.map((b: any) => b.student.toString());

    // 5) Update sessions with correct teacher 🔧 FIX
    await Promise.all(
      sessionsToUpdate.map(async s => {
        try {
          await sessionService.updateSessionForLesson({
            lessonId: s.lessonId,
            courseId: courseId.toString(),
            teacherId: s.teacherId,
            start: s.startAt,
            end: s.endAt,
            students: studentIds
          });
        } catch (err) {
          Logger.error(`Failed to update session ${s.lessonId}`, err);
        }
      })
    );

    return { items: refreshed, count: refreshed.length };
  },
  getLessons: async (query: GetLessonsQuery, role?: string): Promise<GetLessonsResult> => {
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
    const lessons = (sessions || []).map(session => transformSessionToLesson(session, role));

    return {
      lessons,
      pagination: {
        total: total || 0,
        page,
        limit,
        totalPages: Math.ceil((total || 0) / limit)
      },
      pendingCount: pendingCount || 0
    };
  },
  getUpcomingLessonsForStudent: async (studentId: string, timeZone: string, opts: UpcomingOpts) => {
    const tz = normalizeTimezone(timeZone);

    const studentObjId = new Types.ObjectId(studentId);

    const nowUtc = DateTime.now().setZone(tz).toUTC(); // "now" in student's timezone, converted to UTC instant
    const endUtc = nowUtc.plus({ days: opts.days });

    const skip = (opts.page - 1) * opts.limit;

    // Correct upcoming query: start >= now
    // Correct students filter: $in [ObjectId]
    const sessions = await SessionModel.find({
      students: { $in: [studentObjId] },
      start: { $gte: nowUtc.toJSDate(), $lt: endUtc.toJSDate() },
      // Optional: only upcoming-like statuses (if your schema uses them)
      status: { $in: [SessionStatus.SCHEDULED, SessionStatus.IN_PROGRESS] }
    })
      .populate({
        path: 'lesson',
        select: 'title _id schedule status description isTrialAvailable teacherId',
        populate: {
          path: 'teacherId',
          select: 'name _id profileImage',
          populate: { path: 'profileImage', select: 'url' }
        }
      })
      .populate({
        path: 'course',
        select: 'title _id mode description lessonType introImageRef',
        populate: { path: 'introImageRef', select: 'url' }
      })
      .select('joinUrl status start end lesson course')
      .sort({ start: 1 })
      .skip(skip)
      .limit(opts.limit)
      .lean();

    // Teacher ratings (avoid bad $in if empty)
    const teacherIds = sessions
      .map((s: any) => s.lesson?.teacherId?._id)
      .filter(Boolean)
      .map((id: any) => new Types.ObjectId(String(id)));

    let ratingsMap = new Map<string, { averageRating: number; totalRatings: number }>();

    if (teacherIds.length) {
      const ratings = await FeedbackRating.aggregate([
        { $match: { teacher: { $in: teacherIds } } },
        {
          $group: {
            _id: '$teacher',
            averageRating: { $avg: '$rating' },
            totalRatings: { $sum: 1 }
          }
        }
      ]);

      ratingsMap = new Map(
        ratings.map(r => [
          String(r._id),
          { averageRating: Number(r.averageRating || 0), totalRatings: Number(r.totalRatings || 0) }
        ])
      );
    }

    // Attach rating onto teacher
    return sessions.map((s: any) => {
      const tId = s.lesson?.teacherId?._id ? String(s.lesson.teacherId._id) : null;
      const rating = tId ? ratingsMap.get(tId) : null;

      if (tId && rating) {
        return {
          ...s,
          lesson: {
            ...s.lesson,
            teacherId: { ...s.lesson.teacherId, rating }
          }
        };
      }

      if (tId) {
        return {
          ...s,
          lesson: {
            ...s.lesson,
            teacherId: { ...s.lesson.teacherId, rating: { averageRating: 0, totalRatings: 0 } }
          }
        };
      }
      return s;
    });
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

    const filters: any = {
      students: new Types.ObjectId(studentId),
      status: { $ne: SessionStatus.CANCELLED }
    };

    if (courseId) filters.course = new Types.ObjectId(courseId);

    if (view === LessonViewType.UPCOMING) filters.end = { $gte: now };
    else filters.end = { $lt: now };

    const totalItems = await SessionModel.countDocuments(filters);

    // Fetch sessions with populated data
    const sessions = await SessionModel.find(filters)
      .populate({
        path: 'course',
        select: 'title lessonType mode address',
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

    // Collect in-person 1-on-1 courseIds only (because only those need booking.address)
    const oneOnOneInPersonCourseIds = Array.from(
      new Set(
        sessions
          .filter((s: any) => s?.course?.mode === 'in-person' && s?.course?.lessonType === '1-on-1')
          .map((s: any) => String(s.course?._id))
          .filter(Boolean)
      )
    );

    // Map: courseId -> booking.address
    const bookingAddressByCourseId = new Map<string, any>();

    if (oneOnOneInPersonCourseIds.length > 0) {
      const bookings = await BookingModel.find({
        student: new Types.ObjectId(studentId),
        course: { $in: oneOnOneInPersonCourseIds.map(id => new Types.ObjectId(id)) },
        paymentStatus: { $in: ['PAID', 'NOT_REQUIRED'] }
      })
        .select('course address updatedAt createdAt')
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean();

      for (const b of bookings) {
        const cId = String(b.course);
        if (!bookingAddressByCourseId.has(cId) && b.address) {
          bookingAddressByCourseId.set(cId, b.address);
        }
      }
    }

    // Ratings (keep your existing logic as-is)
    const teacherIds = sessions.map((s: any) => s?.teacher?._id).filter(Boolean);
    const ratings = await FeedbackRating.aggregate([
      { $match: { teacher: { $in: teacherIds } } },
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
        String(r._id),
        { averageRating: r.averageRating, totalRatings: r.totalRatings }
      ])
    );

    const lessons: LessonItem[] = sessions.map((session: any) => {
      const duration = Math.round((session.end - session.start) / (1000 * 60));
      const teacherRating = ratingsMap.get(String(session.teacher._id));

      const lessonType = session.course?.lessonType || '1-on-1';
      const courseMode = session.course?.mode || 'online';

      // resolve address (return "as-is")
      let address: any = null;

      if (courseMode === 'in-person') {
        if (lessonType === 'group') {
          address = session.course?.address || null;
        } else {
          address =
            bookingAddressByCourseId.get(String(session.course?._id)) ||
            session.course?.address ||
            null;
        }
      }

      const lessonItem: any = {
        sessionId: String(session._id),
        lessonTitle: session.lesson?.title || 'Untitled Lesson',
        courseTitle: session.course?.title || 'Untitled Course',
        teacher: {
          _id: String(session.teacher._id),
          name: session.teacher.name,
          profileImage: session.teacher.profileImage,
          rating: teacherRating || { averageRating: 0, totalRatings: 0 }
        },
        startTime: session.start,
        endTime: session.end,
        duration,
        status: session.status,
        lessonType,
        courseMode,
        isTrialLesson: session.lesson?.isTrialAvailable || false,
        description: session.lesson?.description,
        address
      };

      if (courseMode === 'online' && session.joinUrl) {
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
  },

  async getUpcomingLessons(args: {
    userId: string;
    role: string;
    timeZone: string;
    limit: number;
    days: number;
    courseId?: string;
  }) {
    const { userId, role, timeZone, limit, days, courseId } = args;
    const r = String(role || '').toLowerCase();

    // 1) Build window in USER TZ, then convert to UTC for DB
    const nowLocal = DateTime.now().setZone(timeZone);

    const nowUtc = nowLocal.toUTC(); // instant now (UTC)
    const windowEndUtc = nowLocal.plus({ days }).endOf('day').toUTC(); // end-of-day in user TZ -> UTC

    const now = nowUtc.toJSDate();
    const windowEnd = windowEndUtc.toJSDate();

    // 2) Upcoming definition (as per your requirement):
    // Keep session in upcoming UNTIL its end time.
    // - end >= now (ongoing + future)
    // - start < windowEnd (within next N days window)
    const sessionFilter: any = {
      end: { $gte: now },
      start: { $lt: windowEnd },
      status: { $ne: SessionStatus.CANCELLED }
    };

    // 3) Active course constraint
    // We will compute allowedCourseIds (ACTIVE only), and apply to sessionFilter.course.
    // Additionally, we add populate.match as a defensive guarantee.

    let allowedCourseIds: Types.ObjectId[] = [];

    if (r === 'teacher') {
      // Teacher can have:
      // - ownerType: 'teacher' + ownerId == teacher
      // - OR teacher listed in Course.teachers
      const courseQ: any = {
        status: 'active',
        ...(courseId ? { _id: new Types.ObjectId(courseId) } : {}),
        $or: [
          { ownerType: 'teacher', ownerId: new Types.ObjectId(userId) },
          { teachers: new Types.ObjectId(userId) }
        ]
      };

      const activeTeacherCourses = await Course.find(courseQ).select('_id').lean();
      allowedCourseIds = activeTeacherCourses.map((c: any) => c._id);

      // If teacher has no active courses, return []
      if (allowedCourseIds.length === 0) return [];

      sessionFilter.teacher = new Types.ObjectId(userId);
      sessionFilter.course = { $in: allowedCourseIds };
    } else if (r === 'school') {
      const courseQ: any = {
        ownerType: 'school',
        ownerId: new Types.ObjectId(userId),
        status: 'active', // only active courses
        ...(courseId ? { _id: new Types.ObjectId(courseId) } : {})
      };

      const activeSchoolCourses = await Course.find(courseQ).select('_id').lean();
      allowedCourseIds = activeSchoolCourses.map((c: any) => c._id);

      if (allowedCourseIds.length === 0) return [];

      sessionFilter.course = { $in: allowedCourseIds };
    } else {
      return [];
    }

    // 4) Query
    // Sort typing: use explicit SortOrder spec to avoid TS error
    const sort: Record<string, SortOrder> = { start: 1, _id: 1 };

    const sessions = await SessionModel.find(sessionFilter)
      .populate({
        path: 'lesson',
        select:
          'title _id schedule status description isTrialAvailable teacherId startAt endAt address',
        populate: {
          path: 'teacherId',
          select: 'name _id',
          populate: { path: 'profileImage', select: 'url' }
        }
      })
      .populate({
        path: 'course',
        match: { status: 'active' }, // defensive: ensures inactive courses populate to null
        select: 'title _id mode description lessonType address introImageRef status',
        populate: { path: 'introImageRef', select: 'url' }
      })
      .populate({
        path: 'teacher',
        select: 'name _id',
        populate: { path: 'profileImage', select: 'url' }
      })
      .populate({
        path: 'students',
        select: 'name _id profile.age profile.grade',
        populate: { path: 'profileImage', select: 'url' }
      })
      .select('joinUrl status start end course lesson teacher students createdAt')
      .sort(sort)
      .limit(Math.min(Math.max(limit, 1), 50)) // sensible cap
      .lean();

    // 5) Remove any sessions whose course got nulled by populate.match (defensive)
    const filtered = sessions.filter((s: any) => !!s.course);

    return filtered;
  },

  async getSchoolLessons(args: {
    schoolId: string;
    courseId?: string;
    view: LessonViewType;
    page: number;
    limit: number;
    studentName?: string;
    status?: string; // optional session status
  }) {
    const { schoolId, courseId, view, page, limit, studentName, status } = args;

    const now = new Date();
    const skip = (page - 1) * limit;

    // 1) Resolve ACTIVE school-owned courses only
    const courseFilter: any = {
      ownerType: 'school',
      ownerId: new Types.ObjectId(schoolId),
      status: 'active' // only active courses
    };
    if (courseId) courseFilter._id = new Types.ObjectId(courseId);

    const courses = await Course.find(courseFilter).select('_id').lean();
    const courseIds = courses.map((c: any) => c._id);

    if (courseIds.length === 0) {
      return {
        lessons: [],
        pagination: { currentPage: page, totalPages: 0, totalItems: 0, itemsPerPage: limit },
        view
      };
    }

    // 2) Session filters
    const filters: any = {
      course: { $in: courseIds },
      status: { $ne: SessionStatus.CANCELLED }
    };

    // IMPORTANT REQUIREMENT you mentioned earlier:
    // upcoming should include until lesson END time (not just start)
    if (view === LessonViewType.UPCOMING) {
      filters.end = { $gte: now }; // ✅ session stays "upcoming" until it ends
    } else {
      filters.end = { $lt: now };
    }

    if (status && status !== 'all') {
      // if you use SessionStatus enum strings, validate upstream; keeping permissive
      filters.status = status;
    }

    // 3) Query sessions
    const baseQuery = SessionModel.find(filters)
      .populate({
        path: 'course',
        // optional defensive filter (keeps course null if not active)
        match: { status: 'active' },
        select: 'title lessonType mode address status',
        populate: { path: 'introImageRef', select: 'url' }
      })
      .populate('lesson', 'title isTrialAvailable schedule description')
      .populate({
        path: 'teacher',
        select: 'name',
        populate: { path: 'profileImage', select: 'url' }
      })
      .populate({
        path: 'students',
        select: 'name profile.age',
        populate: { path: 'profileImage', select: 'url' }
      });

    // NOTE: If studentName is provided, we do a lightweight post-filter.
    // For strict DB-side filtering at scale, switch to Aggregation Version B.
    type SortSpec = Record<string, SortOrder>;

    function getSessionSort(v: LessonViewType): SortSpec {
      if (v === LessonViewType.UPCOMING) return { start: 1, _id: 1 };
      if (v === LessonViewType.HISTORY) return { start: -1, _id: 1 };
      return { start: 1, _id: 1 };
    }

    const sort = getSessionSort(view);
    // inferred => { start: number }

    const [totalItemsRaw, sessionsRaw] = await Promise.all([
      SessionModel.countDocuments(filters),
      baseQuery.sort(sort).skip(skip).limit(limit).lean()
    ]);

    // remove sessions whose course got nulled by populate.match (defensive)
    let sessions = (sessionsRaw as any[]).filter(s => !!s.course);

    // studentName filter (post filter)
    if (studentName) {
      const q = studentName.trim().toLowerCase();
      sessions = sessions.filter((s: any) =>
        (s.students || []).some((st: any) =>
          String(st?.name || '')
            .toLowerCase()
            .includes(q)
        )
      );
      // totalItemsRaw becomes approximate; for perfect totals, use aggregation.
    }

    // 4) booking.address mapping for in-person 1-on-1
    const oneOnOneInPersonCourseIds = Array.from(
      new Set(
        sessions
          .filter((s: any) => s?.course?.mode === 'in-person' && s?.course?.lessonType === '1-on-1')
          .map((s: any) => String(s.course?._id))
          .filter(Boolean)
      )
    );

    const bookingAddressByCourseId = new Map<string, any>();
    if (oneOnOneInPersonCourseIds.length > 0) {
      const bookings = await BookingModel.find({
        course: { $in: oneOnOneInPersonCourseIds.map(id => new Types.ObjectId(id)) },
        paymentStatus: { $in: ['PAID', 'NOT_REQUIRED'] }
      })
        .select('course address updatedAt createdAt')
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean();

      for (const b of bookings) {
        const cId = String(b.course);
        if (!bookingAddressByCourseId.has(cId) && b.address) {
          bookingAddressByCourseId.set(cId, b.address);
        }
      }
    }

    // 5) Ratings
    const teacherIds = sessions.map((s: any) => s?.teacher?._id).filter(Boolean);

    const ratings = await FeedbackRating.aggregate([
      { $match: { teacher: { $in: teacherIds } } },
      {
        $group: {
          _id: '$teacher',
          averageRating: { $avg: '$rating' },
          totalRatings: { $count: {} }
        }
      }
    ]);

    const ratingsMap = new Map(
      ratings.map((r: any) => [
        String(r._id),
        { averageRating: r.averageRating, totalRatings: r.totalRatings }
      ])
    );

    // 6) Response mapping (LessonCard compatible)
    const lessons = sessions.map((session: any) => {
      const duration = Math.round(
        (new Date(session.end).getTime() - new Date(session.start).getTime()) / 60000
      );

      const lessonType = session.course?.lessonType || '1-on-1';
      const courseMode = session.course?.mode || 'online';

      let address: any = null;
      if (courseMode === 'in-person') {
        if (lessonType === 'group') address = session.course?.address || null;
        else {
          address =
            bookingAddressByCourseId.get(String(session.course?._id)) ||
            session.course?.address ||
            null;
        }
      }

      const teacherRating = ratingsMap.get(String(session.teacher?._id)) || {
        averageRating: 0,
        totalRatings: 0
      };

      return {
        sessionId: String(session._id),
        lessonTitle: session.lesson?.title || 'Untitled Lesson',
        courseTitle: session.course?.title || 'Untitled Course',

        teacher: {
          _id: String(session.teacher?._id),
          name: session.teacher?.name || 'Teacher',
          profileImage: session.teacher?.profileImage,
          rating: teacherRating
        },

        // school may want first student info for UI (optional but useful)
        student:
          Array.isArray(session.students) && session.students[0]
            ? {
                _id: String(session.students[0]._id),
                name: session.students[0].name,
                profileImage: session.students[0]?.profileImage,
                age: session.students[0]?.profile?.age ?? null
              }
            : null,

        startTime: session.start,
        endTime: session.end,
        duration,
        status: session.status,

        lessonType,
        courseMode,

        isTrialLesson: !!session.lesson?.isTrialAvailable,
        description: session.lesson?.description || '',
        address,

        // joinUrl availability for UI
        meetingUrl: courseMode === 'online' ? session.joinUrl : undefined
      };
    });

    // For perfect totals with post-filter, you can compute:
    const totalItems = studentName ? lessons.length : totalItemsRaw;

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
