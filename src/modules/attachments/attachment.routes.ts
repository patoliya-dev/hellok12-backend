// src/modules/attachments/attachment.routes.ts
import { Router } from 'express';
import { validateBody } from '../../middlewares/validation';
import { presignSchema, completeSchema } from './attachment.schemas';
import * as ctrl from './attachment.controller';
import { authenticate } from '../../middlewares/auth';

const r = Router();
r.post('/attachments/presign', authenticate, validateBody(presignSchema), ctrl.presign);
r.post('/attachments/complete', authenticate, validateBody(completeSchema), ctrl.complete);
r.delete('/attachments/:id', authenticate, ctrl.softDelete);
export default r;
