// src/modules/attachments/attachment.routes.ts
import { Router } from 'express';
import { validateBody } from '../../middlewares/validation';
import { presignSchema, completeSchema, updateSchema } from './attachment.schemas';
import * as ctrl from './attachment.controller';
import { authenticate } from '../../middlewares/auth';

const r = Router();
r.post('/presign', authenticate, validateBody(presignSchema), ctrl.presign);
r.post('/complete', authenticate, validateBody(completeSchema), ctrl.complete);
r.delete('/:id', authenticate, ctrl.softDelete);
r.patch('/update', authenticate, validateBody(updateSchema), ctrl.updateAttachment);

export default r;
