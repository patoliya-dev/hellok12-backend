import express from 'express';
import config from '../../config/config';
import * as webhookController from './webhook.controller';
import expressRaw from 'body-parser';
// import { zoomWebhookHandler } from './zoomWebhook.controller';
const router = express.Router();
const STRIPE_WEBHOOK_SECRET = config.STRIPE_WEBHOOK_SECRET;

// Use raw body parser for signature verification
router.post('/', webhookController.handleStripeWebhook);
// router.post('/zoom', zoomWebhookHandler);

export default router;
