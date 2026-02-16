import { Request, Response } from 'express';
import { SchoolService } from './manageTeachersStudents.service';
import { createErrorResponse, createSuccessResponse } from '../../utils/apiResponse';

function handle(res: Response, error: any) {
  const status = error?.statusCode || 500;
  return res.status(status).json(createErrorResponse(error.message || 'Error', 'Error', status));
}

export const teachersStudentsInvitationController = {
  getSchoolTeachers: async (req: Request, res: Response) => {
    try {
      const schoolId = req.user?.id as string;
      const teachers = await SchoolService.getSchoolTeachers(schoolId);
      return res.status(200).json(createSuccessResponse(teachers, 'Fetched'));
    } catch (e: any) {
      return handle(res, e);
    }
  },

  inviteTeacher: async (req: Request, res: Response) => {
    try {
      const inviterId = req.user?.id as string;
      const inviterRole = req.user?.role as string;
      const { email, message, schoolId } = req.body;
      const out = await SchoolService.inviteUser(
        inviterId,
        inviterRole,
        email,
        'teacher',
        message,
        schoolId
      );
      return res.status(201).json(createSuccessResponse(out, 'Teacher Invited Successfully'));
    } catch (e: any) {
      return handle(res, e);
    }
  },

  inviteStudent: async (req: Request, res: Response) => {
    try {
      const inviterId = req.user?.id as string;
      const inviterRole = req.user?.role as string;
      const { email, message } = req.body;
      const out = await SchoolService.inviteUser(inviterId, inviterRole, email, 'student', message);
      return res.status(201).json(createSuccessResponse(out, 'Student Invited Successfully'));
    } catch (e: any) {
      return handle(res, e);
    }
  },

  inviteParent: async (req: Request, res: Response) => {
    try {
      const inviterId = req.user?.id as string;
      const inviterRole = req.user?.role as string;
      const { email, message } = req.body;
      const out = await SchoolService.inviteUser(inviterId, inviterRole, email, 'parent', message);
      return res.status(201).json(createSuccessResponse(out, 'Parent Invited Successfully'));
    } catch (e: any) {
      return handle(res, e);
    }
  },

  inviteSchool: async (req: Request, res: Response) => {
    try {
      const inviterId = req.user?.id as string;
      const inviterRole = req.user?.role as string;
      const { email, message } = req.body;
      const out = await SchoolService.inviteUser(inviterId, inviterRole, email, 'school', message);
      return res.status(201).json(createSuccessResponse(out, 'Parent Invited Successfully'));
    } catch (e: any) {
      return handle(res, e);
    }
  },

  listInvitations: async (req: Request, res: Response) => {
    try {
      const inviterId = req.user?.id as string;
      const inviterRole = req.user?.role as string;

      const {
        role = '',
        status = '',
        search = '',
        page = '1',
        limit = '10',
        teacherType = ''
      } = req.query;

      const out = await SchoolService.listInvitationsV2({
        inviterId,
        inviterRole,
        role: String(role || ''),
        status: String(status || ''),
        search: String(search || ''),
        page: String(page || '1'),
        limit: String(limit || '10'),
        teacherType: String(teacherType || '') as any
      });

      return res.status(200).json(createSuccessResponse(out, 'Invitations Fetched Successfully'));
    } catch (e: any) {
      return handle(res, e);
    }
  },

  cancelInvitation: async (req: Request, res: Response) => {
    try {
      const schoolId = req.user?.id as string;
      const out = await SchoolService.cancelInvitation(schoolId, req.params.invitationId);
      return res.status(200).json(createSuccessResponse(out, 'Invitation Cancelled'));
    } catch (e: any) {
      return handle(res, e);
    }
  },

  approveRejectTeacher: async (req: Request, res: Response) => {
    try {
      const schoolId = req.user?.id as string;
      const teacherId = req.params.teacherId;
      const { action } = req.body; // APPROVE | REJECT
      const out = await SchoolService.approveRejectTeacher(schoolId, teacherId, action);
      return res.status(200).json(createSuccessResponse(out, 'Teacher status updated'));
    } catch (e: any) {
      return handle(res, e);
    }
  },

  getStudents: async (req: Request, res: Response) => {
    try {
      const {
        page = '1',
        limit = '10',
        search = '',
        status = '',
        school = '',
        language = '',
        ageRange = ''
      } = req.query as any;

      const inviterId = req.user?.id as string;
      const inviterRole = req.user?.role as string;

      const out = await SchoolService.getStudents({
        inviterId,
        inviterRole,
        page: String(page),
        limit: String(limit),
        search: String(search || ''),
        status: String(status || ''),
        school: String(school || ''),
        language: String(language || ''),
        ageRange: String(ageRange || '')
      });

      return res.status(200).json(createSuccessResponse(out, 'Students Fetched Successfully'));
    } catch (e: any) {
      return handle(res, e);
    }
  },

  getUpcomingLessons: async (req: Request, res: Response) => {
    try {
      const { courseId } = req.query;
      const schoolId = req.user?.id as string;
      const out = await SchoolService.getUpcomingLessons(schoolId, courseId as string);
      return res
        .status(200)
        .json(createSuccessResponse(out, 'Upcoming Lessons Fetched Successfully'));
    } catch (e: any) {
      return handle(res, e);
    }
  }
};
