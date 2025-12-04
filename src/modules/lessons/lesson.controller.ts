import { Request, Response } from 'express';
import { createErrorResponse, createSuccessResponse } from '../../utils/apiResponse';
import {
  lessonCreateSchema,
  lessonUpdateSchema,
  lessonReorderSchema,
  listLessonsQuerySchema
} from './lesson.schemas';
import { LessonService } from './lesson.service';
import { CourseService } from '../courses/course.service';
import { LessonDoc } from '../../models/lesson.model';
import { Types } from 'mongoose';
import { AuthenticatedRequest } from '../../middlewares/auth';
import sessionService from '../sessions/sessions.service';
import { UserPayload } from '../../types/UserPayload';
import { SessionStatus } from '../../models/sessions.model';
import bookingModel from '../../models/booking.model';
import { CoursesListResponse, LessonListResponse, LessonViewType } from '../../types/LessonTypes';
import { normalizeTimezone } from './lesson.util';

export const createLesson = async (req: Request, res: Response) => {
  const parsed = lessonCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json(createErrorResponse(parsed.error.message, 'Validation Error', 422));
  }
  try {
    const { courseId, ...rest } = parsed.data;

    // ensure schedule.date is a Date instance (parsed schema may provide string)
    const sanitizedRest: any = { ...rest };

    if (sanitizedRest.schedule && sanitizedRest.schedule.date) {
      const sd = sanitizedRest.schedule.date;
      // if sd is already a Date, keep it
      if (sd instanceof Date) {
        sanitizedRest.schedule = { ...sanitizedRest.schedule, date: sd };
      } else if (typeof sd === 'string') {
        const trimmed = sd.trim();
        // preserve plain YYYY-MM-DD strings as-is (important!)
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
          sanitizedRest.schedule = { ...sanitizedRest.schedule, date: trimmed };
        } else {
          // If it's a full ISO with time/offset, keep string (parseStartEnd will parse setZone)
          sanitizedRest.schedule = { ...sanitizedRest.schedule, date: trimmed };
        }
      } else {
        // leave unchanged and let zod / parseStartEnd catch invalid types
      }
    }

    const teacherObjId = new Types.ObjectId(req.user!.id);
    const courseObjId = new Types.ObjectId(courseId);

    // Ensure schedule.date is a Date at the type level
    let schedule: { date: Date; time: string; duration: number } | undefined;
    if (sanitizedRest.schedule) {
      const sd = sanitizedRest.schedule.date;
      const dateObj = sd instanceof Date ? sd : new Date(sd);
      schedule = {
        ...sanitizedRest.schedule,
        date: dateObj
      };
    }

    // Omit any schedule coming from sanitizedRest when spreading to avoid
    // accidentally assigning a schedule with a string date into the payload.
    const { schedule: _omitSchedule, ...restWithoutSchedule } = sanitizedRest;

    // Ensure schedule has a Date at compile time by casting to the LessonDoc schedule type
    const scheduleForPayload = schedule
      ? (schedule as { date: Date; time: string; duration: number })
      : undefined;

    // Build payload in two steps so TypeScript cannot infer a string-able date in schedule
    const payload: Partial<LessonDoc> = {
      teacherId: teacherObjId,
      courseId: courseObjId
    };

    // Copy other fields (restWithoutSchedule has schedule omitted)
    Object.assign(payload, restWithoutSchedule as Omit<Partial<LessonDoc>, 'schedule'>);

    // Ensure schedule property (with a proper Date) is assigned explicitly
    if (scheduleForPayload) {
      payload.schedule = scheduleForPayload;
    }

    const rawTz = req.userTimezone || 'UTC';
    const timezone = normalizeTimezone(rawTz);

    const created = await LessonService.create(payload, timezone);

    if (!created) {
      throw new Error('Lesson creation failed');
    }

    const course = await CourseService.getById(courseId);

    if (course?.mode === 'in-person') {
      return res.status(201).json(createSuccessResponse({ created }, 'Created', 201));
    }

    const session = await sessionService.createSessionForLesson({
      lessonId: created.id,
      courseId: created.courseId as unknown as string,
      teacherId: created.teacherId as unknown as string,
      start: created.startAt,
      end: created.endAt
    });
    return res.status(201).json(createSuccessResponse({ created, session }, 'Created', 201));
  } catch (e: any) {
    return res
      .status(500)
      .json(createErrorResponse('Create lesson failed', 'Internal Server Error', 500));
  }
};

export const updateLesson = async (req: Request, res: Response) => {
  const parsed = lessonUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json(createErrorResponse(parsed.error.message, 'Validation Error', 422));
  }
  try {
    const { courseId, teacherId, ...rest } = parsed.data;

    // Separate schedule from other fields to avoid spreading a schedule with a string date
    const { schedule, ...restFields } = rest as any;

    const payload: Partial<LessonDoc> = {
      ...(teacherId && { teacherId: new Types.ObjectId(teacherId) }),
      ...(courseId && { courseId: new Types.ObjectId(courseId) }),
      ...restFields
    };

    // Normalize schedule.date to a Date instance if schedule was provided
    if (schedule) {
      const dateVal = schedule.date instanceof Date ? schedule.date : new Date(schedule.date);
      payload.schedule = {
        date: dateVal,
        time: schedule.time,
        duration: schedule.duration
      } as { date: Date; time: string; duration: number };
    }

    const rawTz = req.userTimezone || 'UTC';
    const timezone = normalizeTimezone(rawTz);

    const updated = await LessonService.update(req.params.id, payload, timezone);
    if (!updated)
      return res.status(404).json(createErrorResponse('Lesson not found', 'Not found', 404));
    return res.json(createSuccessResponse(updated, 'Updated'));
  } catch (e: any) {
    if (e?.message === 'TRIAL_EXISTS') {
      return res
        .status(409)
        .json(createErrorResponse('Another trial lesson already exists', 'Conflict', 409));
    }
    return res
      .status(500)
      .json(createErrorResponse('Update lesson failed', 'Internal Server Error', 500));
  }
};

export const deleteLesson = async (req: Request, res: Response) => {
  const removed = await LessonService.remove(req.params.id);
  if (!removed)
    return res.status(404).json(createErrorResponse('Lesson not found', 'Not found', 404));
  return res.json(createSuccessResponse(removed, 'Deleted'));
};

export const duplicateLesson = async (req: Request, res: Response) => {
  const copy = await LessonService.duplicate(req.params.id);
  if (!copy) return res.status(404).json(createErrorResponse('Lesson not found', 'Not found', 404));
  return res.status(201).json(createSuccessResponse(copy, 'Duplicated', 201));
};

export const reorderLessons = async (req: Request, res: Response) => {
  const parsed = lessonReorderSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(422).json(createErrorResponse(parsed.error.message, 'Validation Error', 422));
  await LessonService.reorder(req.params.courseId, parsed.data.items);
  return res.json(createSuccessResponse(true, 'Reordered'));
};

export const listLessonsForCourse = async (req: Request, res: Response) => {
  const courseId = String(req.params.courseId);

  if (!Types.ObjectId.isValid(courseId)) {
    return res.status(400).json(createErrorResponse('Invalid courseId', 'Bad Request', 400));
  }

  const course = await CourseService.getById(courseId);
  if (!course) {
    return res.status(404).json(createErrorResponse('Course not found', 'Not Found', 404));
  }

  const parsed = listLessonsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(422).json(createErrorResponse(parsed.error.message, 'Validation Error', 422));
  }

  const q = parsed.data;

  // normalize date inputs to a single range (align to Courses names)
  const dateFrom = q.startDate ?? q.dateFrom;
  const dateTo = q.endDate ?? q.dateTo;

  // prefer sortBy (like Courses), otherwise honor sortKey/sortDirection (your curl)
  const sort = LessonService.resolveSort(q);

  const result = await LessonService.listByCourse(courseId, {
    search: q.search,
    status: q.status,
    isTrialAvailable: q.isTrialAvailable,
    dateFrom,
    dateTo,
    sort,
    page: q.page,
    limit: q.limit
  });

  return res.json(createSuccessResponse({ ...result, course }));
};

export const bulkCreateForCourse = async (req: Request, res: Response) => {
  try {
    const courseId = new Types.ObjectId(req.params.courseId);
    const lessons = req.body.lessons || [];
    const rawTz = req.userTimezone || 'UTC';
    const timeZone = normalizeTimezone(rawTz);

    const result = await LessonService.bulkCreateForCourse({ courseId, lessons, timeZone });

    const course = await CourseService.getById(req.params.courseId);

    const enrolledStudents = await bookingModel
      .find({
        course: courseId,
        paymentStatus: 'PAID'
      })
      .select('student')
      .lean();

    const studentIds = enrolledStudents.map((booking: any) => booking.student.toString());

    const sessions = await Promise.all(
      result.items.map(async lesson => {
        const session = await sessionService.createSessionForLesson({
          lessonId: lesson._id as string,
          courseId: lesson.courseId as unknown as string,
          teacherId: lesson.teacherId as unknown as string,
          start: lesson.startAt,
          end: lesson.endAt,
          students: studentIds
        });

        return session;
      })
    );

    const resultWithSessions = result.items.map((lesson, index) => ({
      ...lesson,
      session: sessions[index]
    }));

    return res
      .status(201)
      .json(createSuccessResponse(resultWithSessions, 'Lessons created successfully', 201));
  } catch (err: any) {
    switch (err.code) {
      case '404_NOT_FOUND':
        return res.status(404).json(createErrorResponse(err.message, '404_NOT_FOUND', 404));

      case '409_CONFLICT_OVERLAP':
        return res.status(409).json(createErrorResponse(err.message, '409_CONFLICT_OVERLAP', 409));

      case '422_VALIDATION':
        return res
          .status(422)
          .json(
            createErrorResponse(JSON.stringify({ fields: err.fields || [] }), '422_VALIDATION', 422)
          );

      default:
        return res
          .status(500)
          .json(createErrorResponse('Failed to create lessons', 'Internal Server Error', 500));
    }
  }
};

export const bulkUpdateForCourse = async (req: Request, res: Response) => {
  try {
    const courseId = new Types.ObjectId(req.params.courseId);
    const updates = req.body.updates || [];
    const deletes = req.body.deletes || [];
    const rawTz = req.userTimezone || 'UTC';
    const timeZone = normalizeTimezone(rawTz);
    const result = await LessonService.bulkUpdateForCourse({
      courseId,
      updates,
      deletes,
      timeZone
    });
    return res.status(200).json(createSuccessResponse(result, 'Lessons updated', 200));
  } catch (err: any) {
    switch (err.code) {
      case '404_NOT_FOUND':
        return res.status(404).json(createErrorResponse(err.message, '404_NOT_FOUND', 404));

      case '409_CONFLICT_OVERLAP':
        return res.status(409).json(createErrorResponse(err.message, '409_CONFLICT_OVERLAP', 409));

      case '422_VALIDATION':
        return res
          .status(422)
          .json(
            createErrorResponse(JSON.stringify({ fields: err.fields || [] }), '422_VALIDATION', 422)
          );

      default:
        return res
          .status(500)
          .json(createErrorResponse('Failed to create lessons', 'Internal Server Error', 500));
    }
  }
};

export const getLessonsDashboard = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const rawTz = req.userTimezone || 'UTC';
    const timeZone = normalizeTimezone(rawTz);
    const lessons = await LessonService.getLessonsDashboard(userId!, timeZone);

    return res.json(createSuccessResponse({ lessons }, 'Lessons dashboard', 200));
    // return res.json(createSuccessResponse({ lessons, course }));
  } catch (error) {
    return res
      .status(500)
      .json(createErrorResponse('Failed to get lessons dashboard', 'Internal Server Error', 500));
  }
};

export async function getCalendarOverview(req: Request, res: Response) {
  try {
    const { month, year } = req.query;
    const user = (req as any).user;

    if (!month || !year) {
      return res.status(400).json({
        success: false,
        error: 'month and year query params are required'
      });
    }

    const rawTz = req.userTimezone || 'UTC';
    const timeZone = normalizeTimezone(rawTz);

    const data = await LessonService.getCalendarOverview(
      user.id,
      user.role,
      parseInt(month as string),
      parseInt(year as string),
      timeZone
    );

    return res.json(createSuccessResponse(data, 'Calendar data', 200));
  } catch (err) {
    return res
      .status(500)
      .json(createErrorResponse('Failed to get calendar data', 'Internal Server Error', 500));
  }
}

export async function getSessionsByDate(req: Request, res: Response) {
  try {
    const { date } = req.params;
    const user = (req as any).user;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      });
    }

    const rawTz = req.userTimezone || 'UTC';
    const timeZone = normalizeTimezone(rawTz);

    const sessions = await LessonService.getSessionsByDate(user.id, user.role, date, timeZone);

    res.json(createSuccessResponse({ sessions }, 'Sessions for date', 200));
  } catch (err) {
    return res
      .status(500)
      .json(createErrorResponse('Failed to get sessions by date', 'Internal Server Error', 500));
  }
}

export const getLessonStats = async (req: Request, res: Response) => {
  try {
    const teacherId = req.user?.id;

    if (!teacherId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Teacher ID not found'
      });
    }

    const [pending, completed, cancelled] = await Promise.all([
      LessonService.getLessons({
        teacherId,
        status: SessionStatus.SCHEDULED,
        page: 1,
        limit: 1
      }),
      LessonService.getLessons({
        teacherId,
        status: SessionStatus.COMPLETED,
        page: 1,
        limit: 1
      }),
      LessonService.getLessons({
        teacherId,
        status: SessionStatus.CANCELLED,
        page: 1,
        limit: 1
      })
    ]);

    return res.status(200).json({
      success: true,
      data: {
        pending: pending.pagination.total,
        completed: completed.pagination.total,
        cancelled: cancelled.pagination.total
      }
    });
  } catch (error) {
    return res
      .status(500)
      .json(createErrorResponse('Error in getLessonStats', 'Internal Server Error', 500));
  }
};

export const getLessons = async (req: Request, res: Response) => {
  try {
    const teacherId = req.user?.id;

    const {
      startDate,
      endDate,
      status = 'all',
      studentName,
      sortBy = 'dateTime',
      sortOrder = 'desc',
      page = '1',
      limit = '10'
    } = req.query;

    const validStatuses = [...Object.values(SessionStatus), 'all'];
    if (status && !validStatuses.includes(status as string)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }
    const validSortBy = ['dateTime', 'student', 'status', 'subject'];
    if (sortBy && !validSortBy.includes(sortBy as string)) {
      return res.status(400).json({
        success: false,
        message: `Invalid sortBy. Must be one of: ${validSortBy.join(', ')}`
      });
    }

    const validSortOrder = ['asc', 'desc'];
    if (sortOrder && !validSortOrder.includes(sortOrder as string)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid sortOrder. Must be asc or desc'
      });
    }

    const query = {
      teacherId,
      startDate: startDate as string,
      endDate: endDate as string,
      status: status as SessionStatus | 'all',
      studentName: studentName as string,
      sortBy: sortBy as 'date' | 'student' | 'status',
      sortOrder: sortOrder as 'asc' | 'desc',
      page: parseInt(page as string, 10),
      limit: parseInt(limit as string, 10)
    };

    if (isNaN(query.page) || query.page < 1) {
      query.page = 1;
    }
    if (isNaN(query.limit) || query.limit < 1 || query.limit > 100) {
      query.limit = 10;
    }

    const result = await LessonService.getLessons(query as any);

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    return res
      .status(500)
      .json(createErrorResponse('Error in getLessons', 'Internal Server Error', 500));
  }
};

export const getLessonsForStudent = async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params;

    if (!studentId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Student ID not found'
      });
    }

    const rawTz = req.userTimezone || 'UTC';
    const timezone = normalizeTimezone(rawTz);

    const lessons = await LessonService.getLessonsForStudent(studentId, timezone);

    return res.status(200).json({
      success: true,
      data: lessons
    });
  } catch (error) {
    return res
      .status(500)
      .json(createErrorResponse('Error in getLessonsForStudent', 'Internal Server Error', 500));
  }
};

export async function getStudentCalendarOverview(req: Request, res: Response) {
  try {
    const { month, year } = req.query;
    const { studentId } = req.params;

    if (!month || !year) {
      return res.status(400).json({
        success: false,
        error: 'month and year query params are required'
      });
    }

    const rawTz = req.userTimezone || 'UTC';
    const timezone = normalizeTimezone(rawTz);

    const data = await LessonService.getStudentCalendarOverview(
      studentId,
      parseInt(month as string),
      parseInt(year as string),
      timezone
    );

    return res.json(createSuccessResponse(data, 'Calendar data', 200));
  } catch (err) {
    return res
      .status(500)
      .json(createErrorResponse('Failed to get calendar data', 'Internal Server Error', 500));
  }
}

export async function getStudentSessionsByDate(req: Request, res: Response) {
  try {
    const { studentId, date } = req.params;
    const user = (req as any).user;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      });
    }
    const rawTz = req.userTimezone || 'UTC';
    const timezone = normalizeTimezone(rawTz);

    const sessions = await LessonService.getStudentSessionsByDate(studentId, date, timezone);

    res.json(createSuccessResponse({ sessions }, 'Sessions for date', 200));
  } catch (err) {
    return res
      .status(500)
      .json(createErrorResponse('Failed to get sessions by date', 'Internal Server Error', 500));
  }
}

/**
 * GET /api/lessons/courses
 * Get list of courses for filter dropdown
 */
export async function getCourses(req: Request, res: Response): Promise<Response> {
  try {
    const { studentId } = req.params; // Assuming user is attached by auth middleware

    if (!studentId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const courses = await LessonService.getStudentCourses(studentId);

    const response: CoursesListResponse = {
      success: true,
      data: {
        courses
      }
    };

    return res.status(200).json(response);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch courses'
    });
  }
}

/**
 * GET /api/lessons
 * Get list of lessons (upcoming or history)
 * Query params:
 *   - courseId: string (optional) - filter by course
 *   - view: 'upcoming' | 'history' (optional, default: 'upcoming')
 *   - page: number (optional, default: 1)
 *   - limit: number (optional, default: 10)
 */
export async function getLessonsForStudentPage(req: Request, res: Response): Promise<Response> {
  try {
    const { studentId } = req.params; // Assuming user is attached by auth middleware

    if (!studentId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const { courseId, view, page, limit } = req.query;

    // Validate view parameter
    const viewType = (view as LessonViewType) || LessonViewType.UPCOMING;
    if (viewType !== LessonViewType.UPCOMING && viewType !== LessonViewType.HISTORY) {
      return res.status(400).json({
        success: false,
        message: 'Invalid view parameter. Must be "upcoming" or "history"'
      });
    }

    // Parse pagination parameters
    const pageNum = page ? parseInt(page as string, 10) : 1;
    const limitNum = limit ? parseInt(limit as string, 10) : 10;

    if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        success: false,
        message: 'Invalid pagination parameters'
      });
    }

    const data = await LessonService.getStudentLessons({
      studentId,
      courseId: courseId as string,
      view: viewType,
      page: pageNum,
      limit: limitNum
    });

    const response: LessonListResponse = {
      success: true,
      data
    };

    return res.status(200).json(response);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch lessons'
    });
  }
}
