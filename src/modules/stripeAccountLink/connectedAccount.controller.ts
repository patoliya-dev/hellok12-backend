import { Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import config from '../../config/config';
import { User } from '../../models/user.model';
import TransactionModel from '../../models/transaction.model';
import InvoiceModel from '../../models/invoice.model';
import PayoutModel from '../../models/payout.model';
import * as stripeService from '../../services/stripe.service';

const { STRIPE_SECRET_KEY } = config;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2022-11-15'
} as unknown as Stripe.StripeConfig);

// POST /api/payments/create-connected-account
export async function createConnectedAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { type = 'express', country = 'US', business_type = 'individual' } = req.body;

    // If school user, they become connected account owner; teacher may also create their own
    const account = await stripe.accounts.create({
      type,
      country,
      business_type: user.role === 'school' ? 'company' : business_type,
      email: user.email || undefined,
      capabilities: {
        // request required capabilities
        card_payments: { requested: true },
        transfers: { requested: true }
      },
      metadata: { userId }
    });

    user.stripeAccountId = account.id;
    user.stripeOnboardingComplete = false;
    await user.save();

    res.json({ success: true, accountId: account.id, account });
  } catch (err) {
    next(err);
  }
}

// POST /api/payments/generate-onboarding-link
export async function generateOnboardingLink(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    const { return_url, refresh_url } = req.body;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const user = await User.findById(userId);
    if (!user || !user.stripeAccountId)
      return res
        .status(400)
        .json({ error: 'Connected account missing. Call createConnectedAccount first.' });

    const link = await stripe.accountLinks.create({
      account: user.stripeAccountId,
      refresh_url: refresh_url || `${config.clientURL}/billing`,
      return_url: return_url || `${config.clientURL}/billing`,
      type: 'account_onboarding'
    });

    res.json({ success: true, url: link.url, expires_at: link.expires_at });
  } catch (err) {
    next(err);
  }
}

// GET /api/payments/account-status
export async function getAccountStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const user = await User.findById(userId);
    if (!user || !user.stripeAccountId) return res.json({ success: true, accountSummary: null });

    const account = await stripe.accounts.retrieve(user.stripeAccountId);
    // minimal shape
    const accountSummary = {
      id: account.id,
      business_type: account.business_type,
      charges_enabled: account.charges_enabled,
      payouts_enabled: (account as any).payouts_enabled ?? false,
      requirements: account.requirements,
      capabilities: (account as any).capabilities || {},
      external_accounts: (account as any).external_accounts || {},
      pending_verification: (account as any).requirements?.currently_due?.length > 0,
      country: account.country
    };

    res.json({ accountSummary });
  } catch (err) {
    next(err);
  }
}

// POST /api/payments/update-payout-details
export async function updatePayoutDetails(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    const { bankAccountToken } = req.body; // prefer token from Stripe.js or bank account tokenized
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const user = await User.findById(userId);
    if (!user || !user.stripeAccountId)
      return res.status(400).json({ error: 'Connected account missing.' });

    // Add external account (bank) to connected account
    // bankAccountToken should be created client-side with stripe.createToken({bank_account: {...}}) or plaid / bank linking
    const externalAccount = await stripe.accounts.createExternalAccount(user.stripeAccountId, {
      external_account: bankAccountToken
    });

    res.json({ success: true, externalAccount });
  } catch (err) {
    next(err);
  }
}

// GET /api/payments/balance
export async function getBalance(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const user = await User.findById(userId);
    if (!user || !user.stripeAccountId)
      return res.status(400).json({ error: 'Connected account missing.' });

    // Use Stripe to retrieve balance for connected account by passing stripeAccount: user.stripeAccountId in options
    const balance = await stripe.balance.retrieve({ stripeAccount: user.stripeAccountId });
    res.json({ success: true, balance });
  } catch (err) {
    next(err);
  }
}

// GET /api/payments/transactions
export async function listTransactions(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // If school, show transactions where payee is school's stripeAccountId OR transactions where booking.school == user._id
    let filter: any = {};
    if (user.role === 'school') {
      // transactions associated to bookings where booking.school == user._id OR payee is null (platform) - keep it simple:
      filter = { $or: [{ payee: user._id }, { 'metadata.schoolId': user._id }] };
    } else if (user.role === 'teacher') {
      filter = { payee: user._id };
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const transactions = await TransactionModel.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json({ success: true, data: transactions });
  } catch (err) {
    next(err);
  }
}

// GET /api/payments/invoices
export async function listInvoices(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Show invoices created by platform for this user
    const invoices = await InvoiceModel.find({ user: userId }).sort({ createdAt: -1 }).limit(200);
    res.json({ success: true, data: invoices });
  } catch (err) {
    next(err);
  }
}

// POST /payments/payouts/create
export async function createPayout(req: Request, res: Response, next: NextFunction) {
  try {
    // Check admin rights: (req.user.role === 'admin') — implement according to your app
    const { transactionId, toAccountId } = req.body;
    if (!transactionId || !toAccountId)
      return res
        .status(400)
        .json({ success: false, message: 'transactionId and toAccountId required' });

    const tx = await TransactionModel.findById(transactionId);
    if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found' });

    const txIdStr = String(tx._id);

    const amount = tx.netAmount ?? Math.max(0, (tx.amount ?? 0) - (tx.platformFee ?? 0));
    const { transfer, payout } = await stripeService.createTransferToConnectedAccount({
      transactionId: txIdStr,
      toAccountId,
      amount,
      currency: tx.currency || 'usd',
      metadata: { transactionId: txIdStr }
    });

    // save transfer id on transaction and payout created above inside service
    tx.stripeTransferId = transfer.id;
    await tx.save();

    return res.json({ success: true, data: { transfer, payout } });
  } catch (err) {
    next(err);
  }
}

export async function getPayout(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id;
    const p = await PayoutModel.findById(id).lean();
    if (!p) return res.status(404).json({ success: false, message: 'Payout not found' });
    return res.json({ success: true, data: p });
  } catch (err) {
    next(err);
  }
}
