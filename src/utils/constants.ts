export const COURSE_MODE = {
  ONLINE: 'online',
  IN_PERSON: 'in-person'
} as const;

export const LESSON_TYPES = {
  ONE_ON_ONE: 'one-on-one',
  GROUP: 'group'
} as const;

export const BOOKING_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  REJECTED: 'rejected'
} as const;

export const USER_ROLES = {
  SUPER_ADMIN: 'super_admin',
  SCHOOL: 'school',
  TEACHER: 'teacher',
  PARENT: 'parent',
  STUDENT: 'student'
} as const;

// Fix: Remove 'as const' to make arrays mutable for Zod
export const AGE_GROUPS = ['3-5', '6-8', '9-12', '13-15', '16-18', '18+'];

export const DAYS_OF_WEEK = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday'
];

// Type definitions for better type safety
export type CourseMode = (typeof COURSE_MODE)[keyof typeof COURSE_MODE];
export type LessonType = (typeof LESSON_TYPES)[keyof typeof LESSON_TYPES];
export type BookingStatus = (typeof BOOKING_STATUS)[keyof typeof BOOKING_STATUS];
export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];
export type AgeGroup = (typeof AGE_GROUPS)[number];
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];
