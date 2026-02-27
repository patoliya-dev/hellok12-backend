import { Router } from 'express';
import { validateRequest } from '../../../middlewares/validation';
import { payoutController } from './payout.controller';
import {
  cancelPayoutSchema,
  createPayoutSchema,
  listPayoutsSchema,
  markPaidSchema,
  payoutIdParamSchema,
  payoutPreviewSchema
} from './payout.schemas';

const router = Router();

router.post('/payouts/preview', validateRequest(payoutPreviewSchema), payoutController.preview);
router.post('/payouts', validateRequest(createPayoutSchema), payoutController.create);
router.get('/payouts', validateRequest(listPayoutsSchema), payoutController.list);
router.get('/payouts/:id', validateRequest(payoutIdParamSchema), payoutController.getById);
router.get(
  '/payouts/:id/download',
  validateRequest(payoutIdParamSchema),
  payoutController.download
);
router.patch(
  '/payouts/:id/approve',
  validateRequest(payoutIdParamSchema),
  payoutController.approve
);
router.patch('/payouts/:id/mark-paid', validateRequest(markPaidSchema), payoutController.markPaid);
router.patch('/payouts/:id/cancel', validateRequest(cancelPayoutSchema), payoutController.cancel);

export default router;
