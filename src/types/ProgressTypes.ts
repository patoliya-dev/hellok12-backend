export interface AnalyticsOverview {
  overallProgress: number; // percentage (0-100)
  learningTime: number; // total hours
  score: {
    completed: number;
    total: number;
  };
  lessonsPending: number;
}

export interface MonthlyProgressPoint {
  month: string; // 'Jan', 'Feb', etc.
  lessonsCompleted: number;
  date: Date;
}

export interface AnalyticsDashboardResponse {
  overview: AnalyticsOverview;
  monthlyProgress: MonthlyProgressPoint[];
  courseBreakdown?: CourseAnalytics[];
}

export interface CourseAnalytics {
  courseId: string;
  courseTitle: string;
  progress: number;
  lessonsCompleted: number;
  totalLessons: number;
  totalLearningTime: number;
  lastActivityDate?: Date;
}

export interface TimeRangeFilter {
  startDate?: Date;
  endDate?: Date;
  period?: 'week' | 'month' | 'quarter' | 'year' | 'all';
}

export interface LearningStreakData {
  currentStreak: number; // days
  longestStreak: number; // days
  totalActiveDays: number;
}
