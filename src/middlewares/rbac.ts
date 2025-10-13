// src/modules/_shared/rbac.ts (helper used by controllers)
import { USER_ROLES } from '../utils/constants';
import { UserPayload } from '../types/UserPayload';

export function canManageCourse(
  user: UserPayload,
  course: { ownerType: 'school' | 'teacher'; ownerId: string }
) {
  if (user.role === USER_ROLES.SUPER_ADMIN) return true;
  if (course.ownerType === 'teacher') {
    return user.role === USER_ROLES.TEACHER && course.ownerId === user.id;
  }
  if (course.ownerType === 'school') {
    return user.role === USER_ROLES.SCHOOL && user.schoolId === course.ownerId;
  }
  return false;
}
