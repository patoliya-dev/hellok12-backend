// services/progress.service.ts

import { Types } from 'mongoose';
import { Course } from '../../models/course.model';
import { Lesson } from '../../models/lesson.model';
import { SessionModel } from '../../models/sessions.model';
import {
  UserProgressResponse,
  CourseProgressResponse,
  LessonProgressDetail,
  SessionStatus
} from '../../types/DashboardTypes';
import {
  AnalyticsDashboardResponse,
  AnalyticsOverview,
  CourseAnalytics,
  LearningStreakData,
  MonthlyProgressPoint,
  TimeRangeFilter
} from '../../types/ProgressTypes';

export const ProgressService = {
  async getUserProgress(userId: string): Promise<UserProgressResponse> {
    const userObjectId = new Types.ObjectId(userId);
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay()); // Start of current week
    weekStart.setHours(0, 0, 0, 0);

    // Find all sessions where user is a student
    const allSessions = await SessionModel.find({
      students: userObjectId
    }).populate('lesson');

    const completedSessions = allSessions.filter(
      (session: any) => session.status === SessionStatus.COMPLETED && session.end < now
    );

    const upcomingSessions = allSessions.filter(
      (session: any) =>
        (session.status === SessionStatus.SCHEDULED ||
          session.status === SessionStatus.IN_PROGRESS) &&
        session.start >= now
    );

    const weekSessions = completedSessions.filter(
      session => session.end >= weekStart && session.end <= now
    );

    const learningTimeMinutes = weekSessions.reduce((total, session) => {
      const duration = (session.end.getTime() - session.start.getTime()) / (1000 * 60);
      return total + duration;
    }, 0);

    const learningTimeHours = learningTimeMinutes / 60;

    // Get enrolled courses
    const enrolledCourseIds = [...new Set(allSessions.map(s => s.course.toString()))];
    const enrolledCourses = enrolledCourseIds.length;

    // Calculate overall progress
    const totalLessons = allSessions.length;
    const completedLessons = completedSessions.length;
    const overallProgress =
      totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

    return {
      overallProgress,
      upcomingLessons: upcomingSessions.length,
      lessonsDone: completedLessons,
      learningTimeThisWeek: Math.round(learningTimeHours * 10) / 10, // Round to 1 decimal
      totalLessons,
      completedLessons,
      enrolledCourses
    };
  },

  async getCourseProgress(userId: string, courseId: string): Promise<CourseProgressResponse> {
    const userObjectId = new Types.ObjectId(userId);
    const courseObjectId = new Types.ObjectId(courseId);
    const now = new Date();

    // Get course details
    const course = await Course.findById(courseObjectId);
    if (!course) {
      throw new Error('Course not found');
    }

    // Get all sessions for this course and user
    const sessions = await SessionModel.find({
      course: courseObjectId,
      students: userObjectId
    })
      .populate('lesson')
      .sort({ start: 1 });

    // Calculate completed lessons
    const completedSessions = sessions.filter(
      (session: any) => session.status === SessionStatus.COMPLETED && session.end < now
    );

    // Calculate upcoming lessons
    const upcomingSessions = sessions.filter(
      (session: any) =>
        (session.status === SessionStatus.SCHEDULED ||
          session.status === SessionStatus.IN_PROGRESS) &&
        session.start >= now
    );

    // Calculate total learning time
    const totalLearningMinutes = completedSessions.reduce((total, session) => {
      const duration = (session.end.getTime() - session.start.getTime()) / (1000 * 60);
      return total + duration;
    }, 0);

    const totalLearningHours = totalLearningMinutes / 60;

    // Calculate progress
    const totalLessons = sessions.length;
    const completedLessons = completedSessions.length;
    const progress = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

    // Find next lesson
    const nextSession: any = upcomingSessions[0];
    const nextLesson = nextSession
      ? {
          lessonId: nextSession.lesson._id.toString(),
          title: nextSession.lesson.title,
          scheduledAt: nextSession.start
        }
      : undefined;

    return {
      courseId: courseId,
      courseTitle: course.title,
      progress,
      totalLessons,
      completedLessons,
      upcomingLessons: upcomingSessions.length,
      totalLearningTime: Math.round(totalLearningHours * 10) / 10,
      nextLesson
    };
  },

  async getCourseLessonDetails(userId: string, courseId: string): Promise<LessonProgressDetail[]> {
    const userObjectId = new Types.ObjectId(userId);
    const courseObjectId = new Types.ObjectId(courseId);
    const now = new Date();

    // Get all sessions for this course and user
    const sessions = await SessionModel.find({
      course: courseObjectId,
      students: userObjectId
    })
      .populate('lesson')
      .sort({ start: 1 });

    // Map sessions to lesson progress details
    const lessonDetails: LessonProgressDetail[] = sessions.map((session: any) => {
      let status: LessonProgressDetail['status'];

      if (session.status === SessionStatus.COMPLETED) {
        status = 'completed';
      } else if (session.status === SessionStatus.MISSED) {
        status = 'missed';
      } else if (session.status === SessionStatus.IN_PROGRESS) {
        status = 'in-progress';
      } else if (session.start > now) {
        status = 'upcoming';
      } else {
        status = 'missed'; // Past scheduled time but not completed
      }

      const duration = Math.round((session.end.getTime() - session.start.getTime()) / (1000 * 60));

      return {
        lessonId: session.lesson._id.toString(),
        title: session.lesson.title,
        status,
        scheduledAt: session.start,
        completedAt: session.status === SessionStatus.COMPLETED ? session.end : undefined,
        duration,
        attendance: session.students.some((s: any) => s.toString() === userId)
      };
    });

    return lessonDetails;
  },

  async getMultipleCourseProgress(
    userId: string,
    courseIds: string[]
  ): Promise<CourseProgressResponse[]> {
    const progressPromises = courseIds.map(courseId => this.getCourseProgress(userId, courseId));

    return Promise.all(progressPromises);
  },

  async getWeeklyStats(userId: string) {
    const userObjectId = new Types.ObjectId(userId);
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    // Get completed sessions for the week
    const weekSessions = await SessionModel.find({
      students: userObjectId,
      status: SessionStatus.COMPLETED,
      end: { $gte: weekStart, $lte: now }
    }).populate('lesson course');

    // Group by day
    const dailyStats = Array(7).fill(0);

    weekSessions.forEach(session => {
      const dayIndex = session.end.getDay();
      const duration = (session.end.getTime() - session.start.getTime()) / (1000 * 60 * 60);
      dailyStats[dayIndex] += duration;
    });

    return {
      dailyLearningHours: dailyStats,
      totalSessions: weekSessions.length,
      totalHours: dailyStats.reduce((sum, hours) => sum + hours, 0)
    };
  },

  async getAnalyticsDashboard(
    userId: string,
    filter?: TimeRangeFilter,
    courseId?: string
  ): Promise<AnalyticsDashboardResponse> {
    const userObjectId = new Types.ObjectId(userId);
    const courseObjectId = courseId ? new Types.ObjectId(courseId) : undefined;

    // Get date range
    const { startDate, endDate } = this.getDateRange(filter);

    // Fetch overview and monthly progress in parallel
    const [overview, monthlyProgress, courseBreakdown] = await Promise.all([
      this.getOverview(userObjectId, startDate, endDate, courseObjectId),
      this.getMonthlyProgress(userObjectId, startDate, endDate, courseObjectId),
      this.getCourseBreakdown(userObjectId, startDate, endDate)
    ]);

    return {
      overview,
      monthlyProgress,
      courseBreakdown
    };
  },

  async getOverview(
    userId: Types.ObjectId,
    startDate?: Date,
    endDate?: Date,
    courseId?: Types.ObjectId
  ): Promise<AnalyticsOverview> {
    const now = new Date();

    // Build query filter
    const query: any = { students: userId };

    // Filter by course if provided
    if (courseId) {
      query.course = courseId;
    }

    if (startDate || endDate) {
      query.start = {};
      if (startDate) query.start.$gte = startDate;
      if (endDate) query.start.$lte = endDate;
    }

    // Get all sessions for the user
    const allSessions = await SessionModel.find(query);

    // Calculate completed lessons
    const completedSessions = allSessions.filter(
      session => session.status === SessionStatus.COMPLETED && session.end < now
    );

    // Calculate pending lessons (scheduled in future)
    const pendingSessions = allSessions.filter(
      session =>
        (session.status === SessionStatus.SCHEDULED ||
          session.status === SessionStatus.IN_PROGRESS) &&
        session.start >= now
    );

    // Calculate total learning time (in hours)
    const totalLearningMinutes = completedSessions.reduce((total, session) => {
      const duration = (session.end.getTime() - session.start.getTime()) / (1000 * 60);
      return total + duration;
    }, 0);

    const totalLearningHours = Math.round((totalLearningMinutes / 60) * 10) / 10;

    // Calculate overall progress
    const totalLessons = allSessions.length;
    const lessonsCompleted = completedSessions.length;
    const overallProgress =
      totalLessons > 0 ? Math.round((lessonsCompleted / totalLessons) * 100) : 0;

    return {
      overallProgress,
      learningTime: totalLearningHours,
      score: {
        completed: lessonsCompleted,
        total: totalLessons
      },
      lessonsPending: pendingSessions.length
    };
  },

  async getMonthlyProgress(
    userId: Types.ObjectId,
    startDate?: Date,
    endDate?: Date,
    courseId?: Types.ObjectId
  ): Promise<MonthlyProgressPoint[]> {
    // Default to last 12 months if no date range specified
    const end = endDate || new Date();
    const start = startDate || new Date(end.getFullYear(), end.getMonth() - 11, 1);

    // Build query filter
    const query: any = {
      students: userId,
      status: SessionStatus.COMPLETED,
      end: { $gte: start, $lte: end }
    };

    // Filter by course if provided
    if (courseId) {
      query.course = courseId;
    }

    // Get all completed sessions in date range
    const sessions = await SessionModel.find(query).sort({ end: 1 });

    // Group sessions by month
    const monthlyData = new Map<string, number>();

    // Initialize all months in range with 0
    const currentDate = new Date(start);
    while (currentDate <= end) {
      const monthKey = this.getMonthKey(currentDate);
      monthlyData.set(monthKey, 0);
      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    // Count completed lessons per month
    sessions.forEach(session => {
      const monthKey = this.getMonthKey(session.end);
      const count = monthlyData.get(monthKey) || 0;
      monthlyData.set(monthKey, count + 1);
    });

    // Convert to array format
    const monthlyProgress: MonthlyProgressPoint[] = [];
    monthlyData.forEach((lessonsCompleted, monthKey) => {
      const [year, month] = monthKey.split('-').map(Number);
      const date = new Date(year, month, 1);

      monthlyProgress.push({
        month: this.getMonthLabel(month),
        lessonsCompleted,
        date
      });
    });

    return monthlyProgress.sort((a, b) => a.date.getTime() - b.date.getTime());
  },

  async getCourseBreakdown(
    userId: Types.ObjectId,
    startDate?: Date,
    endDate?: Date
  ): Promise<CourseAnalytics[]> {
    // Build query filter
    const query: any = { students: userId };
    if (startDate || endDate) {
      query.start = {};
      if (startDate) query.start.$gte = startDate;
      if (endDate) query.start.$lte = endDate;
    }

    const sessions = await SessionModel.find(query).populate('course');

    // Group sessions by course
    const courseMap = new Map<string, any[]>();
    sessions.forEach(session => {
      const courseId = session.course._id.toString();
      if (!courseMap.has(courseId)) {
        courseMap.set(courseId, []);
      }
      courseMap.get(courseId)!.push(session);
    });

    // Calculate analytics for each course
    const courseAnalytics: CourseAnalytics[] = [];
    const now = new Date();

    for (const [courseId, courseSessions] of courseMap.entries()) {
      const course = courseSessions[0].course;

      const completedSessions = courseSessions.filter(
        s => s.status === SessionStatus.COMPLETED && s.end < now
      );

      const totalLearningMinutes = completedSessions.reduce((total, session) => {
        const duration = (session.end.getTime() - session.start.getTime()) / (1000 * 60);
        return total + duration;
      }, 0);

      const progress =
        courseSessions.length > 0
          ? Math.round((completedSessions.length / courseSessions.length) * 100)
          : 0;

      // Find last activity date
      const lastActivity = completedSessions.reduce(
        (latest, session) => {
          return !latest || session.end > latest ? session.end : latest;
        },
        null as Date | null
      );

      courseAnalytics.push({
        courseId,
        courseTitle: course.title,
        progress,
        lessonsCompleted: completedSessions.length,
        totalLessons: courseSessions.length,
        totalLearningTime: Math.round((totalLearningMinutes / 60) * 10) / 10,
        lastActivityDate: lastActivity || undefined
      });
    }

    // Sort by progress (descending)
    return courseAnalytics.sort((a, b) => b.progress - a.progress);
  },

  async getLearningStreak(userId: string): Promise<LearningStreakData> {
    const userObjectId = new Types.ObjectId(userId);

    // Get all completed sessions sorted by date
    const sessions = await SessionModel.find({
      students: userObjectId,
      status: SessionStatus.COMPLETED
    }).sort({ end: 1 });

    if (sessions.length === 0) {
      return {
        currentStreak: 0,
        longestStreak: 0,
        totalActiveDays: 0
      };
    }

    // Get unique dates of activity
    const activeDates = new Set<string>();
    sessions.forEach(session => {
      const dateStr = session.end.toISOString().split('T')[0];
      activeDates.add(dateStr);
    });

    const sortedDates = Array.from(activeDates).sort();
    const totalActiveDays = sortedDates.length;

    // Calculate current streak
    let currentStreak = 0;
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // Check if user was active today or yesterday
    if (sortedDates.includes(today) || sortedDates.includes(yesterday)) {
      let checkDate = sortedDates.includes(today) ? today : yesterday;
      currentStreak = 1;

      for (let i = sortedDates.length - 2; i >= 0; i--) {
        const prevDate = new Date(sortedDates[i]);
        const currDate = new Date(checkDate);
        const diffDays = Math.floor(
          (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (diffDays === 1) {
          currentStreak++;
          checkDate = sortedDates[i];
        } else {
          break;
        }
      }
    }

    // Calculate longest streak
    let longestStreak = 1;
    let tempStreak = 1;

    for (let i = 1; i < sortedDates.length; i++) {
      const prevDate = new Date(sortedDates[i - 1]);
      const currDate = new Date(sortedDates[i]);
      const diffDays = Math.floor(
        (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (diffDays === 1) {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        tempStreak = 1;
      }
    }

    return {
      currentStreak,
      longestStreak,
      totalActiveDays
    };
  },

  getDateRange(filter?: TimeRangeFilter): {
    startDate?: Date;
    endDate?: Date;
  } {
    if (!filter) {
      return {};
    }

    if (filter.startDate && filter.endDate) {
      return {
        startDate: filter.startDate,
        endDate: filter.endDate
      };
    }

    const now = new Date();
    let startDate: Date;

    switch (filter.period) {
      case 'week':
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        break;
      case 'quarter':
        startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
        break;
      case 'year':
        startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        break;
      default:
        return {};
    }

    return { startDate, endDate: now };
  },

  getMonthKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth()}`;
  },

  getMonthLabel(month: number): string {
    const labels = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec'
    ];
    return labels[month];
  }
};
