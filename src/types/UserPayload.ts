// src/types/UserPayload.ts
export interface UserPayload {
  userId: string;
  id: string;
  role: 'super_admin' | 'school' | 'teacher' | 'parent' | 'student';
  schoolId?: string;
}
