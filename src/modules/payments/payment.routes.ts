import express from 'express';
import * as paymentsController from './payment.controller';
import { authenticate } from '../../middlewares/auth';

const router = express.Router();

// Auth required for user-level operations
router.post('/create-customer', authenticate, paymentsController.createCustomer);
router.get('/payment-methods', authenticate, paymentsController.listPaymentMethods);
router.post('/save-payment-method', authenticate, paymentsController.savePaymentMethod); // SetupIntent flow
router.post('/create-payment-intent', authenticate, paymentsController.createPaymentIntent);
router.post('/refund', authenticate, paymentsController.refund);
router.get('/invoices/:id', authenticate, paymentsController.getInvoice);

export default router;
