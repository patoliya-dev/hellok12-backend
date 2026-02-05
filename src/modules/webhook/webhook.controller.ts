import { Request, Response } from 'express';
import * as stripeService from '../../services/stripe.service';
import config from '../../config/config';
import Stripe from 'stripe';

const STRIPE_WEBHOOK_SECRET =
  config.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || '';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: config.STRIPE_API_VERSION || '2022-11-15'
} as Stripe.StripeConfig);

export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers['stripe-signature'] as string | undefined;

  if (!sig) {
    console.error('Missing stripe-signature header');
    return res.status(400).send('Missing stripe-signature header');
  }

  // Prefer the raw buffer captured by express.json({ verify })
  const rawBody = (req as any).rawBody as Buffer | undefined;

  if (!rawBody) {
    console.error(
      'No raw body found on req.rawBody. Ensure express.json({ verify }) is configured BEFORE routes.'
    );
    return res.status(400).send('No raw body available for webhook signature verification');
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error('Webhook signature verification failed', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await stripeService.handleStripeEvent(event);
    return res.json({ received: true });
  } catch (err) {
    console.error('Failed to process webhook', err);
    return res.status(500).send('Webhook processing error');
  }
}
