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

export const createLesson = async (req: Request, res: Response) => {
  const parsed = lessonCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json(createErrorResponse(parsed.error.message, 'Validation Error', 422));
  }
  try {
    const { courseId, ...rest } = parsed.data;

    const payload: Partial<LessonDoc> = {
      ...rest,
      teacherId: new Types.ObjectId(req.user!.id),
      courseId: new Types.ObjectId(courseId)
    };

    const created = await LessonService.create(payload);

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
    const payload: Partial<LessonDoc> = {
      ...rest,
      ...(teacherId && { teacherId: new Types.ObjectId(teacherId) }),
      ...(courseId && { courseId: new Types.ObjectId(courseId) })
    };

    const updated = await LessonService.update(req.params.id, payload);
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

    const result = await LessonService.bulkCreateForCourse({ courseId, lessons });

    const sessions = await Promise.all(
      result.items.map(async lesson => {
        const session = await sessionService.createSessionForLesson({
          lessonId: lesson._id as string,
          courseId: lesson.courseId as unknown as string,
          teacherId: lesson.teacherId as unknown as string,
          start: lesson.startAt,
          end: lesson.endAt
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
    const result = await LessonService.bulkUpdateForCourse({ courseId, updates, deletes });
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
    const lessons = await LessonService.getLessonsDashboard(userId!);

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

    const data = await LessonService.getCalendarOverview(
      user.id,
      user.role,
      parseInt(month as string),
      parseInt(year as string)
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

    const sessions = await LessonService.getSessionsByDate(user.id, user.role, date);

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
