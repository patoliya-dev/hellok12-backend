import Logger from '../../utils/winstonLogger.utils';
import { buildTeacherQuery } from './findTeacher.helper';
import { User } from '../../models/user.model';
import { findTeacherQuery } from './findTeacher.queries';

export const FindTeacherService = {
  async list(filters: any, pagination: any) {
    try {
      const { limit = 8, offset = 0 } = pagination;

      const filtersQuery = buildTeacherQuery(filters);

      const pipeline = findTeacherQuery({
        filters,
        teacherQuery: filtersQuery,
        offset,
        limit
      });

      const teachers = await User.aggregate(pipeline);

      return {
        count: teachers.length,
        data: teachers,
        nextOffset: offset + limit
      };
    } catch (error) {
      Logger.error('Error in FindTeacherService.list:', error);
      throw error;
    }
  },

  async get(teacherId: string) {
    return {
      teacherId
    };
  }
};
