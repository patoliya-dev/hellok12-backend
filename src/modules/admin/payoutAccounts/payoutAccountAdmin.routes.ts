import { Router } from 'express';
import { validateRequest } from '../../../middlewares/validation';
import { payoutAccountController } from '../../payoutAccounts/payoutAccount.controller';
import {
  listAdminPayoutAccountsSchema,
  payoutAccountIdParamSchema,
  rejectPayoutAccountSchema,
  verifyPayoutAccountSchema
} from '../../payoutAccounts/payoutAccount.schemas';

const router = Router();

router.get(
  '/payout-accounts',
  validateRequest(listAdminPayoutAccountsSchema),
  payoutAccountController.listAdmin
);
router.get(
  '/payout-accounts/:id',
  validateRequest(payoutAccountIdParamSchema),
  payoutAccountController.getAdminById
);
router.patch(
  '/payout-accounts/:id/verify',
  validateRequest(verifyPayoutAccountSchema),
  payoutAccountController.verifyAdmin
);
router.patch(
  '/payout-accounts/:id/reject',
  validateRequest(rejectPayoutAccountSchema),
  payoutAccountController.rejectAdmin
);

export default router;
