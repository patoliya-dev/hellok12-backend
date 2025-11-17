import { Request, Response, NextFunction } from 'express';
import * as stripeService from '../../services/stripe.service';
import { z } from 'zod';

// create customer or return existing
export async function createCustomer(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).send({ error: 'Unauthorized' });

    const user = await stripeService.createOrGetCustomerForUser(userId, req.body);
    res.json({ success: true, customer: user });
  } catch (err) {
    next(err);
  }
}

export async function listPaymentMethods(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    const methods = await stripeService.listPaymentMethodsForUser(userId);
    res.json({ success: true, data: methods });
  } catch (err) {
    next(err);
  }
}

// Save payment method using SetupIntent -> return client_secret for FE to confirm
export async function savePaymentMethod(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    const result = await stripeService.createSetupIntentForUser(userId);
    res.json({ success: true, client_secret: result.client_secret });
  } catch (err) {
    next(err);
  }
}

export async function createPaymentIntent(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    const bodySchema = z.object({
      amount: z.number(), // dollars or cents? we'll expect cents integer
      currency: z.string().optional().default('usd'),
      bookingId: z.string().optional(),
      teacherId: z.string().optional(),
      paymentMethodId: z.string().optional(), // optional, if paying with saved card
      savePaymentMethod: z.boolean().optional().default(false),
      idempotencyKey: z.string().optional(),
      metadata: z.record(z.string(), z.string()).optional()
    });
    const payload = bodySchema.parse(req.body);
    // amount must be in cents
    if (!payload.amount || payload.amount <= 0) throw new Error('Invalid amount');

    const pi = await stripeService.createPaymentIntent({
      userId,
      amountCents: payload.amount,
      currency: payload.currency,
      bookingId: payload.bookingId,
      teacherId: payload.teacherId,
      paymentMethodId: payload.paymentMethodId,
      savePaymentMethod: payload.savePaymentMethod,
      idempotencyKey: payload.idempotencyKey,
      metadata: payload.metadata
    });

    res.json({ success: true, client_secret: pi.client_secret, paymentIntentId: pi.id });
  } catch (err) {
    next(err);
  }
}

export async function refund(req: Request, res: Response, next: NextFunction) {
  try {
    const { transactionId, amount } = req.body;
    if (!transactionId) return res.status(400).send({ error: 'transactionId required' });
    const refund = await stripeService.createRefund(transactionId, amount);
    res.json({ success: true, refund });
  } catch (err) {
    next(err);
  }
}

export async function getInvoice(req: Request, res: Response, next: NextFunction) {
  try {
    const invoiceId = req.params.id;
    const invoice = await stripeService.getInvoice(invoiceId);
    res.json({ success: true, invoice });
  } catch (err) {
    next(err);
  }
}
