import { Request, Response } from 'express';
import { SchoolService } from './school.service';
import { createErrorResponse, createSuccessResponse } from '../../utils/apiResponse';

export const schoolController = {
  getSchoolTeachers: async (req: Request, res: Response) => {
    try {
      const schoolId = req.user?.id;
      const teachers = await SchoolService.getSchoolTeachers(schoolId as string);
      return res.status(200).json(createSuccessResponse(teachers, 'Fetched'));
    } catch (error: any) {
      return res.status(500).json(createErrorResponse(error.message, 'Error', 500));
    }
  },

  inviteTeacher: async (req: Request, res: Response) => {
    try {
      const { schoolId, email, message } = req.body;
      const invited = await SchoolService.inviteTeacher(schoolId as string, email, message);
      return res.status(200).json(createSuccessResponse(invited, 'Teacher Invited Successfully'));
    } catch (error: any) {
      return res.status(500).json(createErrorResponse(error.message, 'Error', 500));
    }
  },

  inviteStudent: async (req: Request, res: Response) => {
    try {
      const { schoolId, email, message } = req.body;
      const invited = await SchoolService.inviteStudent(schoolId as string, email, message);
      return res.status(200).json(createSuccessResponse(invited, 'Student Invited Successfully'));
    } catch (error: any) {
      return res.status(500).json(createErrorResponse(error.message, 'Error', 500));
    }
  },

  getStudents: async (req: Request, res: Response) => {
    try {
      const { page = '1', limit = '10' } = req.query;
      const schoolId = req.user?.id;

      const students = await SchoolService.getStudents(
        schoolId as string,
        page as string,
        limit as string
      );

      return res.status(200).json(createSuccessResponse(students, 'Students Fetched Successfully'));
    } catch (error: any) {
      return res.status(500).json(createErrorResponse(error.message, 'Error', 500));
    }
  },

  getUpcomingLessons: async (req: Request, res: Response) => {
    try {
      const { courseId } = req.query;
      const schoolId = req.user?.id;
      const upcomingLessons = await SchoolService.getUpcomingLessons(
        schoolId as string,
        courseId as string
      );
      return res
        .status(200)
        .json(createSuccessResponse(upcomingLessons, 'Upcoming Lessons Fetched Successfully'));
    } catch (error: any) {
      return res.status(500).json(createErrorResponse(error.message, 'Error', 500));
    }
  }
};
