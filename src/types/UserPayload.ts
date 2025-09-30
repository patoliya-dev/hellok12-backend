// src/types/UserPayload.ts
export interface UserPayload {
  id: string;
  role: 'super_admin' | 'school' | 'teacher' | 'parent' | 'student';
  email?: string;
  schoolId?: string;
}
