import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes';
import adminRoutes from '../modules/admin/admin.routes';
import userRoutes from '../modules/user/user.routes';
import courseRoutes from '../modules/courses/course.routes';
import lessonRoutes from '../modules/lessons/lesson.routes';
import attachmentRoutes from '../modules/attachments/attachment.routes';
import findTeacherRoutes from '../modules/findTeacher/findTeacher.routes';
import teacherSchedulesRoutes from '../modules/teacherSchedule/schedule.routes';
import paymentsRoutes from '../modules/payments/payment.routes';
import bookingsRoutes from '../modules/bookings/booking.routes';
import webhookRoutes from '../modules/webhook/webhook.routes';
import messageRoutes from '../modules/message/message.routes';
import feedbackRatingRoutes from '../modules/feedbacks/feedbacks.routes';
import dashboardRoutes from '../modules/dashboards/dashboards.routes';
import earningsRoutes from '../modules/earnings/earnings.routes';
import progressRoutes from '../modules/progress/progress.routes';
import manageTeachersStudentsRoutes from '../modules/school/manageTeachersStudents.routes';
import invitationRoutes from '../modules/invitations/invitation.routes';
import notificationRoutes from '../modules/notifications/notification.routes';

const router = Router();

// Prefix all routes with /api/v1 inside app.ts
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/user', userRoutes);
router.use('/courses', courseRoutes);
router.use('/lessons', lessonRoutes);
router.use('/attachments', attachmentRoutes);
router.use('/find-teacher', findTeacherRoutes);
router.use('/teachers', teacherSchedulesRoutes);
router.use('/payments', paymentsRoutes);
router.use('/bookings', bookingsRoutes);
router.use('/webhook', webhookRoutes);
router.use('/messages', messageRoutes);
router.use('/feedbacks', feedbackRatingRoutes);
router.use('/teachers/dashboard', dashboardRoutes);
router.use('/students/dashboard', dashboardRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/earnings', earningsRoutes);
router.use('/progress', progressRoutes);
router.use('/school', manageTeachersStudentsRoutes);
router.use('/invitations', invitationRoutes);
router.use('/notifications', notificationRoutes);

export default router;
