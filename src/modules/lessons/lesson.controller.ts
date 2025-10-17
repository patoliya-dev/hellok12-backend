import { Request, Response } from 'express';
import { createErrorResponse, createSuccessResponse } from '../../utils/apiResponse';
import { lessonCreateSchema, lessonUpdateSchema, lessonReorderSchema } from './lesson.schemas';
import { LessonService } from './lesson.service';
import { LessonDoc } from '../../models/lesson.model';
import { Types } from 'mongoose';
import { AuthenticatedRequest } from '../../middlewares/auth';

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
    return res.status(201).json(createSuccessResponse(created, 'Created', 201));
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
      teacherId: new Types.ObjectId(teacherId || req.user!.id),
      courseId: new Types.ObjectId(courseId)
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

  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 20) || 20));

  // Optional date filters (accept ISO strings)
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  // const page = Number(req.query.page || 1);
  // const limit = Number(req.query.limit || 20);
  const data = await LessonService.listByCourse(req.params.courseId, {
    from,
    to,
    page,
    limit
  });
  return res.json(createSuccessResponse(data));
};

export const bulkCreateForCourse = async (req: Request, res: Response) => {
  try {
    const courseId = new Types.ObjectId(req.params.courseId);
    const lessons = req.body.lessons || [];
    const result = await LessonService.bulkCreateForCourse({ courseId, lessons });
    return res.status(201).json(createSuccessResponse(result, 'Lessons created', 201));
  } catch (err: any) {
    const code = err?.code;
    if (code === '409_CONFLICT_OVERLAP') {
      return res.status(409).json(createErrorResponse(err.message, code, 409));
    }
    return res
      .status(500)
      .json(createErrorResponse('Failed to create lessons', 'Internal Server Error', 500));
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
    const code = err?.code;
    if (code === '409_CONFLICT_OVERLAP') {
      return res.status(409).json(createErrorResponse(err.message, code, 409));
    }
    return res
      .status(500)
      .json(createErrorResponse('Failed to update lessons', 'Internal Server Error', 500));
  }
};
