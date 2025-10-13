// src/modules/lessons/lesson.routes.ts
import { Router } from 'express';
import { validateBody, validateQuery } from '../../middlewares/validation';
import { createLessonSchema, updateLessonSchema, listLessonQuery } from './lesson.schemas';
import * as ctrl from './lesson.controller';
import { authenticate } from '../../middlewares/auth';

const r = Router();
r.post(
  '/courses/:courseId/lessons',
  authenticate,
  validateBody(createLessonSchema),
  ctrl.createLesson
);
r.patch('/lessons/:lessonId', authenticate, validateBody(updateLessonSchema), ctrl.updateLesson);
r.post('/lessons/:lessonId/publish', authenticate, ctrl.publishLesson);
r.post('/lessons/:lessonId/unpublish', authenticate, ctrl.unpublishLesson);
r.post('/lessons/:lessonId/archive', authenticate, ctrl.archiveLesson);
r.post('/lessons/:lessonId/restore', authenticate, ctrl.restoreLesson);

// public reads
r.get('/courses/:courseId/lessons', validateQuery(listLessonQuery), ctrl.listLessons);
r.get('/lessons/:lessonId', ctrl.getLesson);

export default r;
