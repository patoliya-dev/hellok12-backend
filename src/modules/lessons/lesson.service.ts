import { LessonModel } from '../../models/lesson.model';
export interface Pagination<T> {
  page: number;
  limit: number;
  total: number;
  items: T[];
}

export const LessonRepo = {
  async createLesson(courseId: string, data: any) {
    const doc = await LessonModel.create({ ...data, courseId });
    return doc.toObject({ versionKey: false }) as any;
  },
  async getLessonById(id: string) {
    return LessonModel.findById(id).lean();
  },
  async listLessons(courseId: string, query: any): Promise<Pagination<any>> {
    const { page = 1, limit = 50 } = query;
    const total = await LessonModel.countDocuments({ courseId, archivedAt: null });
    const items = await LessonModel.find({ courseId, archivedAt: null })
      .sort({ orderIndex: 1, createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    return { page, limit, total, items };
  },
  async updateLesson(id: string, patch: any) {
    return LessonModel.findByIdAndUpdate(
      id,
      { $set: patch },
      { new: true, runValidators: true }
    ).lean();
  },
  async setLessonPublished(id: string, published: boolean) {
    return LessonModel.findByIdAndUpdate(id, { $set: { published } }, { new: true }).lean();
  },
  async setLessonArchived(id: string, archived: boolean) {
    return LessonModel.findByIdAndUpdate(
      id,
      { $set: { archivedAt: archived ? new Date() : null } },
      { new: true }
    ).lean();
  }
};
