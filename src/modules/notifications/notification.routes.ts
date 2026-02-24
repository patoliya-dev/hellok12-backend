import { Router } from 'express';
import { authenticate, authorize } from '../../middlewares/auth';
import { validateRequest } from '../../middlewares/validation';
import { USER_ROLES } from '../../utils/constants';
import { notificationController } from './notification.controller';
import {
  listNotificationsSchema,
  notificationIdParamsSchema,
  readAllNotificationsSchema
} from './notification.schemas';

const router = Router();

router.use(authenticate);
router.use(
  authorize([
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.SCHOOL,
    USER_ROLES.TEACHER,
    USER_ROLES.PARENT,
    USER_ROLES.STUDENT
  ])
);

router.get('/', validateRequest(listNotificationsSchema), notificationController.list);
router.get('/unread-count', notificationController.unreadCount);
router.patch(
  '/read-all',
  validateRequest(readAllNotificationsSchema),
  notificationController.markAllAsRead
);
router.patch(
  '/:id/read',
  validateRequest(notificationIdParamsSchema),
  notificationController.markAsRead
);
router.delete('/:id', validateRequest(notificationIdParamsSchema), notificationController.remove);

export default router;
