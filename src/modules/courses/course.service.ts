import { DateTime } from 'luxon';
import { FilterQuery, Types, UpdateQuery } from 'mongoose';
import { Course, CourseDoc } from '../../models/course.model';
import { Lesson } from '../../models/lesson.model';
import { CourseCreateDTO, CourseUpdateDTO } from './course.schemas';
import { getCourseDetails, getFeedbacks } from './course.queries';
import { FeedbackRating } from '../../models/feedbackRatings.model';
import { COURSE_MODE, LESSON_TYPES } from '../../utils/constants';
import BookingModel from '../../models/booking.model';
import { User } from '../../models/user.model';
import { ParentProfileModel } from '../../models/parentProfile.model';
import { canPurchaseCourseRun } from '../bookings/entitlement.util';

function toUtcDateKey(input: Date | string | null | undefined): string | null {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateKeyToUtcStart(key: string | null): Date | null {
  if (!key) return null;
  return new Date(`${key}T00:00:00.000Z`);
}

function dateKeyToUtcEnd(key: string | null): Date | null {
  if (!key) return null;
  return new Date(`${key}T23:59:59.999Z`);
}

function sanitizeCourseAddress(input: any, mergedMode: string, mergedLessonType: string) {
  const needs = mergedMode === COURSE_MODE.IN_PERSON && mergedLessonType === LESSON_TYPES.GROUP;
  if (!needs) return null;

  if (!input) return null;
  return {
    line1: String(input.line1 || '').trim(),
    line2: input.line2 ? String(input.line2).trim() : undefined,
    area: input.area ? String(input.area).trim() : undefined,
    city: String(input.city || '').trim(),
    state: input.state ? String(input.state).trim() : undefined,
    postalCode: input.postalCode ? String(input.postalCode).trim() : undefined,
    country: String(input.country || '')
      .trim()
      .toUpperCase()
  };
}

async function hasPaidOrInFlightPurchase(courseId: any, studentId: string) {
  const normalizedStudentId = String(studentId || '').trim();
  if (!Types.ObjectId.isValid(normalizedStudentId)) return false;
  const studentObj = new Types.ObjectId(normalizedStudentId);

  const existing = await BookingModel.findOne({
    course: courseId,
    student: studentObj,
    isTrial: { $ne: true },
    paymentStatus: { $in: ['PENDING', 'PROCESSING', 'PAID'] }
  })
    .select({ _id: 1 })
    .lean();

  return !canPurchaseCourseRun(!!existing);
}

export const CourseService = {
  async create(
    data: CourseCreateDTO,
    owner: { role: 'school' | 'teacher'; id: string },
    timezone: string = 'UTC'
  ) {
    const startDateUtc = dateKeyToUtcStart(toUtcDateKey(data.startDate));
    const endDateUtc = dateKeyToUtcEnd(toUtcDateKey(data.endDate ?? null));
    if (!startDateUtc) {
      throw Object.assign(new Error('Invalid startDate'), { statusCode: 422 });
    }

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
      startDate: startDateUtc,
      endDate: endDateUtc,
      teachers: (data.teachers ?? []).map(t => new Types.ObjectId(t)),
      // cast if present
      introImageRef: data.introImageRef ? new Types.ObjectId(data.introImageRef) : null,
      address: sanitizeCourseAddress(data.address, data.mode, data.lessonType),
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
    owner?: { role: 'school' | 'teacher'; id: string },
    timezone: string = 'UTC'
  ) {
    const filter: FilterQuery<CourseDoc> = { _id: id };
    // load current to resolve final mode/lessonType after patch
    const current = await Course.findById(id).lean();
    if (!current) return null;

    if (owner) {
      filter.ownerType = owner.role;
      filter.ownerId = new Types.ObjectId(owner.id);
    }

    const { startDate, endDate, ...rest } = data;
    const $set: any = { ...rest };

    if (startDate && toUtcDateKey(startDate) !== toUtcDateKey(current.startDate)) {
      const normalizedStart = dateKeyToUtcStart(toUtcDateKey(startDate));
      if (normalizedStart) {
        $set.startDate = normalizedStart;
      }
    }
    if (endDate !== undefined) {
      const currentEndDateKey = toUtcDateKey(current.endDate ?? null);
      const nextEndDateKey = toUtcDateKey(endDate ?? null);
      if (nextEndDateKey !== currentEndDateKey) {
        $set.endDate = endDate ? dateKeyToUtcEnd(nextEndDateKey) : null;
      }
    }

    const nextMode = data.mode ?? current.mode;
    const nextLessonType = data.lessonType ?? current.lessonType;

    // enforce: address only for in-person group
    if ('address' in data || data.mode || data.lessonType) {
      $set.address = sanitizeCourseAddress(
        data.address ?? current.address,
        nextMode,
        nextLessonType
      );
    }

    const updateQuery: UpdateQuery<CourseDoc> = { $set };
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
      enrolledCount: 0,
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
    timezone?: string;
    sortBy: string;
    page: number;
    limit: number;
    owner?: { role: 'school' | 'teacher'; id: string }; // optional dashboard scoping
  }) {
    const filter: FilterQuery<CourseDoc> = {};
    const tz = query.timezone || 'UTC';

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
      let fromUtc: Date | undefined;
      let toUtc: Date | undefined;

      if (query.dateFrom) {
        fromUtc = DateTime.fromJSDate(query.dateFrom, { zone: tz })
          .startOf('day')
          .toUTC()
          .toJSDate();
      }

      if (query.dateTo) {
        toUtc = DateTime.fromJSDate(query.dateTo, { zone: tz }).endOf('day').toUTC().toJSDate();
      }

      if (fromUtc && toUtc) {
        filter.startDate = { $gte: fromUtc, $lte: toUtc };
      } else if (fromUtc) {
        filter.startDate = { $gte: fromUtc };
      } else if (toUtc) {
        filter.startDate = { $lte: toUtc };
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

  async getCourseDetails(
    id: string,
    viewer?: { id?: string; role?: string },
    studentIdFromQuery?: string
  ) {
    try {
      const pipeline = getCourseDetails(id);

      const result = await Course.aggregate(pipeline);

      if (result.length > 0) {
        const course = result[0];
        const lessons = Array.isArray(course?.lessons) ? course.lessons : [];
        const now = new Date();
        // const activeLessons = lessons.filter((lesson: any) => lesson?.status === 'active');
        const activeLessons = lessons;
        const totalLessons = activeLessons.length;
        const lessonStats = activeLessons.reduce(
          (acc: { completed: number; upcoming: number }, lesson: any) => {
            const startAt = lesson?.startAt ? new Date(lesson.startAt) : null;
            if (!startAt || Number.isNaN(startAt.getTime())) return acc;
            if (startAt < now) acc.completed += 1;
            else acc.upcoming += 1;
            return acc;
          },
          { completed: 0, upcoming: 0 }
        );
        const completedLessons = lessonStats.completed;
        const upcomingLessons = lessonStats.upcoming;
        const remainingLessons = Math.max(upcomingLessons, 0);
        const fullAmountCents = Math.max(0, Math.round((Number(course?.price) || 0) * 100));
        const effectivePriceCents =
          totalLessons > 0
            ? Math.round((fullAmountCents / totalLessons) * remainingLessons)
            : fullAmountCents;

        let targetStudentId: string | null = null;
        const viewerRole = String(viewer?.role || '').toLowerCase();

        if (viewerRole === 'student' && viewer?.id) {
          targetStudentId = String(viewer.id);
        } else if (viewerRole === 'parent' && viewer?.id && studentIdFromQuery) {
          const requestedStudentId = String(studentIdFromQuery).trim();

          if (Types.ObjectId.isValid(requestedStudentId)) {
            const [parentProfile, parentDoc, childDoc] = await Promise.all([
              ParentProfileModel.findOne({ user: viewer.id }).select({ children: 1 }).lean(),
              User.findById(viewer.id).select({ children: 1 }).lean(),
              User.findById(requestedStudentId).select({ parent: 1 }).lean()
            ]);

            const linkedChildIds = new Set<string>(
              [
                ...((parentProfile?.children as any[]) || []),
                ...((parentDoc?.children as any[]) || [])
              ].map((c: any) => String(c))
            );

            const isOwnedViaParentRef =
              childDoc?.parent && String(childDoc.parent) === String(viewer.id);
            const isOwnedViaChildrenArray = linkedChildIds.has(requestedStudentId);

            if (isOwnedViaParentRef || isOwnedViaChildrenArray) {
              targetStudentId = requestedStudentId;
            }
          }
        }

        let alreadyPurchased = false;

        if (targetStudentId && Types.ObjectId.isValid(targetStudentId)) {
          alreadyPurchased = await hasPaidOrInFlightPurchase(course?._id, targetStudentId);
        }

        return {
          ...course,
          pricing: {
            totalLessons,
            completedLessons,
            upcomingLessons,
            remainingLessons,
            fullPriceCents: fullAmountCents,
            fullPrice: Number((fullAmountCents / 100).toFixed(2)),
            effectivePriceCents,
            effectivePrice: Number((effectivePriceCents / 100).toFixed(2))
          },
          purchaseInfo: {
            targetStudentId,
            alreadyPurchased
          }
        };
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
  },

  async listCoursesForSchool(args: { schoolId: string; status?: 'draft' | 'active' | 'archived' }) {
    const { schoolId, status } = args;

    const filter: any = {
      ownerType: 'school',
      ownerId: schoolId
    };
    if (status) filter.status = status;

    // For dropdown: keep payload small
    const courses = await Course.find(filter)
      .select('_id title status mode lessonType startDate endDate')
      .sort({ createdAt: -1 })
      .lean();

    return courses;
  }
};
