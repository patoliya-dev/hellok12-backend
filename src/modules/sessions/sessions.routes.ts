import { Router } from 'express';
import { authenticate, authorize } from '../../middlewares/auth';
import { USER_ROLES } from '../../utils/constants';
import { validateBody, validateParams } from '../../middlewares/validation';
import { completeSessionSchema, sessionIdParamsSchema } from './sessions.schemas';
import * as controller from './sessions.controller';

const r = Router();

r.patch(
  '/:id/complete',
  authenticate,
  authorize([USER_ROLES.TEACHER]),
  validateParams(sessionIdParamsSchema),
  validateBody(completeSessionSchema),
  controller.completeSession
);

export default r;
