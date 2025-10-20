// src/modules/lessons/lesson.controller.ts
import { Request, Response } from 'express';
import { LessonRepo } from './lesson.service';
import { CourseRepo } from '../courses/course.service';
import { createSuccessResponse, createErrorResponse } from '../../utils/apiResponse';
import { canManageCourse } from '../../middlewares/rbac';

export const createLesson = async (req: Request, res: Response) => {
  const { courseId } = req.params;
  const course = await CourseRepo.getCourseById(courseId);
  if (!course)
    return res.status(404).json(createErrorResponse('COURSE_NOT_FOUND', 'Not found', 404));
  if (!canManageCourse(req.user!, course as any)) {
    return res.status(403).json(createErrorResponse('FORBIDDEN', 'Forbidden', 403));
  }

  // session time validation: future + within course range
  const start = new Date((course as any).startDate).getTime();
  const end = (course as any).endDate ? new Date((course as any).endDate).getTime() : Infinity;
  const now = Date.now();
  for (const s of req.body.sessions) {
    const t = new Date(s.startTime).getTime();
    if (!(start <= t && t <= end))
      return res
        .status(422)
        .json(createErrorResponse('SESSION_OUT_OF_COURSE_RANGE', 'Validation', 422));
    if (t <= now)
      return res.status(422).json(createErrorResponse('SESSION_MUST_BE_FUTURE', 'Validation', 422));
  }

  const created = await LessonRepo.createLesson(String((course as any)._id), req.body);
  return res.status(201).json(createSuccessResponse(created, 'Created', 201));
};

export const getLesson = async (req: Request, res: Response) => {
  const l = await LessonRepo.getLessonById(req.params.lessonId);
  if (!l) return res.status(404).json({ error: 'NOT_FOUND' });
  return res.json(l);
};

export const listLessons = async (req: Request, res: Response) => {
  const { courseId } = req.params;
  const course = await CourseRepo.getCourseById(courseId);
  if (!course) return res.status(404).json({ error: 'COURSE_NOT_FOUND' });
  const result = await LessonRepo.listLessons(String((course as any)._id), req.query);
  return res.json(result);
};

export const updateLesson = async (req: Request, res: Response) => {
  const user = req.user!;
  const lesson = await LessonRepo.getLessonById(req.params.lessonId);
  if (!lesson) return res.status(404).json({ error: 'NOT_FOUND' });
  const course = await CourseRepo.getCourseById(String((lesson as any).courseId));
  if (!course) return res.status(404).json({ error: 'COURSE_NOT_FOUND' });
  if (!canManageCourse(user, course as any)) return res.status(403).json({ error: 'FORBIDDEN' });

  if (req.body.sessions) {
    const start = new Date((course as any).startDate).getTime();
    const end = (course as any).endDate ? new Date((course as any).endDate).getTime() : Infinity;
    const now = Date.now();
    for (const s of req.body.sessions) {
      const t = new Date(s.startTime).getTime();
      if (!(start <= t && t <= end))
        return res.status(422).json({ error: 'SESSION_OUT_OF_COURSE_RANGE' });
      if (t <= now) return res.status(422).json({ error: 'SESSION_MUST_BE_FUTURE' });
    }
  }

  const patch = { ...req.body, updatedAt: new Date() };
  const updated = await LessonRepo.updateLesson(String((lesson as any)._id), patch);
  if (!updated) return res.status(500).json({ error: 'UPDATE_FAILED' });
  return res.json(updated);
};

export const publishLesson = async (req: Request, res: Response) => {
  const user = req.user!;
  const l = await LessonRepo.getLessonById(req.params.lessonId);
  if (!l) return res.status(404).json({ error: 'NOT_FOUND' });
  const course = await CourseRepo.getCourseById(String((l as any).courseId));
  if (!course) return res.status(404).json({ error: 'COURSE_NOT_FOUND' });
  if (!canManageCourse(user, course as any)) return res.status(403).json({ error: 'FORBIDDEN' });
  const updated = await LessonRepo.setLessonPublished(String((l as any)._id), true);
  if (!updated) return res.status(500).json({ error: 'UPDATE_FAILED' });
  return res.json(updated);
};

export const unpublishLesson = async (req: Request, res: Response) => {
  const user = req.user!;
  const l = await LessonRepo.getLessonById(req.params.lessonId);
  if (!l) return res.status(404).json({ error: 'NOT_FOUND' });
  const course = await CourseRepo.getCourseById(String((l as any).courseId));
  if (!course) return res.status(404).json({ error: 'COURSE_NOT_FOUND' });
  if (!canManageCourse(user, course as any)) return res.status(403).json({ error: 'FORBIDDEN' });
  const updated = await LessonRepo.setLessonPublished(String((l as any)._id), false);
  if (!updated) return res.status(500).json({ error: 'UPDATE_FAILED' });
  return res.json(updated);
};

export const archiveLesson = async (req: Request, res: Response) => {
  const user = req.user!;
  const l = await LessonRepo.getLessonById(req.params.lessonId);
  if (!l) return res.status(404).json({ error: 'NOT_FOUND' });
  const course = await CourseRepo.getCourseById(String((l as any).courseId));
  if (!course) return res.status(404).json({ error: 'COURSE_NOT_FOUND' });
  if (!canManageCourse(user, course as any)) return res.status(403).json({ error: 'FORBIDDEN' });
  const updated = await LessonRepo.setLessonArchived(String((l as any)._id), true);
  if (!updated) return res.status(500).json({ error: 'UPDATE_FAILED' });
  return res.json(updated);
};

export const restoreLesson = async (req: Request, res: Response) => {
  const user = req.user!;
  const l = await LessonRepo.getLessonById(req.params.lessonId);
  if (!l) return res.status(404).json({ error: 'NOT_FOUND' });
  const course = await CourseRepo.getCourseById(String((l as any).courseId));
  if (!course) return res.status(404).json({ error: 'COURSE_NOT_FOUND' });
  if (!canManageCourse(user, course as any)) return res.status(403).json({ error: 'FORBIDDEN' });
  const updated = await LessonRepo.setLessonArchived(String((l as any)._id), false);
  if (!updated) return res.status(500).json({ error: 'UPDATE_FAILED' });
  return res.json(updated);
};
