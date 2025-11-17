import { Request, Response, NextFunction } from 'express';
import * as stripeService from '../../services/stripe.service';
import config from '../../config/config';
import Stripe from 'stripe';
const STRIPE_WEBHOOK_SECRET = config.STRIPE_WEBHOOK_SECRET;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-10-29.clover' });

export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers['stripe-signature'] as string | undefined;
  const buf = (req as any).rawBody || req.body; // body-parser raw middleware saved body
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(buf, sig || '', STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error('Webhook signature verification failed', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // pass to service for processing (idempotent)
    await stripeService.handleStripeEvent(event);
    return res.json({ received: true });
  } catch (err) {
    console.error('Failed to process webhook', err);
    return res.status(500).send('Webhook processing error');
  }
}
