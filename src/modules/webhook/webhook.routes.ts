import express from 'express';
import config from '../../config/config';
import * as webhookController from './webhook.controller';
import expressRaw from 'body-parser';
const router = express.Router();
const STRIPE_WEBHOOK_SECRET = config.STRIPE_WEBHOOK_SECRET;

// Use raw body parser for signature verification
router.post(
  '/',
  expressRaw.raw({ type: 'application/json' }),
  webhookController.handleStripeWebhook
);

export default router;
