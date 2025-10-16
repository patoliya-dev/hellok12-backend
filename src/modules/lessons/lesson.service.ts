import { Lesson, LessonDoc } from '../../models/lesson.model';
import { Course } from '../../models/course.model';
import { ClientSession, Types } from 'mongoose';
import { connection } from 'mongoose';

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
        isTrial: true,
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
    if (patch.isTrial) {
      const exists = await Lesson.exists({
        courseId: before.courseId,
        isTrial: true,
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
        isTrial: true,
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
        isTrial: true,
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
      isTrial: false, // don’t auto-create as trial
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

  async bulkCreateForCourse({
    courseId,
    lessons
  }: {
    courseId: Types.ObjectId;
    lessons: Array<{
      title: string;
      description?: string;
      schedule: { date: Date; time: string; duration: number };
      isTrial?: boolean;
      trialCapacity?: number;
      order?: number;
    }>;
  }) {
    const session = await connection.startSession();
    session.startTransaction();

    try {
      // 1) Load course & teacherId
      const course = await Course.findById(courseId).session(session);
      if (!course) {
        const e = new Error('Course not found');
        (e as any).code = '404_NOT_FOUND';
        throw e;
      }

      const teacherId: Types.ObjectId = (course as any).teacherId || (course as any).ownerId; // adapt to your model

      // 2) Determine base order for auto-append
      let nextOrder = await getNextOrderForCourse(courseId, session);

      // 3) Optional: handle "reorder" if caller supplies explicit orders that collide
      // Strategy: if any incoming has explicit `order`, we shift existing >= that order up.
      // We'll batch shifts once per distinct order value to minimize updates.
      const explicitOrders = Array.from(
        new Set(
          lessons
            .map(l => (typeof l.order === 'number' ? l.order : null))
            .filter((v): v is number => v !== null)
            .sort((a, b) => a - b)
        )
      );

      for (const ord of explicitOrders) {
        // shift existing lessons with order >= ord
        await Lesson.updateMany(
          { courseId, order: { $gte: ord } },
          { $inc: { order: 1 } },
          { session }
        );
        // also shift any previously staged incoming orders >= ord (simple rebase):
        lessons.forEach(l => {
          if (typeof l.order === 'number' && l.order >= ord) l.order += 1;
        });
      }

      // 4) Build docs in-memory; do overlap checks against DB (still in TX)
      const toInsert: any[] = [];
      for (const raw of lessons) {
        const { startAt, endAt } = parseStartEnd(raw.schedule);

        const doc: any = {
          courseId,
          teacherId,
          title: raw.title,
          description: raw.description ?? undefined,
          schedule: raw.schedule, // keep raw schedule for DTO echo if your model stores it
          startAt,
          endAt,
          isTrial: !!raw.isTrial,
          trialCapacity: raw.isTrial ? (raw.trialCapacity ?? undefined) : undefined,
          order: typeof raw.order === 'number' ? raw.order : nextOrder
        };

        // Overlap guard (teacher scope — matches your single create rule)
        await checkOverlapForLesson({
          courseId,
          teacherId,
          startAt,
          endAt,
          session
        });

        toInsert.push(doc);
        if (typeof raw.order !== 'number') nextOrder += 1;
      }

      // 5) Insert atomically
      const created = await Lesson.insertMany(toInsert, { session });

      // 6) Recompute course.isTrialAvailable
      await recomputeCourseTrialAvailability(courseId, session);

      await session.commitTransaction();
      session.endSession();

      // Lean shape for response
      const items = created.map(d => ({
        _id: d._id,
        courseId: d.courseId,
        title: d.title,
        description: d.description,
        schedule: d.schedule,
        isTrial: d.isTrial,
        trialCapacity: d.trialCapacity,
        order: d.order,
        startAt: d.startAt,
        endAt: d.endAt,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt
      }));
      return { items, count: items.length };
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  }
};

function parseStartEnd(schedule: { date: Date; time: string; duration: number }) {
  // time example: "10:05 AM"
  const match = schedule.time.trim().match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
  if (!match) throw Object.assign(new Error('Invalid time format'), { code: '422_VALIDATION' });

  const [_, hh, mm, meridiem] = match;
  let hours = parseInt(hh, 10);
  const minutes = parseInt(mm, 10);
  const upper = meridiem.toUpperCase();

  if (upper === 'PM' && hours !== 12) hours += 12;
  if (upper === 'AM' && hours === 12) hours = 0;

  const startAt = new Date(schedule.date);
  startAt.setHours(hours, minutes, 0, 0);

  const endAt = new Date(startAt.getTime() + schedule.duration * 60 * 1000);
  return { startAt, endAt };
}

async function getNextOrderForCourse(courseId: Types.ObjectId, session: ClientSession) {
  const latest = await Lesson.findOne({ courseId })
    .sort({ order: -1 })
    .select({ order: 1 })
    .session(session)
    .lean();
  return (latest?.order ?? -1) + 1;
}

async function checkOverlapForLesson({
  courseId,
  teacherId,
  startAt,
  endAt,
  session
}: {
  courseId: Types.ObjectId;
  teacherId: Types.ObjectId;
  startAt: Date;
  endAt: Date;
  session: ClientSession;
}) {
  // Overlap if: start < existing.end && end > existing.start
  const exists = await Lesson.findOne({
    teacherId,
    $or: [{ startAt: { $lt: endAt }, endAt: { $gt: startAt } }],
    // optionally scope to same course if you want looser global check:
    courseId,
    status: { $ne: 'cancelled' }
  })
    .select({ _id: 1 })
    .session(session)
    .lean();

  if (exists) {
    const e = new Error('Lesson time overlaps with an existing lesson');
    (e as any).code = '409_CONFLICT_OVERLAP';
    throw e;
  }
}

async function recomputeCourseTrialAvailability(courseId: Types.ObjectId, session: ClientSession) {
  const now = new Date();
  const trial = await Lesson.findOne({
    courseId,
    isTrial: true,
    startAt: { $gte: now },
    status: { $ne: 'cancelled' }
  })
    .select({ _id: 1 })
    .session(session)
    .lean();

  await Course.updateOne({ _id: courseId }, { $set: { isTrialAvailable: !!trial } }, { session });
}
