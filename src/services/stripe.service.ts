import Stripe from 'stripe';
import config from '../config/config';
import { User } from '../models/user.model';
import PaymentMethodModel from '../models/paymentMethod.model';
import WebhookEventLog from '../models/webhookEventLog.model';
import TransactionModel from '../models/transaction.model';
import { SessionModel } from '../models/sessions.model';
import InvoiceModel from '../models/invoice.model';
import BookingModel from '../models/booking.model';
import payoutModel from '../models/payout.model';
import { Course } from '../models/course.model';

const { STRIPE_SECRET_KEY, PLATFORM_FEE_PERCENT = 20, STRIPE_API_VERSION = '2022-11-15' } = config;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: STRIPE_API_VERSION
} as unknown as Stripe.StripeConfig);

export async function createOrGetCustomerForUser(userId: string, body: any = {}) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  if (user.stripeCustomerId) {
    // optionally validate existence in Stripe
    try {
      await stripe.customers.retrieve(user.stripeCustomerId);
    } catch (err) {
      // ignore and recreate
    }
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
  return pm.data.map(p => ({
    id: p.id,
    brand: p.card?.brand,
    last4: p.card?.last4,
    exp_month: p.card?.exp_month,
    exp_year: p.card?.exp_year,
    stripePaymentMethodId: p.id,
    isDefault: false
  }));
}

export async function createSetupIntentForUser(userId: string) {
  const user = await createOrGetCustomerForUser(userId);
  const si = await stripe.setupIntents.create({
    customer: user.stripeCustomerId
  });
  return si;
}

// Helpers
function computePlatformFee(amountCents: number) {
  const percent = Number(PLATFORM_FEE_PERCENT || 20);
  return Math.round(amountCents * (percent / 100));
}

// snippet for stripe.service.ts (TypeScript/JS)
async function createInvoiceAndCharge(params: {
  customerId: string;
  paymentMethodId?: string; // optional: stripe PM id to charge (or rely on customer's default PM)
  items?: {
    amount: number;
    currency?: string;
    description?: string;
    metadata?: Record<string, any>;
  }[]; // [{ amount: 9900, currency: 'usd', description: 'Course: Algebra 1' }]
  metadata?: Record<string, any>;
}) {
  const { customerId, paymentMethodId, items = [], metadata = {} } = params;
  // 1) Optionally set customer's invoice_settings.default_payment_method so finalizeInvoice will attempt to charge it
  if (paymentMethodId) {
    try {
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId }
      });
    } catch (err) {
      // non-fatal - log and continue
      console.warn('Failed to set customer default PM', err);
    }
  }

  // 2) Create invoice items
  for (const it of items) {
    await stripe.invoiceItems.create({
      customer: customerId,
      amount: it.amount, // cents
      currency: it.currency || 'usd',
      description: it.description || 'Course purchase',
      metadata: it.metadata || {}
    });
  }

  // 3) Create invoice that will try to charge automatically
  const invoice = await stripe.invoices.create({
    customer: customerId,
    collection_method: 'charge_automatically', // charge automatically using customer's default PM
    auto_advance: true, // attempts to finalize and pay
    metadata
  });

  // 4) Finalize invoice -> this will create the PaymentIntent & try to pay
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id);

  // The finalized invoice may include a payment_intent object. If it does, return that client_secret
  const paymentIntent = (finalized as any).payment_intent || null;

  return { invoice: finalized, paymentIntent };
}

export interface CreatePaymentIntentParams {
  userId: string;
  amount: number; // cents
  currency?: string;
  bookingId?: string;
  teacherId?: string;
  studentId?: string;
  paymentMethodId?: string;
  savePaymentMethod?: boolean;
  payoutReceiverType?: 'teacher' | 'school';
  payoutReceiverId?: string;
  courseId?: string;
  courseTitle?: string;
  lessonId?: string;
  isTrial?: boolean;
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
    courseTitle,
    studentId,
    lessonId,
    isTrial
  } = params as any;

  if (!amount || amount <= 0) throw new Error('Invalid amount');

  // Ensure stripe customer exists
  const user = await createOrGetCustomerForUser(userId);

  // Compute platform fee
  const platformFee = computePlatformFee(amount);

  // Build PI metadata (strings only)
  const piMetadata: Record<string, string> = {
    userId: String(userId),
    bookingId: bookingId || '',
    payoutReceiverType: payoutReceiverType || '',
    payoutReceiverId: payoutReceiverId || teacherId || '',
    courseId: courseId || '',
    courseTitle: courseTitle || '',
    studentId: studentId || '',
    lessonId: lessonId || '',
    isTrial: isTrial ? 'true' : 'false',
    ...Object.keys(metadata || {}).reduce((acc: Record<string, string>, k) => {
      acc[k] = String((metadata as any)[k]);
      return acc;
    }, {})
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
  };

  const requestOptions: Stripe.RequestOptions = {};
  if (idempotencyKey) requestOptions.idempotencyKey = idempotencyKey;

  const pi = await stripe.paymentIntents.create(piParams, requestOptions);

  // Persist transaction skeleton (PENDING)
  const reference = `REF_${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 900 + 100)}`;
  const title = courseTitle || piMetadata.courseTitle || 'Course Purchase';

  // inside your createPaymentIntent
  const items = [
    { amount, currency, description: courseTitle || 'Course purchase' },
    { amount: platformFee, currency, description: 'Platform fee' }
  ];

  const { invoice: stripeInvoice } = await createInvoiceAndCharge({
    customerId: user.stripeCustomerId || '',
    paymentMethodId,
    items,
    metadata: piMetadata
  });

  const tx = await TransactionModel.create({
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
    platformFee,
    netAmount: Math.max(0, amount - platformFee),
    stripeCustomerId: user.stripeCustomerId,
    stripeInvoiceId: stripeInvoice?.id || null,
    stripePaymentIntentId: pi?.id || null,
    status: pi ? (pi.status === 'succeeded' ? 'SUCCEEDED' : 'PENDING') : 'PENDING',
    metadata: piMetadata,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  return {
    client_secret: pi?.client_secret || null,
    invoiceId: stripeInvoice?.id || null,
    id: pi?.id,
    hosted_invoice_url: stripeInvoice?.hosted_invoice_url || null
  };
}

// ----------------------------- Webhook event processing -----------------------------
export async function handleStripeEvent(event: Stripe.Event) {
  const id = event.id;

  // Idempotency: skip if we've already processed this event id
  const existing = await WebhookEventLog.findOne({ eventId: id });
  if (existing) {
    return;
  }
  await WebhookEventLog.create({ eventId: id, payload: event, createdAt: new Date() });

  try {
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
        // ignore other events
        break;
    }
  } catch (err) {
    // ensure we surface errors to logs; webhook events must be retried by Stripe
    console.error('Error handling stripe event', err);
    throw err;
  }
}

/**
 * Handle succeeded PI:
 * - upsert Transaction & Invoice
 * - mark Booking PAID
 * - atomically: increment Course.enrolledCount (if not trial), decrement Lesson.trialCapacity (if trial)
 * - atomically add student to Session.students ($addToSet)
 * Uses mongoose transactions when replica set available; otherwise falls back to best-effort single-doc atomic ops.
 */
export async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent) {
  // Locate existing transaction
  let tx = await TransactionModel.findOne({ stripePaymentIntentId: pi.id });

  // Determine charge details
  const chargeId = (pi as any).charges?.data?.[0]?.id || (pi as any).latest_charge || null;
  let charge: Stripe.Charge | null = null;
  try {
    if (chargeId) {
      charge = await stripe.charges.retrieve(chargeId, {
        expand: ['payment_method_details.card', 'invoice']
      });
    }
  } catch (err) {
    console.warn('Could not fetch charge details', err);
    charge = null;
  }

  const pmDetails =
    (charge as any)?.payment_method_details || (pi as any)?.payment_method_details || null;
  const brand = pmDetails?.card?.brand || pi?.payment_method_types?.[0] || null;
  const last4 = pmDetails?.card?.last4 || null;
  const receiptUrl = (charge as any)?.receipt_url || null;

  // Invoice urls
  let invoicePdfUrl: string | null = null;
  let hostedInvoiceUrl: string | null = null;
  const stripeInvoiceId = (pi as any).invoice || null;
  if (stripeInvoiceId) {
    try {
      const stripeInvoice = await stripe.invoices.retrieve(String(stripeInvoiceId));
      invoicePdfUrl = (stripeInvoice as any)?.invoice_pdf || null;
      hostedInvoiceUrl = (stripeInvoice as any)?.hosted_invoice_url || null;
    } catch (err) {
      console.warn('Failed to retrieve Stripe invoice', err);
    }
  }

  const platformFeeFromStripe = (pi as any).application_fee_amount || 0;
  const configuredPlatformFee = computePlatformFee ? computePlatformFee(pi.amount || 0) : 0;
  const platformFee = platformFeeFromStripe || configuredPlatformFee || 0;

  const amount = pi.amount || 0;
  const amountReceived = (pi as any).amount_received || amount;
  const netAmount = amount - (platformFee || 0);
  const amountDisplay = `$${(amount / 100).toFixed(2)}`;

  const invoiceNumber = stripeInvoiceId
    ? `INV_${stripeInvoiceId}`
    : `REF_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${String(Math.floor(Math.random() * 9000) + 1000)}`;

  const title =
    (pi.metadata as any)?.courseTitle ||
    (pi.metadata as any)?.courseName ||
    (pi.metadata as any)?.title ||
    'Course Purchase';

  // Upsert transaction
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

  // Build invoice items and upsert invoice (same as before)
  const items: any[] = [];
  const courseLabel =
    (pi.metadata as any)?.courseTitle ||
    (pi.metadata as any)?.courseName ||
    (pi.metadata as any)?.title ||
    'Course';
  items.push({ description: courseLabel, quantity: 1, price: amount, priceDisplay: amountDisplay });
  items.push({
    description: 'Platform Fee',
    quantity: 1,
    price: platformFee,
    priceDisplay: `$${((platformFee || 0) / 100).toFixed(2)}`
  });
  const tax = 0;
  items.push({
    description: 'Tax',
    quantity: 1,
    price: tax,
    priceDisplay: `$${(tax / 100).toFixed(2)}`
  });

  let inv = null;
  if (stripeInvoiceId) {
    inv = await InvoiceModel.findOne({ stripeInvoiceId: stripeInvoiceId });
  } else {
    inv = await InvoiceModel.findOne({ 'metadata.paymentIntent': pi.id });
  }

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
    inv.updatedAt = new Date();
    await inv.save();
  }

  // Associate transaction -> invoice
  if (inv && inv._id && (!tx.stripeInvoiceId || tx.stripeInvoiceId !== stripeInvoiceId)) {
    tx.stripeInvoiceId = stripeInvoiceId || tx.stripeInvoiceId;
    tx.updatedAt = new Date();
    await tx.save();
  }

  // Update booking atomically and add student to sessions
  try {
    const bookingId = (pi.metadata as any)?.bookingId;
    if (bookingId) {
      // fetch fresh booking
      const booking = await BookingModel.findById(bookingId).lean();
      if (!booking) throw new Error('Booking not found during session update');

      const studentId = booking.student;
      const courseId = booking.course;

      if (studentId && courseId) {
        const now = new Date();

        // 1) Add student to all future sessions of this course
        await SessionModel.updateMany(
          {
            course: courseId,
            start: { $gte: now } // ONLY future sessions
          },
          { $addToSet: { students: studentId } }
        );

        // 2) Retrieve all session IDs where this student is now attached
        const updatedSessions = await SessionModel.find({
          course: courseId,
          start: { $gte: now },
          students: studentId
        })
          .select('_id')
          .lean();

        const sessionIds = (updatedSessions || []).map(s => s._id);

        // 3) Save to booking.sessions
        if (sessionIds.length > 0) {
          await BookingModel.findByIdAndUpdate(bookingId, {
            $addToSet: { sessions: { $each: sessionIds } }
          });
        }
      }
    }
  } catch (err) {
    console.warn('Failed to update booking after PI succeeded', err);
  }

  // --- Course increment: atomically increment enrolledCount if capacity allows ---
  try {
    const bookingId = (pi.metadata as any)?.bookingId;
    if (bookingId) {
      const booking = await BookingModel.findById(bookingId).lean();
      if (booking && !booking.isTrial) {
        const courseId = booking.course || (pi.metadata as any)?.courseId;
        if (courseId) {
          // Use a safe atomic condition: either group and enrolledCount < studentCapacity OR 1-on-1 and enrolledCount < 1
          const updatedCourse = await Course.findOneAndUpdate(
            {
              _id: courseId,
              $or: [
                { lessonType: 'group', $expr: { $lt: ['$enrolledCount', '$studentCapacity'] } },
                { lessonType: '1-on-1', enrolledCount: { $lt: 1 } }
              ]
            } as any,
            { $inc: { enrolledCount: 1 } },
            { new: true }
          ).lean();

          if (!updatedCourse) {
            // Could not increment — capacity exhausted between booking & payment
            tx.metadata = tx.metadata || {};
            tx.metadata.reconciliationRequired = true;
            tx.metadata.reconciliationReason = 'COURSE_INCREMENT_FAILED';
            tx.updatedAt = new Date();
            await tx.save();
          }
        }
      }
      // If booking is a trial the lesson capacity should have been decremented when booking created
    }
  } catch (err) {
    console.error('Error while incrementing course.enrolledCount', err);
    tx.metadata = tx.metadata || {};
    tx.metadata.reconciliationRequired = true;
    tx.metadata.reconciliationReason = 'COURSE_INCREMENT_EXCEPTION';
    tx.updatedAt = new Date();
    await tx.save();
  }

  // --- Create or update internal payout record (no automated transfers) ---
  try {
    const payoutReceiverType = (pi.metadata as any)?.payoutReceiverType || null;
    const payoutReceiverId =
      (pi.metadata as any)?.payoutReceiverId || (pi.metadata as any)?.teacherId || null;

    const existingPayout = await payoutModel.findOne({ transaction: tx._id });

    // choose a safe default for payout status: use PENDING so admins can reconcile or send
    const desiredStatus: 'PENDING' | 'SENT' | 'FAILED' | 'SETTLED' = 'PENDING';

    if (!existingPayout) {
      await payoutModel.create({
        transaction: tx._id,
        invoice: inv?._id || null,
        toUser: payoutReceiverId || null,
        toAccountId: null,
        toType: payoutReceiverType || (payoutReceiverId ? 'teacher' : 'platform'),
        amount: tx.amount || amount,
        currency: pi.currency || 'usd',
        platformFee: platformFee || 0,
        netAmount: tx.netAmount || netAmount,
        stripeTransferId: null,
        status: desiredStatus,
        metadata: { fromPaymentIntent: pi.id, raw: pi.metadata || {} },
        createdAt: new Date(),
        updatedAt: new Date()
      });
    } else {
      existingPayout.toUser = existingPayout.toUser || payoutReceiverId || existingPayout.toUser;
      existingPayout.toType =
        existingPayout.toType ||
        payoutReceiverType ||
        existingPayout.toType ||
        (payoutReceiverId ? 'teacher' : 'platform');
      existingPayout.amount = existingPayout.amount || tx.netAmount || netAmount;
      existingPayout.currency = existingPayout.currency || pi.currency || 'usd';
      existingPayout.platformFee = existingPayout.platformFee || platformFee || 0;
      existingPayout.netAmount = existingPayout.netAmount || tx.netAmount || netAmount;
      existingPayout.metadata = Object.assign({}, existingPayout.metadata || {}, {
        lastPaymentIntent: pi.id,
        raw: pi.metadata || {}
      });
      existingPayout.updatedAt = new Date();
      await existingPayout.save();
    }
  } catch (err) {
    console.warn('Failed to create or update payout record', err);
  }

  return;
}

/**
 * When PI fails, mark tx FAILED and update booking
 */
export async function handlePaymentIntentFailed(pi: Stripe.PaymentIntent) {
  const t = await TransactionModel.findOne({ stripePaymentIntentId: pi.id });
  if (t) {
    t.status = 'FAILED';
    t.failureReason = (pi as any).last_payment_error?.message || 'Payment failed';
    t.updatedAt = new Date();
    await t.save();

    // Update booking to FAILED if bookingId exists
    try {
      const bookingId = (pi.metadata as any)?.bookingId;
      if (bookingId) {
        await BookingModel.updateOne(
          { _id: bookingId },
          { $set: { paymentStatus: 'FAILED', updatedAt: new Date() } }
        );
      }
    } catch (err) {
      console.warn('Failed to update booking on payment failure', err);
    }
  }
}

// ----------------------------- Refund helper -----------------------------
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

// ----------------------------- Attach payment method & persist -----------------------------
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

// ----------------------------- Transfer helper (manual) -----------------------------
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
