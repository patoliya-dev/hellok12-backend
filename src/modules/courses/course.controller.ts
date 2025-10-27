import { Request, Response } from 'express';
import { createErrorResponse, createSuccessResponse } from '../../utils/apiResponse';
import { courseCreateSchema, courseUpdateSchema, listQuerySchema } from './course.schemas';
import { CourseService } from './course.service';
import { USER_ROLES } from '../../utils/constants';

export const createCourse = async (req: Request, res: Response) => {
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

  const course = await CourseService.create(parsed.data, owner);
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

    // const introImageRef =
    //   (parsed.data as any).introImageAttachmentId && (parsed.data as any).introImageUrl
    //     ? {
    //       attachmentId: (parsed.data as any).introImageAttachmentId,
    //       url: (parsed.data as any).introImageUrl
    //     }
    //     : undefined;

    const updated = await CourseService.update(req.params.id, parsed.data, owner);

    if (!updated) {
      return res.status(404).json(createErrorResponse('Course not found', 'Not found', 404));
    }

    return res.status(200).json(createSuccessResponse(updated, 'Course updated successfully', 200));
  } catch (error) {
    console.log('error', error);
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
  const data = await CourseService.getById(req.params.id);
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

  const result = await CourseService.list({ ...parsed.data, owner });
  return res.json(createSuccessResponse(result));
};
