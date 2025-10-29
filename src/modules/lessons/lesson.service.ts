import { Lesson, LessonDoc } from '../../models/lesson.model';
import { Course } from '../../models/course.model';
import { Types } from 'mongoose';
import { LessonItemInput } from './lesson.schemas';

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

function parseStartEnd(schedule: { date: Date; time: string; duration: number }) {
  const [hhmm, ampm] = schedule.time.split(' ');
  const [hhStr, mmStr] = hhmm.split(':');
  let hours = parseInt(hhStr, 10);
  const minutes = parseInt(mmStr, 10);
  const isPM = ampm.toUpperCase() === 'PM';
  hours = (hours % 12) + (isPM ? 12 : 0);

  // Interpret date as local day; adjust if you store everything UTC
  const start = new Date(schedule.date);
  start.setHours(hours, minutes, 0, 0);
  const end = new Date(start.getTime() + schedule.duration * 60_000);
  return { startAt: start, endAt: end };
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

  async listByCourse(
    courseId: string,
    opts: { from?: Date; to?: Date; page?: number; limit?: number; sort?: any } = {}
  ) {
    const { from, to, page = 1, limit = 20, sort = { order: 1, startAt: 1 } } = opts;
    const filter: any = { courseId };
    if (from || to) {
      filter.startAt = {};
      if (from) filter.startAt.$gte = from;
      if (to) filter.startAt.$lte = to;
    }
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      Lesson.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      Lesson.countDocuments(filter)
    ]);
    return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
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

      const { startAt, endAt } = parseStartEnd(l.schedule);

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
        const base = await Lesson.findOne({ _id, courseId }).select({ schedule: 1 }).lean();
        const merged = {
          date: u.schedule.date ?? base?.schedule?.date,
          time: u.schedule.time ?? base?.schedule?.time,
          duration: u.schedule.duration ?? base?.schedule?.duration
        };
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
