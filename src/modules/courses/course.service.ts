import { FilterQuery, Types, UpdateQuery } from 'mongoose';
import { Course, CourseDoc } from '../../models/course.model';
import { Lesson } from '../../models/lesson.model';
import { CourseCreateDTO, CourseUpdateDTO } from './course.schemas';
import { getCourseDetails, getFeedbacks } from './course.queries';
import { FeedbackRating } from '../../models/feedbackRatings.model';

export const CourseService = {
  async create(data: CourseCreateDTO, owner: { role: 'school' | 'teacher'; id: string }) {
    const payload: Partial<CourseDoc> = {
      title: data.title,
      description: data.description ?? '',
      languageCode: data.languageCode ?? '',
      lessonType: data.lessonType,
      studentCapacity: data.studentCapacity ?? 1,
      mode: data.mode,
      price: data.price,
      currency: data.currency ?? 'USD',
      ageGroups: data.ageGroups,
      startDate: data.startDate,
      endDate: data.endDate ?? null,
      teachers: (data.teachers ?? []).map(t => new Types.ObjectId(t)),
      // cast if present
      introImageRef: data.introImageRef ? new Types.ObjectId(data.introImageRef) : null,

      ownerType: owner.role,
      ownerId: new Types.ObjectId(owner.id),

      status: data.status ?? 'draft',
      isTrialAvailable: false,
      enrolledCount: 0
    };

    const doc = await Course.create(payload);
    return doc.toObject();
  },

  async update(
    id: string,
    data: CourseUpdateDTO,
    owner?: { role: 'school' | 'teacher'; id: string }
  ) {
    const filter: FilterQuery<CourseDoc> = { _id: id };
    if (owner) {
      filter.ownerType = owner.role;
      filter.ownerId = new Types.ObjectId(owner.id);
    }
    const updateQuery: UpdateQuery<CourseDoc> = { $set: data };
    const doc = await Course.findOneAndUpdate(filter, updateQuery, {
      new: true,
      runValidators: true
    }).lean();
    return doc;
  },

  async remove(id: string, owner?: { role: 'school' | 'teacher'; id: string }) {
    const filter: FilterQuery<CourseDoc> = { _id: id };
    if (owner) {
      filter.ownerType = owner.role;
      filter.ownerId = new Types.ObjectId(owner.id);
    }
    await Lesson.deleteMany({ courseId: id }); // cascade lessons
    return Course.findOneAndDelete(filter).lean();
  },

  async duplicate(id: string, owner?: { role: 'school' | 'teacher'; id: string }) {
    const filter: FilterQuery<CourseDoc> = { _id: id };
    if (owner) {
      filter.ownerType = owner.role;
      filter.ownerId = new Types.ObjectId(owner.id);
    }
    const src = await Course.findOne(filter).lean();
    if (!src) return null;

    const copy = await Course.create({
      ...src,
      _id: undefined,
      title: `${src.title} (Copy)`,
      status: 'draft',
      isTrialAvailable: false,
      createdAt: undefined,
      updatedAt: undefined
    });

    const lessons = await Lesson.find({ courseId: id }).lean();
    if (lessons.length) {
      await Lesson.insertMany(
        lessons.map(l => ({
          ...l,
          _id: undefined,
          courseId: copy._id,
          isTrialAvailable: false, // reset (can be toggled later)
          createdAt: undefined,
          updatedAt: undefined
        }))
      );
    }
    return copy.toObject();
  },

  async getById(id: string) {
    const course = await Course.findById(id).populate('introImageRef', 'url').lean();
    if (!course) return null;
    return course;
  },

  async getByIdWithLessons(id: string) {
    const course = await Course.findById(id).populate('introImageRef', 'url').lean();
    if (!course) return null;
    // fetch lessons separately (no aggregation)
    const lessons = await Lesson.find({ courseId: id }).sort({ order: 1, date: 1 }).lean();
    return { ...course, lessons };
  },

  async list(query: {
    search?: string;
    language?: string;
    status?: 'draft' | 'active' | 'archived';
    isTrialAvailable?: boolean;
    priceMin?: number;
    priceMax?: number;
    dateFrom?: Date;
    dateTo?: Date;
    sortBy: string;
    page: number;
    limit: number;
    owner?: { role: 'school' | 'teacher'; id: string }; // optional dashboard scoping
  }) {
    const filter: FilterQuery<CourseDoc> = {};

    if (query.owner) {
      filter.ownerType = query.owner.role;
      filter.ownerId = new Types.ObjectId(query.owner.id);
    }

    if (query.language) filter.language = query.language;
    if (query.status) filter.status = query.status;
    if (typeof query.isTrialAvailable === 'boolean') {
      filter.isTrialAvailable = query.isTrialAvailable;
    }

    if (query.priceMin != null || query.priceMax != null) {
      filter.price = {};
      if (query.priceMin != null) filter.price.$gte = query.priceMin;
      if (query.priceMax != null) filter.price.$lte = query.priceMax;
    }

    if (query.dateFrom || query.dateTo) {
      // simple overlap: start within range OR (no end → >= from)
      if (query.dateFrom && query.dateTo) {
        filter.startDate = { $gte: query.dateFrom, $lte: query.dateTo };
      } else if (query.dateFrom) {
        filter.startDate = { $gte: query.dateFrom };
      } else if (query.dateTo) {
        filter.startDate = { $lte: query.dateTo };
      }
    }

    if (query.search) {
      filter.$or = [
        { title: { $regex: query.search, $options: 'i' } },
        { description: { $regex: query.search, $options: 'i' } }
      ];
    }

    // sorts
    const sortMap: Record<string, any> = {
      newest: { createdAt: -1, _id: 1 },
      titleAsc: { title: 1, _id: 1 },
      titleDesc: { title: -1, _id: 1 },
      languageCodeAsc: { languageCode: 1, _id: 1 },
      languageCodeDesc: { languageCode: -1, _id: 1 },
      studentsAsc: { enrolledCount: 1, _id: 1 },
      studentsDesc: { enrolledCount: -1, _id: 1 },
      priceAsc: { price: 1, _id: 1 },
      priceDesc: { price: -1, _id: 1 },
      statusAsc: { status: 1, _id: 1 },
      statusDesc: { status: -1, _id: 1 },
      startDateAsc: { startDate: 1, _id: 1 },
      startDateDesc: { startDate: -1, _id: 1 }
    };
    const sort = sortMap[query.sortBy] || sortMap.newest;

    const skip = (query.page - 1) * query.limit;

    const [items, total] = await Promise.all([
      Course.find(filter).sort(sort).skip(skip).limit(query.limit).lean(),
      Course.countDocuments(filter)
    ]);

    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.ceil(total / query.limit)
      }
    };
  },

  // called by lesson service to sync trial flag
  async recalcTrialFlag(courseId: string) {
    const hasTrial = await Lesson.exists({ courseId, isTrialAvailable: true });
    await Course.findByIdAndUpdate(courseId, { $set: { isTrialAvailable: !!hasTrial } });
  },

  async getCourseDetails(id: string) {
    try {
      const pipeline = getCourseDetails(id);

      const result = await Course.aggregate(pipeline);

      if (result.length > 0) {
        return result[0];
      } else {
        throw new Error('Course not found');
      }
    } catch (error: any) {
      throw new Error(error.message);
    }
  },

  async getCourseFeedbacks(id: string, sortBy: 'recent' | 'highest', limit: number) {
    try {
      const pipeline = getFeedbacks(id, sortBy, limit);

      const result = await FeedbackRating.aggregate(pipeline as any);

      if (result.length > 0) {
        return result[0];
      } else {
        return [];
      }
    } catch (error: any) {
      throw new Error(error.message);
    }
  }
};
