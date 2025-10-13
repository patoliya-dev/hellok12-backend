import { Router } from 'express';
import authRoutes from './auth.routes';
import attachmentRoutes from '../modules/attachments/attachment.routes';
import courseRoutes from '../modules/courses/course.routes';
// Future imports:
// import userRoutes from './user.routes';
// import schoolRoutes from './school.routes';
// import teacherRoutes from './teacher.routes';
// import parentRoutes from './parent.routes';

const router = Router();

// Prefix all routes with /api/v1 inside app.ts
router.use('/auth', authRoutes);
router.use('/courses', courseRoutes);
router.use('/attachments', attachmentRoutes);

// Future routes:
// router.use('/users', userRoutes);
// router.use('/schools', schoolRoutes);
// router.use('/teachers', teacherRoutes);
// router.use('/parents', parentRoutes);

export default router;
