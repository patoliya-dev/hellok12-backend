import Stripe from 'stripe';
import config from '../config/config';
import { User } from '../models/user.model';
import PaymentMethodModel from '../models/paymentMethod.model';
import WebhookEventLog from '../models/webhookEventLog.model';
import TransactionModel from '../models/transaction.model';
import { SessionModel } from '../models/sessions.model';
import InvoiceModel from '../models/invoice.model';
import BookingModel from '../models/booking.model';
import PayoutModel from '../models/payout.model';
import { Course } from '../models/course.model';
import { extractPayoutContext } from './stripe.helper';
import { Types } from 'mongoose';

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

// ----------------------------- Invoice creation (SAFE + idempotent) -----------------------------
// ----------------------------- Types -----------------------------
type CreateInvoiceAndChargeParams = {
  customerId: string;
  paymentMethodId?: string;
  items: {
    amount: number;
    currency?: string;
    description?: string;
    metadata?: Record<string, any>;
  }[];
  metadata?: Record<string, any>;
  idempotencyKey?: string;
};

type CreateInvoiceAndChargeResult = {
  invoice: Stripe.Invoice;
  paymentIntent: Stripe.PaymentIntent; // Option A requires PI
};

// ----------------------------- Stripe helpers -----------------------------
function isStripeStateError(err: any, contains: string) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes(contains.toLowerCase());
}

async function safeRetrievePI(
  stripe: Stripe,
  payment_intent: string | Stripe.PaymentIntent | null | undefined
): Promise<Stripe.PaymentIntent | null> {
  if (!payment_intent) return null;
  if (typeof payment_intent === 'string') return stripe.paymentIntents.retrieve(payment_intent);
  return payment_intent;
}

function toStripeMeta(meta: Record<string, any>) {
  // Stripe metadata values must be strings
  return Object.keys(meta || {}).reduce((acc: Record<string, string>, k) => {
    const v = meta[k];
    acc[k] = v == null ? '' : String(v);
    return acc;
  }, {});
}

/**
 * Ensure PI metadata contains our canonical metadata.
 * - Does NOT wipe existing Stripe metadata
 * - Adds only missing keys (or you can override if you want)
 */
async function ensurePaymentIntentMetadata(
  stripe: Stripe,
  piId: string,
  canonicalMeta: Record<string, any>,
  idempotencyKey?: string
) {
  const desired = toStripeMeta(canonicalMeta);

  // Fetch current PI metadata (cheap + safe)
  const current = await stripe.paymentIntents.retrieve(piId);
  const existing = (current.metadata || {}) as Record<string, string>;

  // Merge (do NOT remove Stripe keys)
  const merged: Record<string, string> = { ...existing, ...desired };

  // If already contains everything, skip update
  let changed = false;
  for (const k of Object.keys(desired)) {
    if (existing[k] !== desired[k]) {
      changed = true;
      break;
    }
  }
  if (!changed) return current;

  await stripe.paymentIntents.update(
    piId,
    { metadata: merged },
    idempotencyKey ? { idempotencyKey: `${idempotencyKey}:pi_meta` } : undefined
  );

  // return fresh PI (so you return correct object to FE if needed)
  return stripe.paymentIntents.retrieve(piId);
}

async function applyPurchaseEffectsFromMetadata(meta: Record<string, string>, txId: any) {
  const bookingId = meta.bookingId?.trim();
  if (!bookingId) return;

  const booking = await BookingModel.findById(bookingId).lean();
  if (!booking) return;

  const studentId = booking.student;
  const courseId = booking.course;

  if (studentId && courseId) {
    const now = new Date();
    // Add student only to upcoming sessions of this course.
    await SessionModel.updateMany(
      { course: courseId, start: { $gte: now } },
      { $addToSet: { students: studentId } }
    );

    const sessionIds = (
      await SessionModel.find({ course: courseId, start: { $gte: now } })
        .select('_id')
        .lean()
    ).map(s => s._id);

    // Booking update (atomic)
    const bookingUpdateResult = await BookingModel.updateOne(
      { _id: bookingId, paymentStatus: { $ne: 'PAID' } },
      {
        $set: { paymentStatus: 'PAID', transaction: txId, updatedAt: new Date() },
        ...(sessionIds.length ? { $addToSet: { sessions: { $each: sessionIds } } } : {})
      }
    );

    // Course increment (only if this call transitioned booking -> PAID and booking is not trial)
    const newlyMarkedPaid = Number((bookingUpdateResult as any)?.modifiedCount || 0) > 0;
    if (newlyMarkedPaid && !booking.isTrial) {
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
        await TransactionModel.updateOne(
          { _id: txId },
          {
            $set: {
              'metadata.reconciliationRequired': true,
              'metadata.reconciliationReason': 'COURSE_INCREMENT_FAILED',
              updatedAt: new Date()
            }
          }
        );
      }
    }
  }
}

// ----------------------------- Invoice creation (canonical) -----------------------------
/**
 * Canonical invoice-first flow:
 * 1) create invoice items (idempotent)
 * 2) create invoice with pending_invoice_items_behavior=include (idempotent)
 * 3) finalize only if draft (idempotent + state-safe)
 * 4) pay only if not paid (idempotent + state-safe) => ensures PaymentIntent exists for card
 * 5) retrieve invoice with expanded payment_intent
 */
async function createInvoiceAndCharge(
  stripe: Stripe,
  params: CreateInvoiceAndChargeParams
): Promise<CreateInvoiceAndChargeResult> {
  const { customerId, paymentMethodId, items, metadata = {}, idempotencyKey } = params;

  // Optional: set customer default PM (helps Stripe attach PM on PI creation)
  if (paymentMethodId) {
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId }
    });
  }

  // 1) Create invoice items (idempotent per line)
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    await stripe.invoiceItems.create(
      {
        customer: customerId,
        amount: it.amount,
        currency: it.currency || 'usd',
        description: it.description || 'Course purchase',
        metadata: it.metadata || {}
      },
      idempotencyKey ? { idempotencyKey: `${idempotencyKey}:ii:${i}:${it.amount}` } : undefined
    );
  }

  // 2) Create invoice (draft) and include pending invoice items
  const invoice = await stripe.invoices.create(
    {
      customer: customerId,
      collection_method: 'charge_automatically',
      auto_advance: false, // we finalize explicitly
      pending_invoice_items_behavior: 'include',
      metadata,
      payment_settings: { payment_method_types: ['card'] }
    },
    idempotencyKey ? { idempotencyKey: `${idempotencyKey}:inv` } : undefined
  );

  // 3) Retrieve current state
  let current = await stripe.invoices.retrieve(invoice.id, { expand: ['payment_intent'] });

  // 4) Finalize only if draft (state-safe)
  if (current.status === 'draft') {
    try {
      current = await stripe.invoices.finalizeInvoice(
        current.id,
        { auto_advance: false }, // DO NOT auto-pay; FE will confirm
        idempotencyKey ? { idempotencyKey: `${idempotencyKey}:finalize` } : undefined
      );
    } catch (err: any) {
      if (
        isStripeStateError(err, 'already finalized') ||
        isStripeStateError(err, 'already paid') ||
        isStripeStateError(err, 'cannot finalize') ||
        isStripeStateError(err, 'status')
      ) {
        current = await stripe.invoices.retrieve(invoice.id, { expand: ['payment_intent'] });
      } else {
        throw err;
      }
    }
  }

  // 5) Retrieve expanded invoice (single source of truth)
  const expanded = await stripe.invoices.retrieve(current.id, {
    expand: ['payment_intent', 'charge', 'lines']
  });

  const pi = await safeRetrievePI(stripe, (expanded as any).payment_intent);

  // If PI is missing, it usually means invoice total is 0 OR invoice items weren’t included.
  // With pending_invoice_items_behavior=include and amount>0 this should exist.
  if (!pi) {
    throw new Error(
      `Stripe invoice created but PaymentIntent is missing. invoiceId=${expanded.id}, status=${expanded.status}, total=${expanded.total}`
    );
  }

  const updatedPi = await ensurePaymentIntentMetadata(
    stripe,
    pi.id,
    metadata, // <-- this is canonicalMeta you're passing into invoice creation
    idempotencyKey
  );

  return { invoice: expanded, paymentIntent: updatedPi };
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
  studentId?: string;
  lessonId?: string;
  isTrial?: boolean;
  idempotencyKey?: string;
  metadata?: Record<string, string>;
}

async function resolveCourseTitle(
  courseTitle?: string,
  metadata?: Record<string, string>,
  courseId?: string
) {
  const directTitle =
    courseTitle?.trim() ||
    metadata?.courseTitle?.trim() ||
    metadata?.courseName?.trim() ||
    metadata?.title?.trim();
  if (directTitle) return directTitle;

  const resolvedCourseId = courseId || metadata?.courseId;
  if (!resolvedCourseId || !Types.ObjectId.isValid(resolvedCourseId)) return null;

  const courseDoc = await Course.findById(resolvedCourseId).select({ title: 1 }).lean();
  return courseDoc?.title?.trim() || null;
}

// ----------------------------- Main API entry -----------------------------
/**
 * Invoice-first “create payment intent” API (kept name for compatibility).
 *
 * Guarantees:
 * - strict DB idempotency: one Transaction per idempotencyKey
 * - returns: { client_secret, paymentIntentId, invoiceId, hosted_invoice_url }
 */
export async function createPaymentIntent(params: CreatePaymentIntentParams): Promise<{
  client_secret: string | null;
  paymentIntentId: string | null;
  invoiceId: string | null;
  hosted_invoice_url: string | null;
}> {
  const {
    userId,
    amount,
    currency = 'usd',
    bookingId,
    teacherId,
    paymentMethodId,
    idempotencyKey,
    metadata = {},
    payoutReceiverType,
    payoutReceiverId,
    courseId,
    courseTitle,
    studentId,
    lessonId,
    isTrial
  } = params;

  if (!amount || amount <= 0) throw new Error('Invalid amount');
  if (!idempotencyKey) throw new Error('idempotencyKey is required for strict idempotency');

  const user = await createOrGetCustomerForUser(userId);
  const resolvedCourseTitle = await resolveCourseTitle(courseTitle, metadata, courseId);

  const canonicalMeta: Record<string, string> = {
    userId: String(userId),
    bookingId: bookingId || '',
    courseId: courseId || '',
    courseTitle: resolvedCourseTitle || '',
    teacherId: teacherId || '',
    payoutReceiverType: payoutReceiverType || metadata.payoutReceiverType || '',
    payoutReceiverId: payoutReceiverId || metadata.payoutReceiverId || '',
    studentId: studentId || '',
    lessonId: lessonId || '',
    isTrial: isTrial ? 'true' : 'false',
    idempotencyKey,
    ...Object.keys(metadata || {}).reduce((acc: Record<string, string>, k) => {
      acc[k] = String((metadata as any)[k]);
      return acc;
    }, {})
  };

  // 1) DB idempotency fast-path: if tx exists, return its invoice PI
  const existingTx = await TransactionModel.findOne({ 'metadata.idempotencyKey': idempotencyKey })
    .select({ stripeInvoiceId: 1, stripePaymentIntentId: 1 })
    .lean();

  if (existingTx?.stripeInvoiceId) {
    const inv = await stripe.invoices.retrieve(existingTx.stripeInvoiceId, {
      expand: ['payment_intent']
    });

    const pi = await safeRetrievePI(stripe, (inv as any).payment_intent);
    return {
      client_secret: pi?.client_secret || null,
      paymentIntentId: pi?.id || existingTx.stripePaymentIntentId || null,
      invoiceId: inv.id,
      hosted_invoice_url: (inv as any).hosted_invoice_url || null
    };
  }

  // 2) Stripe idempotency: create invoice + PI (NO PAY)
  const items = [{ amount, currency, description: resolvedCourseTitle || 'Course purchase' }];

  const { invoice, paymentIntent } = await createInvoiceAndCharge(stripe, {
    customerId: user.stripeCustomerId!,
    paymentMethodId,
    items,
    metadata: canonicalMeta,
    idempotencyKey
  });

  // 3) DB upsert with ZERO conflict risk using UPDATE PIPELINE
  //    - no duplicate tx because of unique index on metadata.idempotencyKey
  //    - no "path conflict" because each field is assigned once via $ifNull
  const now = new Date();

  const payee = payoutReceiverId || teacherId || null;
  const payeeType = payoutReceiverType || undefined;

  await TransactionModel.updateOne(
    { 'metadata.idempotencyKey': idempotencyKey },
    [
      {
        $set: {
          updatedAt: now,

          // stable keys (set if missing)
          payer: { $ifNull: ['$payer', userId] },
          payee: { $ifNull: ['$payee', payee] },
          payeeType: { $ifNull: ['$payeeType', payeeType] },
          booking: { $ifNull: ['$booking', bookingId || null] },

          amount: { $ifNull: ['$amount', amount] },
          amountDisplay: { $ifNull: ['$amountDisplay', `$${(amount / 100).toFixed(2)}`] },
          currency: { $ifNull: ['$currency', currency] },

          stripeCustomerId: { $ifNull: ['$stripeCustomerId', user.stripeCustomerId] },
          stripeInvoiceId: { $ifNull: ['$stripeInvoiceId', invoice.id] },
          stripePaymentIntentId: { $ifNull: ['$stripePaymentIntentId', paymentIntent.id] },

          title: { $ifNull: ['$title', resolvedCourseTitle || 'Course Purchase'] },
          reference: { $ifNull: ['$reference', invoice.number || `INV_${invoice.id}`] },

          // IMPORTANT: don’t overwrite metadata; set once if missing
          metadata: { $ifNull: ['$metadata', canonicalMeta] },

          // create default status if missing
          status: { $ifNull: ['$status', 'PENDING'] },

          // ensure createdAt exists
          createdAt: { $ifNull: ['$createdAt', now] }
        }
      }
    ] as any,
    { upsert: true }
  );

  return {
    client_secret: paymentIntent.client_secret || null,
    paymentIntentId: paymentIntent.id || null,
    invoiceId: invoice.id || null,
    hosted_invoice_url: (invoice as any).hosted_invoice_url || null
  };
}

function computePlatformFee(amountCents: number, percent: number) {
  const p = Number(percent || 0);
  if (!Number.isFinite(p) || p <= 0) return 0;
  return Math.round((amountCents * p) / 100);
}

async function getStripeFeeFromCharge(chargeId: string): Promise<number> {
  const ch = await stripe.charges.retrieve(chargeId, { expand: ['balance_transaction'] });
  const bt: any = (ch as any).balance_transaction;
  return typeof bt?.fee === 'number' ? bt.fee : 0;
}

export async function handleInvoicePaid(rawInvoice: Stripe.Invoice) {
  const invoice = (await stripe.invoices.retrieve(rawInvoice.id, {
    expand: ['payment_intent', 'charge', 'lines']
  })) as Stripe.Invoice;

  const pi = (invoice as any).payment_intent as Stripe.PaymentIntent | null;
  if (!pi) return;

  const meta = (invoice.metadata || {}) as Record<string, string>;
  const payoutCtx = await extractPayoutContext(meta);

  const grossAmount = invoice.amount_paid ?? pi.amount ?? 0;
  const currency = invoice.currency || 'usd';

  // charge resolution
  const chargeField = (invoice as any).charge;
  const chargeId =
    typeof chargeField === 'string'
      ? chargeField
      : chargeField && typeof chargeField === 'object'
        ? (chargeField.id as string | undefined)
        : undefined;

  const platformFee = computePlatformFee(grossAmount, Number(PLATFORM_FEE_PERCENT || 20));

  // Stripe fee borne by HelloK12
  let stripeFee = 0;
  if (chargeId) {
    try {
      stripeFee = await getStripeFeeFromCharge(chargeId);
    } catch {
      stripeFee = 0;
    }
  }

  // Payee receives gross - platformFee
  const payeeNetAmount = Math.max(grossAmount - platformFee, 0);

  // HelloK12 net revenue after stripe fee (optional, tracking only)
  const platformNetRevenue = Math.max(platformFee - stripeFee, 0);

  // receipt + card details
  let receiptUrl: string | null = null;
  let brand: string | null = null;
  let last4: string | null = null;

  if (chargeId) {
    try {
      const charge = await stripe.charges.retrieve(chargeId, {
        expand: ['payment_method_details.card']
      });
      receiptUrl = (charge as any)?.receipt_url || null;
      const pm = (charge as any)?.payment_method_details;
      brand = pm?.card?.brand || null;
      last4 = pm?.card?.last4 || null;
    } catch {
      // ignore
    }
  }

  const resolvedCourseTitle = await resolveCourseTitle(meta.courseTitle, meta, meta.courseId);
  const title = resolvedCourseTitle || 'Course Purchase';
  const reference = invoice.number || `INV_${invoice.id}`;
  const amountDisplay = `$${(grossAmount / 100).toFixed(2)}`;

  // Transaction: store platformFee + payeeNetAmount consistently
  const tx = await TransactionModel.findOneAndUpdate(
    { stripeInvoiceId: invoice.id },
    {
      $setOnInsert: { createdAt: new Date() },
      $set: {
        payer: meta.userId || null,
        payee: payoutCtx.payee || null,
        payeeType: payoutCtx.payeeType,
        school: payoutCtx.school || null,

        booking: meta.bookingId || null,
        course: meta.courseId || null,
        courseTitle: meta.courseTitle || null,

        title,
        reference,

        amount: grossAmount,
        amountDisplay,
        currency,
        status: 'SUCCEEDED',

        stripeInvoiceId: invoice.id,
        stripePaymentIntentId: pi.id,
        stripeChargeId: chargeId || null,
        stripeCustomerId: typeof invoice.customer === 'string' ? invoice.customer : null,

        platformFee,
        netAmount: payeeNetAmount,

        paymentMethodBrand: brand,
        paymentMethodLast4: last4,

        metadata: {
          ...meta,
          webhookSource: 'invoice.paid',
          stripeFee: String(stripeFee),
          platformNetRevenue: String(platformNetRevenue)
        },

        downloadUrl:
          receiptUrl || (invoice as any).invoice_pdf || (invoice as any).hosted_invoice_url || null,

        updatedAt: new Date()
      }
    },
    { new: true, upsert: true }
  ).lean();

  // Invoice doc upsert
  const lineItems =
    (invoice.lines?.data || []).map(li => ({
      description: li.description || 'Item',
      quantity: typeof li.quantity === 'number' ? li.quantity : 1,
      price: typeof li.amount === 'number' ? li.amount : 0,
      priceDisplay: `$${(((li.amount as any) || 0) / 100).toFixed(2)}`
    })) || [];

  await InvoiceModel.updateOne(
    { stripeInvoiceId: invoice.id },
    {
      $setOnInsert: { createdAt: new Date() },
      $set: {
        user: meta.userId || null,
        stripeInvoiceId: invoice.id,
        number: invoice.number || `INV_${invoice.id}`,
        customerName: meta.customerName || null,
        customerEmail: meta.customerEmail || null,
        items: lineItems,
        amountDue: invoice.amount_due || 0,
        amountPaid: invoice.amount_paid || 0,
        totalDisplay: amountDisplay,
        currency,
        status: 'PAID',
        pdfUrl: (invoice as any).invoice_pdf || null,
        hostedInvoiceUrl: (invoice as any).hosted_invoice_url || null,
        metadata: {
          paymentIntent: pi.id,
          transaction: (tx as any)?._id,
          payoutReceiverType: meta.payoutReceiverType || '',
          payoutReceiverId: meta.payoutReceiverId || '',
          schoolId: payoutCtx.school || null
        },
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );

  // Payout: amount=gross, platformFee=platformFee, netAmount=payeeNetAmount
  if ((tx as any)?._id) {
    await PayoutModel.updateOne(
      { transaction: (tx as any)._id },
      {
        $setOnInsert: { createdAt: new Date() },
        $set: {
          transaction: (tx as any)._id,
          invoice:
            (await InvoiceModel.findOne({ stripeInvoiceId: invoice.id }).select('_id').lean())
              ?._id || null,

          toUser: payoutCtx.payee,
          toType: payoutCtx.payeeType,

          amount: grossAmount,
          currency,
          platformFee,
          netAmount: payeeNetAmount,

          stripeTransferId: null,
          status: 'PENDING',
          metadata: {
            schoolId: payoutCtx.school,
            courseId: meta.courseId || null,
            bookingId: meta.bookingId || null,
            invoiceId: invoice.id,
            paymentIntentId: pi.id,
            stripeFee // for reporting if needed
          },
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    // Apply booking/session/course effects
    await applyPurchaseEffectsFromMetadata(meta, (tx as any)._id);
  }
}

export async function handleInvoicePaymentFailed(rawInvoice: Stripe.Invoice) {
  const invoice = (await stripe.invoices.retrieve(rawInvoice.id, {
    expand: ['payment_intent']
  })) as Stripe.Invoice;

  const meta = (invoice.metadata || {}) as Record<string, string>;

  const pi = (invoice as any).payment_intent as Stripe.PaymentIntent | null;
  const piId = pi?.id || undefined;

  // find tx by invoiceId first, else by PI
  const tx =
    (await TransactionModel.findOne({ stripeInvoiceId: invoice.id })) ||
    (piId ? await TransactionModel.findOne({ stripePaymentIntentId: piId }) : null);

  const failureMsg =
    (invoice as any)?.last_finalization_error?.message ||
    (invoice as any)?.last_payment_error?.message ||
    'Invoice payment failed';

  if (tx) {
    tx.status = 'FAILED';
    tx.failureReason = tx.failureReason || failureMsg;
    tx.updatedAt = new Date();
    await tx.save();
  }

  // mark invoice doc failed
  try {
    const invDoc = await InvoiceModel.findOne({ stripeInvoiceId: invoice.id });
    if (invDoc) {
      invDoc.status = 'FAILED';
      invDoc.updatedAt = new Date();
      await invDoc.save();
    }
  } catch {
    // ignore
  }

  // update booking if exists in metadata
  try {
    const bookingId = meta.bookingId;
    if (bookingId) {
      await BookingModel.updateOne(
        { _id: bookingId },
        { $set: { paymentStatus: 'FAILED', updatedAt: new Date() } }
      );
    }
  } catch {
    // ignore
  }

  // payout record: optional (only if it exists)
  try {
    if (tx?._id) {
      const payout = await PayoutModel.findOne({ transaction: tx._id });
      if (payout) {
        payout.status = 'FAILED';
        payout.updatedAt = new Date();
        await payout.save();
      }
    }
  } catch {
    // ignore
  }
}

async function handlePaymentIntentSucceededLegacy(pi: Stripe.PaymentIntent) {
  // If metadata is empty (common in invoice flow), do NOT attempt DB mapping
  const meta = (pi.metadata || {}) as Record<string, string>;
  const hasAnyKeys = meta && Object.keys(meta).length > 0;

  // If no metadata, we cannot link booking/course/payout safely → stop.
  if (!hasAnyKeys) {
    console.warn('Skipping legacy PI succeeded: missing metadata', { piId: pi.id });
    return;
  }

  // If you still need this for truly legacy PI (no invoice), keep your existing logic,
  // but ensure it never writes empty strings to ObjectId fields and uses upserts.
  // Minimal approach: call your current handlePaymentIntentSucceeded after making it metadata-safe.
  await handlePaymentIntentSucceeded(pi);
}

async function ensureWebhookOnce(eventId: string, event: Stripe.Event): Promise<boolean> {
  try {
    const r = await WebhookEventLog.updateOne(
      { eventId },
      { $setOnInsert: { eventId, payload: event, createdAt: new Date() } },
      { upsert: true }
    );
    // If matched and not upserted => already processed
    return !!(r as any).upsertedCount; // true if new insert
  } catch (e: any) {
    // duplicate key => already processed
    if (e?.code === 11000) return false;
    throw e;
  }
}

// ----------------------------- Webhook event processing -----------------------------
export async function handleStripeEvent(event: Stripe.Event) {
  const isNew = await ensureWebhookOnce(event.id, event);
  if (!isNew) return;

  try {
    switch (event.type) {
      case 'invoice.paid': {
        const inv = event.data.object as Stripe.Invoice;
        await handleInvoicePaid(inv);
        return;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        await handleInvoicePaymentFailed(inv);
        return;
      }
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;

        // If PI is linked to invoice => invoice is the source of truth
        const invoiceId = typeof (pi as any).invoice === 'string' ? (pi as any).invoice : null;
        if (invoiceId) {
          await handleInvoicePaid({ id: invoiceId } as any);
          return;
        }

        // Otherwise legacy PI-only flow
        await handlePaymentIntentSucceededLegacy(pi);
        return;
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const invoiceId = typeof (pi as any).invoice === 'string' ? (pi as any).invoice : null;

        if (invoiceId) {
          await handleInvoicePaymentFailed({ id: invoiceId } as any);
          return;
        }

        await handlePaymentIntentFailed(pi);
        return;
      }
      default:
        return;
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
  const payoutCtx = await extractPayoutContext(pi.metadata || {});

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
  const configuredPlatformFee = computePlatformFee
    ? computePlatformFee(pi.amount || 0, PLATFORM_FEE_PERCENT)
    : 0;
  const platformFee = platformFeeFromStripe || configuredPlatformFee || 0;

  const amount = pi.amount || 0;
  const amountReceived = (pi as any).amount_received || amount;
  const netAmount = amount - (platformFee || 0);
  const amountDisplay = `$${(amount / 100).toFixed(2)}`;

  const invoiceNumber = stripeInvoiceId
    ? `INV_${stripeInvoiceId}`
    : `REF_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${String(Math.floor(Math.random() * 9000) + 1000)}`;

  const resolvedCourseTitle = await resolveCourseTitle(
    (pi.metadata as any)?.courseTitle,
    pi.metadata as any,
    (pi.metadata as any)?.courseId
  );
  const title = resolvedCourseTitle || 'Course Purchase';

  // Upsert transaction
  if (!tx) {
    tx = await TransactionModel.create({
      payer: pi.metadata?.userId || null,
      payee: payoutCtx.payee,
      payeeType: payoutCtx.payeeType,
      school: payoutCtx.school,

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
  const courseLabel = resolvedCourseTitle || 'Course';
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
  let bookingTransitionedToPaid = false;
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
            start: { $gte: now }
          },
          { $addToSet: { students: studentId } }
        );

        // 2) Retrieve all session IDs where this student is now attached
        const updatedSessions = await SessionModel.find({
          course: courseId,
          start: { $gte: now }
        })
          .select('_id')
          .lean();

        const sessionIds = (updatedSessions || []).map(s => s._id);

        const filter = { _id: bookingId, paymentStatus: { $ne: 'PAID' } };

        const update: any = {
          $set: {
            paymentStatus: 'PAID',
            transaction: tx._id,
            updatedAt: new Date()
          }
        };

        if (sessionIds.length) {
          update.$addToSet = { sessions: { $each: sessionIds } };
        }

        const bookingUpdateResult = await BookingModel.updateOne(filter, update).exec();
        bookingTransitionedToPaid = Number((bookingUpdateResult as any)?.modifiedCount || 0) > 0;
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
      if (booking && bookingTransitionedToPaid && !booking.isTrial) {
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

    const existingPayout = await PayoutModel.findOne({ transaction: tx._id });

    // choose a safe default for payout status: use PENDING so admins can reconcile or send
    const desiredStatus: 'PENDING' | 'SENT' | 'FAILED' | 'SETTLED' = 'PENDING';

    if (!existingPayout) {
      await PayoutModel.create({
        transaction: tx._id,
        invoice: inv?._id || null,

        toUser: payoutReceiverId,
        toType: payoutReceiverType,

        amount,
        currency: pi.currency || 'usd',
        platformFee,
        netAmount,

        stripeTransferId: null, // manual payout
        status: 'PENDING',

        metadata: {
          payoutReceiverType: payoutReceiverType,
          payoutReceiverId: payoutReceiverId,
          school: payoutCtx.school,
          fromPaymentIntent: pi.id,
          raw: pi.metadata || {}
        },

        createdAt: new Date(),
        updatedAt: new Date()
      });
    } else {
      const safeFallbackToUser = Types.ObjectId.isValid(String(payoutReceiverId || '').trim())
        ? String(payoutReceiverId).trim()
        : null;
      existingPayout.toUser = existingPayout.toUser || payoutCtx.payee || safeFallbackToUser;
      existingPayout.toType =
        existingPayout.toType || payoutReceiverType || (payoutReceiverId ? 'teacher' : 'platform');
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

// ----------------------------- Refund helper -----------------------------
export async function createRefund(transactionPaymentIntentId: string, amount?: number) {
  const pi = await stripe.paymentIntents.retrieve(transactionPaymentIntentId);
  const chargeId = (pi as any).charges?.data?.[0]?.id;
  if (!chargeId) throw new Error('No charge found for payment intent');
  return stripe.refunds.create({ charge: chargeId, amount });
}

export async function getInvoice(stripeInvoiceId: string) {
  return stripe.invoices.retrieve(stripeInvoiceId);
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

  const payout = await PayoutModel.create({
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
