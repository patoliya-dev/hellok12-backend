import { Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import PaymentMethodModel from '../../models/paymentMethod.model';
import TransactionModel from '../../models/transaction.model';
import InvoiceModel from '../../models/invoice.model';
import * as stripeService from '../../services/stripe.service';
import config from '../../config/config';
import { User } from '../../models/user.model';

const { STRIPE_SECRET_KEY } = config;
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2022-11-15'
} as unknown as Stripe.StripeConfig);

export async function createCustomer(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).send({ success: false, message: 'Unauthorized' });
    const user = await stripeService.createOrGetCustomerForUser(userId, req.body);
    res.json({ success: true, customer: { id: user.stripeCustomerId, email: user.email } });
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

export async function savePaymentMethod(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).send({ success: false, message: 'Unauthorized' });
    const card = req.body;

    // If raw card provided (legacy), create PM server side and attach
    if (card && card.cardNumber) {
      const pm = await stripe.paymentMethods.create({
        type: 'card',
        card: {
          number: card.cardNumber.replace(/\s+/g, ''),
          exp_month: parseInt(card.expiryDate.split('/')[0], 10),
          exp_year: 2000 + parseInt(card.expiryDate.split('/')[1], 10),
          cvc: card.cvv
        },
        billing_details: { name: card.cardholderName }
      });

      const attached = await stripeService.attachPaymentMethodToUser(userId, pm.id);
      return res.json({ success: true, data: attached });
    }
    // SetupIntent flow: return client_secret
    const result = await stripeService.createSetupIntentForUser(userId);
    res.json({ success: true, client_secret: result.client_secret });
  } catch (err) {
    next(err);
  }
}

export async function setDefaultPaymentMethod(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    const pmId = req.params.id;
    if (!userId) return res.status(401).send({ success: false, message: 'Unauthorized' });
    if (!pmId)
      return res.status(400).send({ success: false, message: 'payment method id required' });

    // unset local defaults and set the selected
    await PaymentMethodModel.updateMany(
      { user: userId, isDefault: true },
      { $set: { isDefault: false } }
    );
    const pm = await PaymentMethodModel.findOneAndUpdate(
      { user: userId, _id: pmId },
      { $set: { isDefault: true } },
      { new: true }
    );

    if (!pm) {
      return res.status(404).json({ success: false, message: 'Payment method not found' });
    }

    // update stripe customer's invoice_settings.default_payment_method
    const user = await User.findById(userId);
    if (user?.stripeCustomerId) {
      await stripe.customers.update(user.stripeCustomerId, {
        invoice_settings: { default_payment_method: pm.stripePaymentMethodId }
      });
    }

    res.json({
      success: true,
      data: { id: pm._id, stripePaymentMethodId: pm.stripePaymentMethodId, isDefault: pm.isDefault }
    });
  } catch (err) {
    next(err);
  }
}

export async function createPaymentIntent(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const incoming =
      (req as any).body && (req as any).body.body
        ? (req as any).body.body
        : (req as any).body || {};

    const bodySchema = z.object({
      amount: z.number().positive(),
      currency: z.string().optional().default('usd'),
      bookingId: z.string().optional(),
      teacherId: z.string().optional(),
      courseId: z.string().optional(),
      courseTitle: z.string().optional(),
      payoutReceiverType: z.enum(['teacher', 'school']).optional(),
      payoutReceiverId: z.string().optional(),
      paymentMethodId: z.string().optional(),
      savePaymentMethod: z.boolean().optional().default(false),
      idempotencyKey: z.string(),
      metadata: z.record(z.string(), z.string()).optional()
    });

    const payload = bodySchema.parse(incoming);

    const result = await stripeService.createPaymentIntent({
      userId,
      amount: payload.amount,
      currency: payload.currency,
      bookingId: payload.bookingId,
      teacherId: payload.teacherId,
      paymentMethodId: payload.paymentMethodId,
      savePaymentMethod: payload.savePaymentMethod,
      idempotencyKey: payload.idempotencyKey,
      metadata: payload.metadata,
      payoutReceiverType: payload.payoutReceiverType,
      payoutReceiverId: payload.payoutReceiverId,
      courseId: payload.courseId,
      courseTitle: payload.courseTitle
    });

    // Option A guarantee: client_secret MUST exist
    if (!result.client_secret || !result.paymentIntentId) {
      throw new Error(
        `PaymentIntent creation failed: missing client_secret or paymentIntentId (invoiceId=${result.invoiceId})`
      );
    }

    // Resolve transactionId (invoice-first = safest)
    let transactionId: string | null = null;
    try {
      const tx = await TransactionModel.findOne({
        'metadata.idempotencyKey': payload.idempotencyKey
      })
        .select({ _id: 1 })
        .lean();
      if (tx) transactionId = String(tx._id);
    } catch {
      // non-fatal
    }

    return res.json({
      success: true,
      client_secret: result.client_secret,
      paymentIntentId: result.paymentIntentId,
      invoiceId: result.invoiceId,
      hosted_invoice_url: result.hosted_invoice_url,
      transactionId
    });
  } catch (err) {
    next(err);
  }
}

export async function refund(req: Request, res: Response, next: NextFunction) {
  try {
    const { transactionId, amount } = req.body;
    if (!transactionId)
      return res.status(400).json({ success: false, message: 'transactionId required' });

    const tx = await TransactionModel.findById(transactionId)
      .select({ stripePaymentIntentId: 1 })
      .lean();

    if (!tx?.stripePaymentIntentId) {
      return res.status(400).json({
        success: false,
        message: 'No payment intent associated with this transaction'
      });
    }

    const refund = await stripeService.createRefund(tx.stripePaymentIntentId, amount);
    res.json({ success: true, refund });
  } catch (err) {
    next(err);
  }
}

// transactions list — returns UI-ready objects
export async function listTransactions(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).send({ success: false, message: 'Unauthorized' });
    const status = (req.query.status as string | undefined) || undefined;
    const limit = parseInt((req.query.limit as string) || '20', 10);
    const page = parseInt((req.query.page as string) || '1', 10);
    const skip = (page - 1) * limit;

    // Historical writes can store payer/payee as either ObjectId or plain string.
    // Use $toString matching so both representations are returned reliably.
    const baseFilter: any = {
      $or: [
        { payer: userId },
        { payee: userId },
        { $expr: { $eq: [{ $toString: '$payer' }, userId] } },
        { $expr: { $eq: [{ $toString: '$payee' }, userId] } }
      ]
    };
    if (status && status !== 'ALL') {
      const statusMap: any = { Completed: 'SUCCEEDED', CompletedUpper: 'SUCCEEDED' };
      baseFilter.status = statusMap[status] || status;
    }

    const [items, total] = await Promise.all([
      TransactionModel.find(baseFilter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      TransactionModel.countDocuments(baseFilter)
    ]);

    // map to FE shape exactly as Figma expects
    const data = items.map((t: any) => ({
      id: String(t._id),
      title: t.title || t.metadata?.courseTitle || 'Purchase',
      dateTime: t.createdAt,
      amount: t.amount,
      amountDisplay: t.amountDisplay || (t.amount ? `$${(t.amount / 100).toFixed(2)}` : '$0.00'),
      status: t.status,
      method: t.paymentMethodBrand
        ? `${t.paymentMethodBrand} •••• ${t.paymentMethodLast4}`
        : t.metadata?.paymentMethod
          ? t.metadata.paymentMethod
          : null,
      reference: t.stripePaymentIntentId || String(t._id),
      downloadUrl: t.downloadUrl || null,
      invoiceId: t.stripeInvoiceId || null,
      bookingId: t.booking || null,
      metadata: t.metadata || {}
    }));

    res.json({ success: true, data, meta: { total, page, limit } });
  } catch (err) {
    next(err);
  }
}

export async function getTransactionReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    const txId = req.params.id;
    const t = await TransactionModel.findById(txId).lean();
    if (!t) return res.status(404).json({ success: false, message: 'Transaction not found' });
    if (t.payer?.toString() !== userId && t.payee?.toString() !== userId)
      return res.status(403).json({ success: false, message: 'Forbidden' });

    const chargeId = t.stripeChargeId;
    if (!chargeId)
      return res
        .status(404)
        .json({ success: false, message: 'No charge associated with this transaction' });

    const charge = await stripe.charges.retrieve(chargeId as string);
    const receipt_url = (charge as any)?.receipt_url || null;
    let pdfUrl = receipt_url;
    if (!pdfUrl) {
      const inv = await InvoiceModel.findOne({ stripeInvoiceId: t?.stripeInvoiceId }).lean();
      if (inv?.pdfUrl) pdfUrl = inv.pdfUrl;
    }
    return res.json({ success: true, url: pdfUrl, receipt_url });
  } catch (err) {
    next(err);
  }
}

export async function listInvoices(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).send({ success: false, message: 'Unauthorized' });
    const limit = parseInt((req.query.limit as string) || '20', 10);
    const page = parseInt((req.query.page as string) || '1', 10);
    const skip = (page - 1) * limit;

    // Historical rows may store `user` as string or ObjectId.
    const invoiceOwnerFilter: any = {
      $or: [{ user: userId }, { $expr: { $eq: [{ $toString: '$user' }, userId] } }]
    };

    const [items, total] = await Promise.all([
      InvoiceModel.find(invoiceOwnerFilter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      InvoiceModel.countDocuments(invoiceOwnerFilter)
    ]);

    const data = items.map(inv => ({
      id: String(inv._id),
      invoiceNumber: inv.number,
      dateTime: inv.createdAt,
      createdAt: inv.createdAt,
      amount: inv.amountDue,
      amountDisplay:
        inv.totalDisplay || (inv.amountDue ? `$${(inv.amountDue / 100).toFixed(2)}` : '$0.00'),
      status: inv.status,
      items: inv.items || [],
      customerName: inv.customerName,
      customerEmail: inv.customerEmail,
      pdfUrl: inv.pdfUrl,
      hostedInvoiceUrl: inv.hostedInvoiceUrl,
      platformFee: inv.items?.find((i: any) => i.description === 'Platform Fee')?.price || 0,
      tax: inv.items?.find((i: any) => i.description === 'Tax')?.price || 0,
      metadata: inv.metadata || {}
    }));

    res.json({ success: true, data, meta: { total, page, limit } });
  } catch (err) {
    next(err);
  }
}

export async function getInvoice(req: Request, res: Response, next: NextFunction) {
  try {
    const invoiceId = req.params.id;
    const invoice = await InvoiceModel.findById(invoiceId).lean();
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, data: invoice });
  } catch (err) {
    next(err);
  }
}

export async function downloadInvoice(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    const invoiceId = req.params.id;
    if (!userId) return res.status(401).send({ success: false, message: 'Unauthorized' });
    const invoice = await InvoiceModel.findById(invoiceId).lean();
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    // Legacy rows may have user stored inconsistently; authorize by invoice.user when present.
    if (invoice.user && String(invoice.user) !== userId) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const localUrl = invoice.pdfUrl || invoice.hostedInvoiceUrl;
    if (localUrl) return res.json({ success: true, url: localUrl });

    if (invoice.stripeInvoiceId) {
      const stripeInvoice = await stripeService.getInvoice(invoice.stripeInvoiceId);
      const stripePdfUrl = (stripeInvoice as any)?.invoice_pdf || null;
      const stripeHostedUrl = (stripeInvoice as any)?.hosted_invoice_url || null;
      const stripeUrl = stripePdfUrl || stripeHostedUrl;
      if (stripeUrl) {
        await InvoiceModel.findByIdAndUpdate(invoice._id, {
          ...(stripePdfUrl ? { pdfUrl: stripePdfUrl } : {}),
          ...(stripeHostedUrl ? { hostedInvoiceUrl: stripeHostedUrl } : {}),
          updatedAt: new Date()
        });
        return res.json({ success: true, url: stripeUrl });
      }
    }

    // Fallback: return transaction receipt/download URL when invoice-specific URLs are not present.
    let tx: any = null;
    const txFromMetadata = (invoice as any)?.metadata?.transaction;
    const piFromMetadata = (invoice as any)?.metadata?.paymentIntent;
    const piFromRawMetadata = (invoice as any)?.metadata?.raw?.paymentIntent;
    const bookingFromRawMetadata = (invoice as any)?.metadata?.raw?.bookingId;

    const ownerMatch: any = {
      $or: [
        { payer: userId },
        { payee: userId },
        { $expr: { $eq: [{ $toString: '$payer' }, userId] } },
        { $expr: { $eq: [{ $toString: '$payee' }, userId] } }
      ]
    };

    if (txFromMetadata) {
      tx = await TransactionModel.findOne({ _id: txFromMetadata, ...ownerMatch }).lean();
    }
    if (!tx && invoice.stripeInvoiceId) {
      tx = await TransactionModel.findOne({
        stripeInvoiceId: invoice.stripeInvoiceId,
        ...ownerMatch
      }).lean();
    }
    if (!tx && piFromMetadata) {
      tx = await TransactionModel.findOne({
        stripePaymentIntentId: piFromMetadata,
        ...ownerMatch
      }).lean();
    }
    if (!tx && piFromRawMetadata) {
      tx = await TransactionModel.findOne({
        stripePaymentIntentId: piFromRawMetadata,
        ...ownerMatch
      }).lean();
    }
    if (!tx && bookingFromRawMetadata) {
      tx = await TransactionModel.findOne({
        booking: bookingFromRawMetadata,
        ...ownerMatch
      }).lean();
    }
    if (tx?.downloadUrl) {
      return res.json({ success: true, url: tx.downloadUrl });
    }

    return res.status(404).json({ success: false, message: 'No PDF available for this invoice' });
  } catch (err) {
    next(err);
  }
}
