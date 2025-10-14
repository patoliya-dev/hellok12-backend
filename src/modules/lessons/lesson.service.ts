import { Lesson, LessonDoc } from '../../models/lesson.model';
import { Course } from '../../models/course.model';

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
  }
};
