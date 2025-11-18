import { Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';

import PaymentMethodModel from '../../models/paymentMethod.model';
import TransactionModel from '../../models/transaction.model';
import InvoiceModel from '../../models/invoice.model';
import * as stripeService from '../../services/stripe.service';
import config from '../../config/config';

const { STRIPE_SECRET_KEY } = config;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2022-11-15'
} as unknown as Stripe.StripeConfig);

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
    if (!userId) return res.status(401).send({ error: 'Unauthorized' });

    const { card } = req.body;

    // If raw card data (temporary flow) -> create paymentMethod server-side and attach
    if (card && card.number) {
      // minimal: create Stripe payment method
      const pm = await stripe.paymentMethods.create({
        type: 'card',
        card: {
          number: card.cardNumber.replace(/\s+/g, ''),
          exp_month: parseInt(card.expiryDate.split('/')[0], 10),
          exp_year: 2000 + parseInt(card.expiryDate.split('/')[1], 10),
          cvc: card.cvv
        },
        billing_details: {
          name: card.cardholderName
        }
      });

      // attach and persist
      const attached = await stripeService.attachPaymentMethodToUser(userId, pm.id);

      return res.json({ success: true, data: attached });
    }

    // Otherwise use SetupIntent flow: create SetupIntent and return client_secret
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

// Attach payment method to user (persist in DB). Accepts either paymentMethodId from FE
export async function attachPaymentMethod(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).send({ error: 'Unauthorized' });

    const { paymentMethodId } = req.body;
    if (!paymentMethodId) return res.status(400).send({ error: 'paymentMethodId required' });

    // This service will retrieve the payment method from Stripe and save to PaymentMethodModel
    const pm = await stripeService.attachPaymentMethodToUser(userId, paymentMethodId);

    res.json({ success: true, data: pm });
  } catch (err) {
    next(err);
  }
}

// Set a payment method as default for the authenticated user
export async function setDefaultPaymentMethod(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    const pmId = req.params.id;
    if (!userId) return res.status(401).send({ error: 'Unauthorized' });
    if (!pmId) return res.status(400).send({ error: 'payment method id required' });

    // unset previous defaults
    await PaymentMethodModel.updateMany(
      { user: userId, isDefault: true },
      { $set: { isDefault: false } }
    );
    await PaymentMethodModel.findOneAndUpdate(
      { user: userId, _id: pmId },
      { $set: { isDefault: true } }
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// List transactions for user (with optional status filter)
export async function listTransactions(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    const status = req.query.status as string | undefined;

    const query: any = { payer: userId };
    if (status) query.status = status.toUpperCase();

    const transactions = await TransactionModel.find(query).sort({ createdAt: -1 }).limit(200);
    res.json({ success: true, data: transactions, total: transactions.length });
  } catch (err) {
    next(err);
  }
}

// List invoices for user
export async function listInvoices(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    const invoices = await InvoiceModel.find({ user: userId }).sort({ createdAt: -1 }).limit(200);
    res.json({ success: true, data: invoices, total: invoices.length });
  } catch (err) {
    next(err);
  }
}
