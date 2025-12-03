// types/lesson.types.ts

export enum SessionStatus {
  SCHEDULED = 'scheduled',
  STARTED = 'started',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  NO_SHOW = 'no_show'
}

export enum LessonViewType {
  UPCOMING = 'upcoming',
  HISTORY = 'history'
}

export interface LessonListQuery {
  studentId: string;
  courseId?: string;
  view?: LessonViewType;
  page?: number;
  limit?: number;
}

export interface TeacherInfo {
  _id: string;
  name: string;
  profileImage?: string;
  rating?: { averageRating: number; totalRatings: number };
}

export interface CourseInfo {
  _id: string;
  title: string;
  lessonType: '1-on-1' | 'group';
  mode: 'online' | 'in-person';
}

export interface LessonItem {
  sessionId: string;
  lessonTitle: string;
  courseTitle: string;
  teacher: TeacherInfo;
  startTime: Date;
  endTime: Date;
  duration: number; // in minutes
  status: SessionStatus;
  lessonType: '1-on-1' | 'group';
  courseMode: 'online' | 'in-person';
  isTrialLesson: boolean;
  tags?: string[]; // e.g., ['Trial Lessons', 'Curriculum-Aligned Games']
  timeUntilStart?: string; // e.g., "1h 56m" - only for upcoming
  meetingUrl?: string;
  description: string;
}

export interface LessonListResponse {
  success: boolean;
  data: {
    lessons: LessonItem[];
    pagination: {
      currentPage: number;
      totalPages: number;
      totalItems: number;
      itemsPerPage: number;
    };
    view: LessonViewType;
  };
}

export interface CourseOption {
  _id: string;
  title: string;
  lessonCount: number;
}

export interface CoursesListResponse {
  success: boolean;
  data: {
    courses: CourseOption[];
  };
}
