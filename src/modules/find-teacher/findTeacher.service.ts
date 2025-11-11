import Logger from '../../utils/winstonLogger.utils';
import { User } from '../../models/user.model';
import { findTeacherQuery, teacherDetailsQuery } from './findTeacher.queries';
import { nodeModuleNameResolver } from 'typescript';

export const FindTeacherService = {
  async list(filters: any, pagination: any) {
    try {
      const { limit = 8, offset = 0 } = pagination;

      let priceRange = {};
      if (filters.price && Array.isArray(filters.price)) {
        const [minPrice, maxPrice] = filters.price.map(Number);
        priceRange = {
          min: minPrice && Number(minPrice),
          max: maxPrice && Number(maxPrice)
        };
      }

      const pipeline = findTeacherQuery({
        filters,
        priceRange,
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
    try {
      const pipeline = teacherDetailsQuery({ teacherId });

      const teacher = await User.aggregate(pipeline);

      return {
        teacherId,
        ...teacher[0]
      };
    } catch (error) {
      Logger.error('Error in FindTeacherService.get:', error);
      throw error;
    }
  }
};
