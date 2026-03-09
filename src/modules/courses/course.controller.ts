import { Request, Response } from 'express';
import { createErrorResponse, createSuccessResponse } from '../../utils/apiResponse';
import { courseCreateSchema, courseUpdateSchema, listQuerySchema } from './course.schemas';
import { CourseService } from './course.service';
import { USER_ROLES } from '../../utils/constants';
import { ValidatedRequest } from '../../middlewares/validation';
import { normalizeTimezone } from '../lessons/lesson.util';
import { AuthenticatedRequest } from '../../middlewares/auth';
import { notificationService } from '../notifications/notification.service';
import { buildCourseDiff } from '../notifications/notificationDiff.util';

export const createCourse = async (req: ValidatedRequest, res: Response) => {
  const parsed = courseCreateSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(422).json(createErrorResponse(parsed.error.message, 'Validation Error', 422));

  const role = req.user!.role === USER_ROLES.SCHOOL ? 'school' : 'teacher';
  const owner:
    | {
        role: 'school' | 'teacher';
        id: string;
      }
    | undefined = { role, id: req.user!.id };

  const rawTz = req.userTimezone || 'UTC';
  const timezone = normalizeTimezone(rawTz);

  const course = await CourseService.create(parsed.data, owner, timezone);
  return res.status(201).json(createSuccessResponse(course, 'Created', 201));
};

export const updateCourse = async (req: Request, res: Response) => {
  try {
    const parsed = courseUpdateSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(422)
        .json(createErrorResponse(parsed.error.message, 'Validation Error', 422));

    const role = req.user!.role === USER_ROLES.SCHOOL ? 'school' : 'teacher';
    const owner:
      | {
          role: 'school' | 'teacher';
          id: string;
        }
      | undefined = { role, id: req.user!.id };

    const rawTz = req.userTimezone || 'UTC';
    const timezone = normalizeTimezone(rawTz);

    const beforeCourse = await CourseService.getById(req.params.id);
    const updated = await CourseService.update(req.params.id, parsed.data, owner, timezone);

    if (!updated) {
      return res.status(404).json(createErrorResponse('Course not found', 'Not found', 404));
    }

    try {
      const diff = buildCourseDiff(beforeCourse, updated, timezone);
      await notificationService.notifyCourseUpdated({
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        courseId: String((updated as any)._id || req.params.id),
        title: String((updated as any).title || ''),
        diff,
        changedAt: new Date().toISOString()
      });
    } catch {
      // intentionally non-blocking
    }

    return res.status(200).json(createSuccessResponse(updated, 'Course updated successfully', 200));
  } catch (error: any) {
    const status = Number(error?.statusCode || 500);
    return res
      .status(status)
      .json(createErrorResponse(error?.message || 'Internal Server Error', 'Error', status));
  }
};

export const deleteCourse = async (req: Request, res: Response) => {
  const role = req.user!.role === USER_ROLES.SCHOOL ? 'school' : 'teacher';
  const owner:
    | {
        role: 'school' | 'teacher';
        id: string;
      }
    | undefined = { role, id: req.user!.id };
  const removed = await CourseService.remove(req.params.id, owner);
  if (!removed)
    return res.status(404).json(createErrorResponse('Course not found', 'Not found', 404));
  return res.json(createSuccessResponse(removed, 'Deleted'));
};

export const duplicateCourse = async (req: Request, res: Response) => {
  const role = req.user!.role === USER_ROLES.SCHOOL ? 'school' : 'teacher';
  const owner:
    | {
        role: 'school' | 'teacher';
        id: string;
      }
    | undefined = { role, id: req.user!.id };
  const copy = await CourseService.duplicate(req.params.id, owner);
  if (!copy) return res.status(404).json(createErrorResponse('Course not found', 'Not found', 404));
  return res.status(201).json(createSuccessResponse(copy, 'Duplicated', 201));
};

export const getCourseDetail = async (req: Request, res: Response) => {
  const data = await CourseService.getByIdWithLessons(req.params.id);
  if (!data) return res.status(404).json(createErrorResponse('Course not found', 'Not found', 404));
  return res.json(createSuccessResponse(data));
};

export const listCourses = async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success)
    return res.status(422).json(createErrorResponse(parsed.error.message, 'Validation Error', 422));

  // if this is dashboard view, scope by owner; if marketplace, drop owner
  const role =
    req.user!.role === USER_ROLES.SCHOOL
      ? 'school'
      : req.user!.role === USER_ROLES.TEACHER
        ? 'teacher'
        : undefined;
  const owner:
    | {
        role: 'school' | 'teacher';
        id: string;
      }
    | undefined = role ? { role, id: req.user!.id } : undefined;

  const rawTz = req.userTimezone || 'UTC';
  const timezone = normalizeTimezone(rawTz);

  const result = await CourseService.list({ ...parsed.data, owner, timezone });
  return res.json(createSuccessResponse(result));
};

export const courseDetails = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const studentId = typeof req.query?.studentId === 'string' ? req.query.studentId : undefined;

    if (!id) return createErrorResponse('Invalid request', 'Invalid request', 400);

    const data = await CourseService.getCourseDetails(
      id,
      { id: req.user?.id, role: req.user?.role },
      studentId
    );

    if (!data)
      return res.status(404).json(createErrorResponse('Course not found', 'Not found', 404));

    return res.json(createSuccessResponse(data, 'Course details fetched successfully', 200));
  } catch (error: any) {
    return res.status(500).json(createErrorResponse(error.message, 'Error', 500));
  }
};

export const courseFeedbacks = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { sortBy = 'recent', limit } = req.query;
    if (!id) return createErrorResponse('Invalid request', 'Invalid request', 400);

    const data = await CourseService.getCourseFeedbacks(
      id,
      sortBy as 'recent' | 'highest',
      Number(limit)
    );

    if (!data)
      return res.status(404).json(createErrorResponse('Course not found', 'Not found', 404));

    return res.json(createSuccessResponse(data, 'Course feedbacks fetched successfully', 200));
  } catch (error: any) {
    return res.status(500).json(createErrorResponse(error.message, 'Error', 500));
  }
};

export const getSchoolCourses = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const schoolId = req.user?.id;
    if (!schoolId) {
      return res.status(401).json(createErrorResponse('Unauthorized', 'Unauthorized', 401));
    }

    const status = (req.query.status as string) || 'active';

    // Optional: allow only supported values
    const allowed = new Set(['active', 'draft', 'archived', 'all']);
    const normalized = allowed.has(status) ? status : 'active';

    const courses = await CourseService.listCoursesForSchool({
      schoolId,
      status: normalized === 'all' ? undefined : (normalized as any)
    });

    return res
      .status(200)
      .json(createSuccessResponse({ courses }, 'School courses fetched successfully', 200));
  } catch (e: any) {
    return res
      .status(500)
      .json(createErrorResponse(e?.message || 'Failed to fetch school courses', 'Error', 500));
  }
};
