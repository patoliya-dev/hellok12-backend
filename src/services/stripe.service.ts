import Stripe from 'stripe';
import config from '../config/config';
import { User } from '../models/user.model';
import PaymentMethodModel from '../models/paymentMethod.model';
import TransactionModel from '../models/transaction.model';
import InvoiceModel from '../models/invoice.model';
import WebhookEventLog from '../models/webhookEventLog.model';

const { STRIPE_SECRET_KEY, PLATFORM_FEE_PERCENT } = config;
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2022-11-15'
} as unknown as Stripe.StripeConfig);

export async function createOrGetCustomerForUser(userId: string, body: any = {}) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  if (user.stripeCustomerId) {
    const c = await stripe.customers.retrieve(user.stripeCustomerId);
    return user;
  }
  const created = await stripe.customers.create({
    email: user.email,
    metadata: { userId }
  });
  user.stripeCustomerId = created.id;
  await user.save();
  return user;
}

export async function listPaymentMethodsForUser(userId: string) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  if (!user.stripeCustomerId) return [];
  const pm = await stripe.paymentMethods.list({
    customer: user.stripeCustomerId,
    type: 'card'
  });
  // Map to simple objects we persist locally
  return pm.data.map(p => ({
    id: p.id,
    brand: p.card?.brand,
    last4: p.card?.last4,
    exp_month: p.card?.exp_month,
    exp_year: p.card?.exp_year
  }));
}

// Create SetupIntent for FE -> FE confirms using Elements
export async function createSetupIntentForUser(userId: string) {
  const user = await createOrGetCustomerForUser(userId);
  const si = await stripe.setupIntents.create({
    customer: user.stripeCustomerId
  });
  return si;
}

export interface CreatePaymentIntentParams {
  userId: string;
  amountCents: number;
  currency?: string;
  bookingId?: string;
  teacherId?: string;
  paymentMethodId?: string;
  savePaymentMethod?: boolean;
  idempotencyKey?: string;
  metadata?: Record<string, string>;
}

export async function createPaymentIntent(params: CreatePaymentIntentParams) {
  const {
    userId,
    amountCents,
    currency = 'usd',
    bookingId,
    teacherId,
    paymentMethodId,
    savePaymentMethod,
    idempotencyKey,
    metadata
  } = params;

  const user = await createOrGetCustomerForUser(userId);
  const teacher = teacherId ? await User.findById(teacherId) : null;
  const destinationAccount = teacher?.stripeAccountId || null;

  // platform fee
  const application_fee_amount = Math.round(amountCents * PLATFORM_FEE_PERCENT);

  const piParams: Stripe.PaymentIntentCreateParams = {
    amount: amountCents,
    currency,
    customer: user.stripeCustomerId,
    metadata: {
      userId,
      bookingId: bookingId || '',
      teacherId: teacherId || '',
      ...metadata
    },
    capture_method: 'automatic',
    confirm: false,
    payment_method: paymentMethodId,
    setup_future_usage: savePaymentMethod ? 'off_session' : undefined
  };

  // If teacher connected account exists, route transfer_data
  if (destinationAccount) {
    // transfer_data.amount is what's transferred to connected account (in cents)
    const teacherShare = amountCents - application_fee_amount;
    piParams.transfer_data = {
      destination: destinationAccount,
      amount: teacherShare
    };
    // To have Stripe collect application_fee_amount for platform, we set application_fee_amount too
    piParams.application_fee_amount = application_fee_amount;
  } else {
    // No connected account — platform receives entire amount
    // application_fee_amount can still be set if you use separate transfer later
    // We'll still set application_fee_amount = 0 for now
    piParams.application_fee_amount = application_fee_amount;
  }

  const opt: Stripe.RequestOptions = {};
  if (idempotencyKey) opt.idempotencyKey = idempotencyKey;

  const pi = await stripe.paymentIntents.create(piParams, opt);

  // persist a Transaction record with status 'CREATED'
  await TransactionModel.create({
    user: userId,
    payer: userId,
    payee: teacherId || null,
    booking: bookingId || null,
    amount: amountCents,
    currency,
    status: 'PENDING',
    stripePaymentIntentId: pi.id,
    platformFee: application_fee_amount,
    stripeCustomerId: user.stripeCustomerId,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  return pi;
}

// Called from webhook handler
export async function handleStripeEvent(event: Stripe.Event) {
  const id = event.id;

  // Idempotency
  const existing = await WebhookEventLog.findOne({ eventId: id });
  if (existing) {
    // already processed
    return;
  }
  await WebhookEventLog.create({ eventId: id, createdAt: new Date() });

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent;
      await handlePaymentIntentSucceeded(pi);
      break;
    }
    case 'payment_intent.payment_failed': {
      const pif = event.data.object as Stripe.PaymentIntent;
      await handlePaymentIntentFailed(pif);
      break;
    }
    case 'charge.refunded':
      // handle refunds
      break;
    default:
      // ignore other events for now
      break;
  }
}

async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent) {
  // Find Transaction
  const t = await TransactionModel.findOne({ stripePaymentIntentId: pi.id });
  if (!t) {
    // Optionally create a record
    await TransactionModel.create({
      payer: pi.metadata?.userId || null,
      amount: pi.amount || 0,
      currency: pi.currency,
      status: 'SUCCEEDED',
      stripePaymentIntentId: pi.id,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  } else {
    t.status = 'SUCCEEDED';
    // Access charge id safely: try expanded charges first, then fallback to latest_charge; cast to any
    t.stripeChargeId =
      (pi as any).charges?.data?.[0]?.id || (pi as any).latest_charge || t.stripeChargeId;
    await t.save();
  }

  // Create Invoice record
  await InvoiceModel.create({
    stripeInvoiceId: (pi as any).invoice || null,
    user: pi.metadata?.userId || null,
    amountDue: pi.amount || 0,
    amountPaid: pi.amount_received || 0,
    currency: pi.currency,
    status: 'PAID',
    createdAt: new Date(),
    updatedAt: new Date()
  });

  // TODO: mark associated Booking as PAID (if booking exists)
}

async function handlePaymentIntentFailed(pi: Stripe.PaymentIntent) {
  const t = await TransactionModel.findOne({ stripePaymentIntentId: pi.id });
  if (t) {
    t.status = 'FAILED';
    t.failureReason = pi.last_payment_error?.message;
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
  const invoice = await stripe.invoices.retrieve(stripeInvoiceId);
  return invoice;
}
