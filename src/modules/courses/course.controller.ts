// src/modules/courses/course.controller.ts
import { Request, Response } from 'express';
import { CourseRepo } from './course.service';
import { AttachmentModel } from '../../models/attachment.model';
import { createSuccessResponse, createErrorResponse } from '../../utils/apiResponse';
import { USER_ROLES } from '../../utils/constants';
import { canManageCourse } from '../../middlewares/rbac';

export const createCourse = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const ownerId = user.id;
    if (!ownerId) {
      return res.status(403).json(createErrorResponse('Forbidden', 'Forbidden', 403));
    }

    const payload = {
      ...req.body,
      ownerId
    };

    if (req.body.introImageAttachmentId) {
      // resolve intro image
      const att = await AttachmentModel.findById(req.body.introImageAttachmentId).lean();
      if (!att || att.status !== 'READY' || !String(att.mime).startsWith('image/')) {
        return res
          .status(422)
          .json(createErrorResponse('Invalid intro image', 'Invalid intro image', 422));
      }
      payload.introImage = { attachmentId: String(att._id), url: att.url };
      delete (payload as any).introImageAttachmentId;
    }

    const created = await CourseRepo.createCourse(payload);
    return res.status(201).json(createSuccessResponse(created, 'Created', 201));
  } catch (e) {
    console.log('e', e);
    return res.status(500).json(createErrorResponse('Create failed', 'Internal Server Error', 500));
  }
};

export const getCourse = async (req: Request, res: Response) => {
  const course = await CourseRepo.getCourseById(req.params.courseId);
  if (!course) return res.status(404).json(createErrorResponse('Not found', 'Not found', 404));
  return res.json(createSuccessResponse(course));
};

export const listCourses = async (req: Request, res: Response) => {
  const list = await CourseRepo.listCourses(req.query);
  if (typeof req.query.trialAvailable !== 'undefined') {
    const want = String(req.query.trialAvailable) === 'true';
    const filtered: any[] = [];
    // NOTE: Simple per-course check; optimize later with aggregation if needed.
    for (const c of list.items as any[]) {
      const hasTrial = await CourseRepo.anyLessonHasTrial(String(c._id));
      if ((want && hasTrial) || (!want && !hasTrial)) filtered.push(c);
    }
    return res.json(createSuccessResponse({ ...list, total: filtered.length, items: filtered }));
  }
  return res.json(createSuccessResponse(list));
};

export const updateCourse = async (req: Request, res: Response) => {
  const course = await CourseRepo.getCourseById(req.params.courseId);
  if (!course) return res.status(404).json(createErrorResponse('Not found', 'Not found', 404));
  if (!canManageCourse(req.user!, course as any)) {
    return res.status(403).json(createErrorResponse('Forbidden', 'Forbidden', 403));
  }

  const { introImageAttachmentId, ownerType, ownerId, schoolId, ...patch } = req.body || {};

  if (introImageAttachmentId) {
    const att = await AttachmentModel.findById(introImageAttachmentId).lean();
    if (!att || att.status !== 'READY' || !String(att.mime).startsWith('image/')) {
      return res
        .status(422)
        .json(createErrorResponse('Invalid intro image', 'Invalid intro image', 422));
    }
    (patch as any).introImage = { attachmentId: String(att._id), url: att.url };
  }

  const updated = await CourseRepo.updateCourse(String((course as any)._id), {
    ...patch,
    updatedAt: new Date()
  });
  if (!updated)
    return res.status(500).json(createErrorResponse('Update failed', 'Internal Server Error', 500));
  return res.json(createSuccessResponse(updated, 'Updated'));
};

export const publishCourse = async (req: Request, res: Response) => togglePub(req, res, true);
export const unpublishCourse = async (req: Request, res: Response) => togglePub(req, res, false);

async function togglePub(req: Request, res: Response, published: boolean) {
  const course = await CourseRepo.getCourseById(req.params.courseId);
  if (!course) return res.status(404).json(createErrorResponse('Not found', 'Not found', 404));
  if (!canManageCourse(req.user!, course as any)) {
    return res.status(403).json(createErrorResponse('Forbidden', 'Forbidden', 403));
  }
  const updated = await CourseRepo.setCoursePublished(String((course as any)._id), published);
  if (!updated)
    return res.status(500).json(createErrorResponse('Update failed', 'Internal Server Error', 500));
  return res.json(createSuccessResponse(updated, published ? 'Published' : 'Unpublished'));
}

export const archiveCourse = async (req: Request, res: Response) => {
  const course = await CourseRepo.getCourseById(req.params.courseId);
  if (!course) return res.status(404).json(createErrorResponse('Not found', 'Not found', 404));
  if (!canManageCourse(req.user!, course as any)) {
    return res.status(403).json(createErrorResponse('Forbidden', 'Forbidden', 403));
  }
  const updated = await CourseRepo.setCourseArchived(String((course as any)._id), true);
  if (!updated)
    return res.status(500).json(createErrorResponse('Update failed', 'Internal Server Error', 500));
  return res.json(createSuccessResponse(updated, 'Archived'));
};

export const restoreCourse = async (req: Request, res: Response) => {
  const course = await CourseRepo.getCourseById(req.params.courseId);
  if (!course) return res.status(404).json(createErrorResponse('Not found', 'Not found', 404));
  if (!canManageCourse(req.user!, course as any)) {
    return res.status(403).json(createErrorResponse('Forbidden', 'Forbidden', 403));
  }
  const updated = await CourseRepo.setCourseArchived(String((course as any)._id), false);
  if (!updated)
    return res.status(500).json(createErrorResponse('Update failed', 'Internal Server Error', 500));
  return res.json(createSuccessResponse(updated, 'Restored'));
};
