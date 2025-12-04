interface DashboardStats {
  upcomingSessions: {
    count: number;
    thisWeek: number;
    changeFromLastWeek: number;
  };
  trialBookings: {
    count: number;
    pending: number;
    newRequests: number;
  };
  averageRating: {
    rating: number;
    totalReviews: number;
  };
  monthlyEarnings: {
    amount: number;
    currency: string;
    month: string;
    changeFromLastMonth: number;
  };
}

interface WeeklyScheduleQuery {
  studentId: string;
  startDate: Date;
  endDate: Date;
  timezone?: string;
}

interface SessionCard {
  sessionId: string;
  lessonName: string;
  teacherName: string;
  duration: number; // in minutes
  startTime: Date;
  endTime: Date;
  status: string;
}

interface DaySchedule {
  date: Date;
  dayName: string;
  sessions: SessionCard[];
  sessionCount: number;
}

interface WeeklyScheduleResponse {
  weekStart: Date;
  weekEnd: Date;
  totalSessions: number;
  days: DaySchedule[];
}

export interface UserProgressResponse {
  overallProgress: number; // percentage (0-100)
  upcomingLessons: number;
  lessonsDone: number;
  learningTimeThisWeek: number; // in hours
  totalLessons: number;
  completedLessons: number;
  enrolledCourses: number;
}

export interface CourseProgressResponse {
  courseId: string;
  courseTitle: string;
  progress: number; // percentage
  totalLessons: number;
  completedLessons: number;
  upcomingLessons: number;
  totalLearningTime: number; // in hours
  nextLesson?: {
    lessonId: string;
    title: string;
    scheduledAt: Date;
  };
}

export interface LessonProgressDetail {
  lessonId: string;
  title: string;
  status: 'completed' | 'upcoming' | 'in-progress' | 'missed';
  scheduledAt: Date;
  completedAt?: Date;
  duration: number; // in minutes
  attendance?: boolean;
}

export enum SessionStatus {
  SCHEDULED = 'SCHEDULED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  MISSED = 'MISSED'
}
