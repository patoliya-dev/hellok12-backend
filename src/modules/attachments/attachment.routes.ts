import { Router } from 'express';
import { validateBody } from '../../middlewares/validation';
import { presignSchema, completeSchema, claimSchema } from './attachment.schemas';
import * as ctrl from './attachment.controller';
import { authenticate } from '../../middlewares/auth';

const r = Router();
r.post('/presign', authenticate, validateBody(presignSchema), ctrl.presign);
r.post('/complete', authenticate, validateBody(completeSchema), ctrl.complete);
r.patch('/:id/claim', authenticate, validateBody(claimSchema), ctrl.claim);
r.delete('/:id', authenticate, ctrl.softDelete);

export default r;
