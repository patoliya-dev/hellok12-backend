import express from 'express';
import * as paymentsController from './payment.controller';
import { authenticate } from '../../middlewares/auth';

const router = express.Router();

// Auth required for user-level operations
router.post('/create-customer', authenticate, paymentsController.createCustomer);
router.get('/payment-methods', authenticate, paymentsController.listPaymentMethods);
router.post('/save-payment-method', authenticate, paymentsController.savePaymentMethod); // SetupIntent flow OR raw card -> create PM
// new: attach persisted payment method after FE confirms SetupIntent or provided paymentMethodId
router.post('/payment-methods/attach', authenticate, paymentsController.attachPaymentMethod);
// set default
router.post(
  '/payment-methods/:id/set-default',
  authenticate,
  paymentsController.setDefaultPaymentMethod
);

router.post('/create-payment-intent', authenticate, paymentsController.createPaymentIntent);
router.post('/refund', authenticate, paymentsController.refund);
router.get('/transactions', authenticate, paymentsController.listTransactions);

// invoices
router.get('/invoices/:id', authenticate, paymentsController.getInvoice);
router.get('/invoices', authenticate, paymentsController.listInvoices);

export default router;
