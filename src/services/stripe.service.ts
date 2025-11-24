// src/services/stripe.service.ts
import Stripe from 'stripe';
import config from '../config/config';
import { User } from '../models/user.model';
import PaymentMethodModel from '../models/paymentMethod.model';
import TransactionModel from '../models/transaction.model';
import InvoiceModel from '../models/invoice.model';
import WebhookEventLog from '../models/webhookEventLog.model';
import BookingModel from '../models/booking.model';
import payoutModel from '../models/payout.model';
import { Course } from '../models/course.model'; // optional if you want course lookup

const {
  STRIPE_SECRET_KEY,
  PLATFORM_FEE_PERCENT = 20,
  STRIPE_AUTO_TRANSFER = 'false',
  STRIPE_API_VERSION = '2022-11-15'
} = config;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: STRIPE_API_VERSION
} as unknown as Stripe.StripeConfig);

// Helpers
function computePlatformFee(amountCents: number) {
  const percent = Number(PLATFORM_FEE_PERCENT || 20);
  return Math.round(amountCents * (percent / 100));
}

export async function createOrGetCustomerForUser(userId: string, body: any = {}) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  if (user.stripeCustomerId) {
    try {
      await stripe.customers.retrieve(user.stripeCustomerId);
    } catch (e) {
      /* recreate below */
    }
    return user;
  }
  const created = await stripe.customers.create({ email: user.email, metadata: { userId } });
  user.stripeCustomerId = created.id;
  await user.save();
  return user;
}

export async function listPaymentMethodsForUser(userId: string) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  if (!user.stripeCustomerId) return [];
  const pm = await stripe.paymentMethods.list({ customer: user.stripeCustomerId, type: 'card' });
  return pm.data.map(p => ({
    id: p.id,
    stripePaymentMethodId: p.id,
    brand: p.card?.brand,
    last4: p.card?.last4,
    exp_month: p.card?.exp_month,
    exp_year: p.card?.exp_year,
    isDefault: false // DB authoritative
  }));
}

export async function createSetupIntentForUser(userId: string) {
  const user = await createOrGetCustomerForUser(userId);
  return stripe.setupIntents.create({ customer: user.stripeCustomerId });
}

export interface CreatePaymentIntentParams {
  userId: string;
  amount: number; // cents
  currency?: string;
  bookingId?: string;
  teacherId?: string;
  paymentMethodId?: string;
  savePaymentMethod?: boolean;
  payoutReceiverType?: 'teacher' | 'school';
  payoutReceiverId?: string;
  courseId?: string;
  courseTitle?: string;
  idempotencyKey?: string;
  metadata?: Record<string, string>;
}

export async function createPaymentIntent(params: CreatePaymentIntentParams) {
  const {
    userId,
    amount,
    currency = 'usd',
    bookingId,
    teacherId,
    paymentMethodId,
    savePaymentMethod,
    idempotencyKey,
    metadata = {},
    payoutReceiverType,
    payoutReceiverId,
    courseId,
    courseTitle
  } = params as any;

  if (!amount || amount <= 0) throw new Error('Invalid amount');

  const user = await createOrGetCustomerForUser(userId);
  const platformFee = computePlatformFee(amount);

  // Normalized metadata used to reconstruct transaction in webhook
  const piMetadata: Record<string, string> = {
    userId: String(userId || ''),
    bookingId: bookingId || '',
    payoutReceiverType: payoutReceiverType || '',
    payoutReceiverId: payoutReceiverId || teacherId || '',
    courseId: courseId || '',
    courseTitle: courseTitle || '',
    ...Object.keys(metadata || {}).reduce(
      (acc, k) => {
        acc[k] = String(metadata[k]);
        return acc;
      },
      {} as Record<string, string>
    )
  };

  const piParams: Stripe.PaymentIntentCreateParams = {
    amount,
    currency,
    customer: user.stripeCustomerId,
    metadata: piMetadata,
    capture_method: 'automatic',
    confirm: false,
    payment_method: paymentMethodId,
    setup_future_usage: savePaymentMethod ? 'off_session' : undefined
    // deliberately NO transfer_data or application_fee_amount
  };

  const opt: Stripe.RequestOptions = {};
  if (idempotencyKey) opt.idempotencyKey = idempotencyKey;

  const pi = await stripe.paymentIntents.create(piParams, opt);

  // Create Transaction record for immediate UI (PENDING)
  const reference = `REF_${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 900 + 100)}`;
  const title = courseTitle || piMetadata.courseTitle || 'Course Purchase';

  await TransactionModel.create({
    payer: userId,
    payee: payoutReceiverId || teacherId || null,
    booking: bookingId || null,
    course: courseId || null,
    courseTitle: courseTitle || null,
    title,
    reference,
    amount,
    amountDisplay: `$${(amount / 100).toFixed(2)}`,
    currency,
    status: 'PENDING',
    stripePaymentIntentId: pi.id,
    platformFee,
    netAmount: Math.max(0, amount - platformFee),
    stripeCustomerId: user.stripeCustomerId,
    metadata: piMetadata,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  return pi;
}

// Webhook handler will call handleStripeEvent (controller uses it)
export async function handleStripeEvent(event: Stripe.Event) {
  const id = event.id;
  const existing = await WebhookEventLog.findOne({ eventId: id });
  if (existing) return;
  await WebhookEventLog.create({ eventId: id, createdAt: new Date() });

  switch (event.type) {
    case 'payment_intent.succeeded':
      await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
      break;
    case 'payment_intent.payment_failed':
      await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
      break;
    case 'charge.refunded':
      /* optional */ break;
    case 'account.updated': {
      const acc = event.data.object as Stripe.Account;
      const user = await User.findOne({ stripeAccountId: acc.id });
      if (user) {
        user.stripeOnboardingComplete = !!(acc.payouts_enabled || acc.charges_enabled);
        await user.save();
      }
      break;
    }
    default:
      break;
  }
}

async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent) {
  // Ensure we handle idempotently
  let tx = await TransactionModel.findOne({ stripePaymentIntentId: pi.id });

  const chargeId = (pi as any).charges?.data?.[0]?.id || (pi as any).latest_charge || null;
  let charge: Stripe.Charge | null = null;
  try {
    if (chargeId)
      charge = await stripe.charges.retrieve(chargeId, {
        expand: ['payment_method_details.card', 'invoice']
      });
  } catch (err) {
    /* still continue */
  }

  const pm = (charge as any)?.payment_method_details || (pi as any)?.payment_method_details || null;
  const brand = pm?.card?.brand || pi.payment_method_types?.[0] || null;
  const last4 = pm?.card?.last4 || null;
  const receiptUrl = (charge as any)?.receipt_url || null;

  const stripeInvoiceId = (pi as any).invoice || null;
  let invoicePdfUrl: string | null = null;
  let hostedInvoiceUrl: string | null = null;
  if (stripeInvoiceId) {
    try {
      const stripeInvoice = await stripe.invoices.retrieve(String(stripeInvoiceId));
      invoicePdfUrl = (stripeInvoice as any)?.invoice_pdf || null;
      hostedInvoiceUrl = (stripeInvoice as any)?.hosted_invoice_url || null;
    } catch (err) {
      /* ignore */
    }
  }

  const platformFeeFromStripe = (pi as any).application_fee_amount || 0;
  const configuredPlatformFee = computePlatformFee(pi.amount || 0);
  const platformFee = platformFeeFromStripe || configuredPlatformFee;

  const amount = pi.amount || 0;
  const amountReceived = (pi as any).amount_received || amount;
  const netAmount = amount - (platformFee || 0);
  const amountDisplay = `$${(amount / 100).toFixed(2)}`;

  const invoiceNumber = stripeInvoiceId
    ? `INV_${stripeInvoiceId}`
    : `INV_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const title =
    (pi.metadata as any)?.courseTitle ||
    (pi.metadata as any)?.courseName ||
    (pi.metadata as any)?.title ||
    'Course Purchase';

  // Create or update Transaction
  if (!tx) {
    tx = await TransactionModel.create({
      payer: (pi.metadata as any)?.userId || null,
      payee: (pi.metadata as any)?.payoutReceiverId || (pi.metadata as any)?.teacherId || null,
      booking: (pi.metadata as any)?.bookingId || null,
      course: (pi.metadata as any)?.courseId || null,
      courseTitle: (pi.metadata as any)?.courseTitle || null,
      title,
      reference: invoiceNumber,
      amount,
      amountDisplay,
      currency: pi.currency || 'usd',
      status: 'SUCCEEDED',
      stripePaymentIntentId: pi.id,
      stripeChargeId: chargeId,
      stripeCustomerId: typeof pi.customer === 'string' ? pi.customer : null,
      stripeInvoiceId: stripeInvoiceId || null,
      platformFee,
      netAmount,
      paymentMethodBrand: brand,
      paymentMethodLast4: last4,
      metadata: pi.metadata || {},
      downloadUrl: receiptUrl || invoicePdfUrl || hostedInvoiceUrl || null,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  } else {
    tx.status = 'SUCCEEDED';
    tx.stripeChargeId = chargeId || tx.stripeChargeId;
    tx.stripeInvoiceId = stripeInvoiceId || tx.stripeInvoiceId;
    tx.platformFee = platformFee || tx.platformFee;
    tx.netAmount = netAmount || tx.netAmount;
    tx.paymentMethodBrand = brand || tx.paymentMethodBrand;
    tx.paymentMethodLast4 = last4 || tx.paymentMethodLast4;
    tx.reference = tx.reference || invoiceNumber;
    tx.title = tx.title || title;
    tx.downloadUrl =
      tx.downloadUrl || receiptUrl || invoicePdfUrl || hostedInvoiceUrl || tx.downloadUrl;
    tx.updatedAt = new Date();
    await tx.save();
  }

  // Build invoice items
  const courseLabel =
    (pi.metadata as any)?.courseTitle ||
    (pi.metadata as any)?.courseName ||
    (pi.metadata as any)?.title ||
    'Course';
  const items = [
    { description: courseLabel, quantity: 1, price: amount, priceDisplay: amountDisplay },
    {
      description: 'Platform Fee',
      quantity: 1,
      price: platformFee,
      priceDisplay: `$${((platformFee || 0) / 100).toFixed(2)}`
    },
    { description: 'Tax', quantity: 1, price: 0, priceDisplay: `$0.00` }
  ];

  // Upsert invoice
  let inv = null;
  if (stripeInvoiceId) inv = await InvoiceModel.findOne({ stripeInvoiceId: stripeInvoiceId });
  else inv = await InvoiceModel.findOne({ 'metadata.paymentIntent': pi.id });

  if (!inv) {
    inv = await InvoiceModel.create({
      stripeInvoiceId: stripeInvoiceId || null,
      number: invoiceNumber,
      user: (pi.metadata as any)?.userId || null,
      customerName: (pi.metadata as any)?.customerName || null,
      customerEmail: (pi.metadata as any)?.customerEmail || null,
      items,
      amountDue: amount,
      amountPaid: amountReceived,
      totalDisplay: amountDisplay,
      currency: pi.currency || 'usd',
      status: 'PAID',
      pdfUrl: invoicePdfUrl || null,
      hostedInvoiceUrl: hostedInvoiceUrl || null,
      metadata: { paymentIntent: pi.id, transaction: tx._id, raw: pi.metadata || {} },
      createdAt: new Date(),
      updatedAt: new Date()
    });
  } else {
    inv.amountPaid = amountReceived || inv.amountPaid;
    inv.amountDue = amount || inv.amountDue;
    inv.status = 'PAID';
    inv.pdfUrl = inv.pdfUrl || invoicePdfUrl || null;
    inv.hostedInvoiceUrl = inv.hostedInvoiceUrl || hostedInvoiceUrl || null;
    inv.items = inv.items && inv.items.length ? inv.items : (items as any);
    inv.updatedAt = new Date();
    await inv.save();
  }

  // Link invoice to transaction if missing
  if (inv && inv._id && (!tx.stripeInvoiceId || tx.stripeInvoiceId !== stripeInvoiceId)) {
    tx.stripeInvoiceId = stripeInvoiceId || tx.stripeInvoiceId;
    tx.updatedAt = new Date();
    await tx.save();
  }

  // Mark booking as paid
  try {
    const bookingId = (pi.metadata as any)?.bookingId;
    if (bookingId) {
      await BookingModel.findByIdAndUpdate(bookingId, {
        paymentStatus: 'PAID',
        transaction: tx._id,
        updatedAt: new Date()
      });
    }
  } catch (err) {
    console.warn('Failed to update booking paymentStatus', err);
  }

  // Payout creation (internal record). DO NOT auto-pay school recipients.
  const payoutReceiverType = (pi.metadata as any)?.payoutReceiverType || null;
  const payoutReceiverId =
    (pi.metadata as any)?.payoutReceiverId || (pi.metadata as any)?.teacherId || null;

  if (payoutReceiverType && payoutReceiverId) {
    const existingPayout = await payoutModel.findOne({ transaction: tx._id });
    if (!existingPayout) {
      const payout = await payoutModel.create({
        transaction: tx._id,
        invoice: inv?._id || null,
        toUser: payoutReceiverId,
        toAccountId: null,
        toType: payoutReceiverType,
        amount: netAmount,
        currency: pi.currency || 'usd',
        platformFee: platformFee || 0,
        netAmount: netAmount,
        stripeTransferId: null,
        status: 'PENDING',
        metadata: { fromPaymentIntent: pi.id, raw: pi.metadata || {} },
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // For teacher recipients only: if configured and teacher has connected account, attempt transfer (optional)
      if (payoutReceiverType === 'teacher') {
        try {
          const teacher = await User.findById(payoutReceiverId);
          if (teacher?.stripeAccountId) {
            payout.toAccountId = teacher.stripeAccountId;
            await payout.save();
            const autoTransferEnabled = String(STRIPE_AUTO_TRANSFER).toLowerCase() === 'true';
            if (autoTransferEnabled) {
              try {
                const transferResp = await stripe.transfers.create({
                  amount: netAmount,
                  currency: pi.currency || 'usd',
                  destination: teacher.stripeAccountId,
                  metadata: {
                    transaction: String(tx._id),
                    payoutId: String(payout._id),
                    paymentIntent: pi.id
                  }
                });
                payout.stripeTransferId = transferResp.id;
                payout.status = 'SENT';
                payout.updatedAt = new Date();
                await payout.save();
                tx.stripeTransferId = transferResp.id;
                await tx.save();
              } catch (err) {
                console.error('Auto transfer failed; payout remains pending', err);
              }
            }
          }
        } catch (err) {
          console.warn('Failed to create payout entry or fetch teacher account', err);
        }
      }
    } else {
      existingPayout.amount = netAmount;
      existingPayout.platformFee = platformFee || existingPayout.platformFee;
      existingPayout.updatedAt = new Date();
      await existingPayout.save();
    }
  } else {
    // create platform settlement record if no receiver info provided
    const existingPayout = await payoutModel.findOne({ transaction: tx._id });
    if (!existingPayout) {
      await payoutModel.create({
        transaction: tx._id,
        invoice: inv?._id || null,
        toUser: null,
        toAccountId: null,
        toType: 'platform',
        amount: netAmount,
        currency: pi.currency || 'usd',
        platformFee: platformFee || 0,
        netAmount: netAmount,
        stripeTransferId: null,
        status: 'SETTLED',
        metadata: { paymentIntent: pi.id },
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
  }

  return;
}

async function handlePaymentIntentFailed(pi: Stripe.PaymentIntent) {
  const t = await TransactionModel.findOne({ stripePaymentIntentId: pi.id });
  if (t) {
    t.status = 'FAILED';
    t.failureReason = (pi as any).last_payment_error?.message || 'Payment failed';
    t.updatedAt = new Date();
    await t.save();
  }
}

export async function createRefund(transactionPaymentIntentId: string, amount?: number) {
  const pi = await stripe.paymentIntents.retrieve(transactionPaymentIntentId);
  const chargeId = (pi as any).charges?.data?.[0]?.id;
  if (!chargeId) throw new Error('No charge found for payment intent');
  const refund = await stripe.refunds.create({ charge: chargeId, amount });
  return refund;
}

export async function getInvoice(stripeInvoiceId: string) {
  return stripe.invoices.retrieve(stripeInvoiceId);
}

export async function attachPaymentMethodToUser(userId: string, paymentMethodId: string) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  if (!user.stripeCustomerId) {
    const createdCustomer = await stripe.customers.create({
      email: user.email,
      metadata: { userId }
    });
    user.stripeCustomerId = createdCustomer.id;
    await user.save();
  }
  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  await stripe.paymentMethods.attach(paymentMethodId, { customer: user.stripeCustomerId });
  const saved = await PaymentMethodModel.create({
    user: userId,
    stripePaymentMethodId: paymentMethodId,
    brand: pm.card?.brand || pm.type,
    last4: pm.card?.last4,
    exp_month: pm.card?.exp_month,
    exp_year: pm.card?.exp_year,
    isDefault: false,
    createdAt: new Date()
  });
  return {
    id: saved._id,
    stripePaymentMethodId: paymentMethodId,
    brand: saved.brand,
    last4: saved.last4,
    exp_month: saved.exp_month,
    exp_year: saved.exp_year,
    isDefault: saved.isDefault
  };
}

export async function createTransferToConnectedAccount({
  transactionId,
  toAccountId,
  amount,
  currency = 'usd',
  metadata = {}
}: {
  transactionId: string;
  toAccountId: string;
  amount: number;
  currency?: string;
  metadata?: any;
}) {
  const transfer = await stripe.transfers.create({
    amount,
    currency,
    destination: toAccountId,
    metadata
  });
  const tx = await TransactionModel.findById(transactionId);
  if (tx) {
    tx.stripeTransferId = transfer.id;
    tx.updatedAt = new Date();
    await tx.save();
  }
  const payout = await payoutModel.create({
    transaction: transactionId,
    toUser: tx?.payee || null,
    toAccountId,
    amount,
    currency,
    platformFee: tx?.platformFee || 0,
    netAmount: amount,
    stripeTransferId: transfer.id,
    status: 'SENT',
    metadata
  });
  return { transfer, payout };
}
