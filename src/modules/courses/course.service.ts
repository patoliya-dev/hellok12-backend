import { CourseModel, CourseDoc } from '../../models/course.model';
import { LessonModel } from '../../models/lesson.model';

export interface Pagination<T> {
  page: number;
  limit: number;
  total: number;
  items: T[];
}

export const CourseRepo = {
  async createCourse(data: any): Promise<CourseDoc> {
    const course = await CourseModel.create({ ...data });
    return course.toObject({ versionKey: false }) as any;
  },

  async getCourseById(id: string) {
    return CourseModel.findById(id).lean();
  },

  async listCourses(query: any): Promise<Pagination<CourseDoc & { status: string }>> {
    const {
      page = 1,
      limit = 20,
      language,
      status,
      priceMin,
      priceMax,
      startFrom,
      endTo,
      q
    } = query;
    const mongo: any = { archivedAt: null };
    if (language) mongo.language = language;
    if (typeof priceMin === 'number' || typeof priceMax === 'number') {
      mongo.pricePerLesson = {};
      if (typeof priceMin === 'number') mongo.pricePerLesson.$gte = priceMin;
      if (typeof priceMax === 'number') mongo.pricePerLesson.$lte = priceMax;
    }
    if (startFrom) mongo.startDate = { ...(mongo.startDate || {}), $gte: new Date(startFrom) };
    if (endTo) mongo.endDate = { ...(mongo.endDate || {}), $lte: new Date(endTo) };
    if (q) mongo.$or = [{ title: new RegExp(q, 'i') }, { description: new RegExp(q, 'i') }];

    const total = await CourseModel.countDocuments(mongo);
    const items = await CourseModel.find(mongo)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // attach derived status
    const now = Date.now();
    const withStatus = items.map(c => {
      const start = new Date(c.startDate).getTime();
      const end = c.endDate ? new Date(c.endDate).getTime() : Infinity;
      const derived =
        c.published && start <= now && now <= end ? 'ACTIVE' : c.archivedAt ? 'ARCHIVED' : 'DRAFT';
      return { ...c, status: derived };
    });
    // filter by status if requested
    const filtered = status ? withStatus.filter(c => c.status === status) : withStatus;
    return { page, limit, total: status ? filtered.length : total, items: filtered } as any;
  },

  async updateCourse(id: string, patch: Partial<CourseDoc>) {
    return CourseModel.findByIdAndUpdate(
      id,
      { $set: patch },
      { new: true, runValidators: true }
    ).lean();
  },

  async setCoursePublished(id: string, published: boolean) {
    return CourseModel.findByIdAndUpdate(id, { $set: { published } }, { new: true }).lean();
  },

  async setCourseArchived(id: string, archived: boolean) {
    return CourseModel.findByIdAndUpdate(
      id,
      { $set: { archivedAt: archived ? new Date() : null } },
      { new: true }
    ).lean();
  },

  async anyLessonHasTrial(courseId: string): Promise<boolean> {
    const exists = await LessonModel.exists({ courseId, trialAvailable: true, archivedAt: null });
    return !!exists;
  }
};
