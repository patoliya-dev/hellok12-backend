import express from 'express';
import * as paymentsController from './payment.controller';
import * as connectedController from '../stripeAccountLink/connectedAccount.controller';
import { authenticate } from '../../middlewares/auth';

const router = express.Router();

// Auth required for user-level operations
router.post('/create-customer', authenticate, paymentsController.createCustomer);
router.get('/payment-methods', authenticate, paymentsController.listPaymentMethods);
router.post('/save-payment-method', authenticate, paymentsController.savePaymentMethod);
// set default
router.post(
  '/payment-methods/:id/set-default',
  authenticate,
  paymentsController.setDefaultPaymentMethod
);

router.post('/create-payment-intent', authenticate, paymentsController.createPaymentIntent);
router.post('/refund', authenticate, paymentsController.refund);
router.get('/transactions', authenticate, paymentsController.listTransactions);
router.get('/transactions/:id/receipt', authenticate, paymentsController.getTransactionReceipt);

// invoices
router.get('/invoices/:id', authenticate, paymentsController.getInvoice);
router.get('/invoices', authenticate, paymentsController.listInvoices);
router.get('/invoices/:id/download', authenticate, paymentsController.downloadInvoice);

// Connected account management (teachers & schools)
router.post('/create-connected-account', authenticate, connectedController.createConnectedAccount);
router.post('/generate-onboarding-link', authenticate, connectedController.generateOnboardingLink);
router.get('/account-status', authenticate, connectedController.getAccountStatus);
router.post('/update-payout-details', authenticate, connectedController.updatePayoutDetails);
router.get('/balance', authenticate, connectedController.getBalance);

// new endpoints (restrict to admin role via authenticate + isAdmin guard if you have it)
router.post('/payouts/create', authenticate, connectedController.createPayout);
router.get('/payouts/:id', authenticate, connectedController.getPayout);

export default router;
