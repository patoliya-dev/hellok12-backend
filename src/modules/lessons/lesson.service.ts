import { Lesson, LessonDoc } from '../../models/lesson.model';
import { Course } from '../../models/course.model';
import { FilterQuery, Types } from 'mongoose';
import { LessonItemInput } from './lesson.schemas';
import { normalizeToHHMM24, parseStartEnd } from './lesson.util';

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

export const LessonService = {
  async create(data: Partial<LessonDoc>) {
    // auto-increment order (if not provided)
    if (typeof data.order !== 'number') {
      const last = await Lesson.findOne({ courseId: data.courseId }).sort({ order: -1 }).lean();
      data.order = last ? (last.order || 0) + 1 : 0;
    }

    // Normalize schedule.time to HH:MM and ensure startAt/endAt are Dates
    if (data.schedule) {
      const normalizedTime = normalizeToHHMM24((data.schedule as any).time);
      if (normalizedTime) (data.schedule as any).time = normalizedTime;
      // If startAt provided as string, convert to Date
      if (data.startAt && typeof data.startAt === 'string') {
        data.startAt = new Date(data.startAt);
      }
      // If startAt not provided but time/date present, compute startAt/endAt
      if (!(data as any).startAt) {
        const { startAt, endAt } = parseStartEnd({
          date: (data.schedule as any).date,
          time: (data.schedule as any).time,
          duration: (data.schedule as any).duration
        });
        (data as any).startAt = startAt;
        (data as any).endAt = endAt;
      } else {
        // ensure endAt derived from startAt + duration if not provided
        if (!(data as any).endAt) {
          const dur = Number((data.schedule as any).duration || 0);
          (data as any).endAt = new Date((data as any).startAt.getTime() + dur * 60000);
        }
      }
    }

    const doc = await Lesson.create(data);

    // reflect course.isTrialAvailable
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

    // Trial rule
    if (patch.isTrialAvailable) {
      const exists = await Lesson.exists({
        courseId: before.courseId,
        isTrialAvailable: true,
        _id: { $ne: id },
        startAt: { $gte: new Date() }
      });
      if (exists) throw new Error('TRIAL_EXISTS');
    }

    // If schedule in patch, normalize & compute startAt/endAt
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

    // Recalc course flag if trial changed or schedule changed
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
      isTrialAvailable: false, // don’t auto-create as trial
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
    // priority: sortBy (same as Courses API)
    if (q.sortBy && sortMap[q.sortBy]) return sortMap[q.sortBy];
    // fallback: key+direction (compatible with your curl)
    const kd = fromKeyDir(q.sortKey, q.sortDirection);
    return kd || defaultSort;
  },

  async listByCourse(courseId: string, opts: ListOpts) {
    const filter: FilterQuery<LessonDoc> = { courseId: new Types.ObjectId(courseId) };

    if (opts.status) filter.status = opts.status;
    if (typeof opts.isTrialAvailable === 'boolean') {
      filter.isTrialAvailable = opts.isTrialAvailable;
    }

    // date range on startAt (consistent field used elsewhere)
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

  // CREATE MANY
  async bulkCreateForCourse({ courseId, lessons }: CreateArgs) {
    // Validate course existence
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

    // Precompute next order
    let nextOrder = await getNextOrderForCourse(courseId);

    const docs = [];

    // Validate and build lesson docs
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

      // Normalize time & parse start/end
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

      // Prevent overlap conflicts
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

    // Insert atomically
    const created = await Lesson.insertMany(docs);

    // Recompute course.isTrialAvailable
    await recomputeCourseTrialAvailability(courseId);

    return { items: created.map(d => d.toObject()), count: created.length };
  },

  // UPDATE MANY + DELETE
  async bulkUpdateForCourse({ courseId, updates, deletes }: UpdateArgs) {
    const course = await Course.findById(courseId).lean();
    if (!course) {
      const e = new Error('Course not found');
      (e as any).code = '404_NOT_FOUND';
      throw e;
    }
    const teacherId: Types.ObjectId = (course as any).teacherId || (course as any).ownerId;

    const ops: any[] = [];

    // Deletes (optional)
    for (const id of deletes || []) {
      if (!Types.ObjectId.isValid(id)) continue;
      ops.push({
        deleteOne: { filter: { _id: new Types.ObjectId(id), courseId } }
      });
    }

    // Updates (partial)
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

        // Normalize time if present
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
      }

      if (Object.keys($set).length) {
        ops.push({
          updateOne: {
            filter: { _id, courseId },
            update: { $set }
          }
        });
      }
    }

    if (ops.length === 0) {
      const current = await Lesson.find({ courseId }).lean();

      // Recompute course.isTrialAvailable
      await recomputeCourseTrialAvailability(courseId);

      return { items: current, count: current.length };
    }

    await Lesson.bulkWrite(ops, { ordered: false });

    // Recompute course.isTrialAvailable
    await recomputeCourseTrialAvailability(courseId);

    const refreshed = await Lesson.find({ courseId }).sort({ order: 1 }).lean();
    return { items: refreshed, count: refreshed.length };
  }
};
