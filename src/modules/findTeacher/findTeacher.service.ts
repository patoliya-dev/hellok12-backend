import Logger from '../../utils/winstonLogger.utils';
import { User } from '../../models/user.model';
import { findTeacherQuery, teacherDetailsQuery } from './findTeacher.queries';

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
  },

  async listSchools() {
    try {
      const schools = await User.aggregate([
        {
          $match: {
            role: 'teacher',
            school: { $exists: true, $ne: null }
          }
        },
        {
          $group: {
            _id: '$school'
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'school'
          }
        },
        {
          $unwind: '$school'
        },
        {
          $match: {
            'school.role': 'school'
          }
        },
        {
          $project: {
            _id: '$school._id',
            name: '$school.name'
          }
        },
        {
          $sort: {
            name: 1
          }
        }
      ]);

      return schools;
    } catch (error) {
      Logger.error('Error in FindTeacherService.listSchools:', error);
      throw error;
    }
  }
};
