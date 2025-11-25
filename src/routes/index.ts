import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes';
import courseRoutes from '../modules/courses/course.routes';
import lessonRoutes from '../modules/lessons/lesson.routes';
import attachmentRoutes from '../modules/attachments/attachment.routes';
import findTeacherRoutes from '../modules/find-teacher/findTeacher.routes';
import teacherSchedules from '../modules/teacherSchedule/schedule.routes';
import messageRoutes from '../modules/message/message.routes';
import feedbackRatingRoutes from '../modules/feedbacks/feedbacks.routes';
import dashboardRoutes from '../modules/dashboards/dashboards.routes';

// Future imports:
// import userRoutes from './user.routes';
// import schoolRoutes from './school.routes';
// import teacherRoutes from './teacher.routes';
// import parentRoutes from './parent.routes';

const router = Router();

// Prefix all routes with /api/v1 inside app.ts
router.use('/auth', authRoutes);
router.use('/courses', courseRoutes);
router.use('/lessons', lessonRoutes);
router.use('/attachments', attachmentRoutes);
router.use('/find-teacher', findTeacherRoutes);
router.use('/teachers', teacherSchedules);
router.use('/messages', messageRoutes);
router.use('/feedbacks', feedbackRatingRoutes);
router.use('/teachers/dashboard', dashboardRoutes);

// Future routes:
// router.use('/users', userRoutes);
// router.use('/schools', schoolRoutes);
// router.use('/teachers', teacherRoutes);
// router.use('/parents', parentRoutes);

export default router;
