// src/modules/courses/course.routes.ts
import { Router } from 'express';
import { validateBody, validateQuery } from '../../middlewares/validation';
import { createCourseSchema, updateCourseSchema, listCourseQuery } from './course.schemas';
import * as ctrl from './course.controller';
import { authenticate } from '../../middlewares/auth'; // <-- your existing file

const r = Router();

// protected writes
r.post('/', authenticate, validateBody(createCourseSchema), ctrl.createCourse);
r.patch('/:courseId', authenticate, validateBody(updateCourseSchema), ctrl.updateCourse);
r.post('/:courseId/publish', authenticate, ctrl.publishCourse);
r.post('/:courseId/unpublish', authenticate, ctrl.unpublishCourse);
r.post('/:courseId/archive', authenticate, ctrl.archiveCourse);
r.post('/:courseId/restore', authenticate, ctrl.restoreCourse);

// public reads
r.get('/', validateQuery(listCourseQuery), ctrl.listCourses);
r.get('/:courseId', ctrl.getCourse);

export default r;
