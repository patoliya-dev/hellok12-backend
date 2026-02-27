import { Types } from 'mongoose';
import { User } from '../../models/user.model';
import {
  decryptBankValue,
  encryptBankValue,
  maskAccountNumber,
  maskUpiId
} from '../../utils/bankDetailsCrypto';
import { payoutAccountRepository } from './payoutAccount.repository';
import { PayoutAccountCreateInput, PayoutAccountPatchInput } from './payoutAccount.schemas';

type OwnerType = 'TEACHER' | 'SCHOOL';
type AccountStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

const sensitiveKeys = new Set([
  'country',
  'currency',
  'holderName',
  'bankName',
  'accountNumber',
  'ifsc',
  'branchName',
  'accountType',
  'upiId'
]);

const createHttpError = (message: string, statusCode = 400) => {
  const err: any = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const resolveOwner = async (userId: string) => {
  const user = await User.findById(userId).select('_id role school name email').lean();
  if (!user?._id) throw createHttpError('User not found', 404);

  if (String(user.role) === 'teacher') {
    if (user.school)
      throw createHttpError('Only independent teachers can manage payout account', 403);
    return { ownerType: 'TEACHER' as OwnerType, ownerId: String(user._id) };
  }

  if (String(user.role) === 'school') {
    return { ownerType: 'SCHOOL' as OwnerType, ownerId: String(user._id) };
  }

  throw createHttpError('Only teachers and schools can manage payout account', 403);
};

const buildSafe = (doc: any) => {
  if (!doc?._id) return null;
  return {
    _id: String(doc._id),
    ownerType: doc.ownerType as OwnerType,
    ownerId: doc.ownerId,
    owner: doc.ownerId
      ? {
          _id: String(doc.ownerId._id || doc.ownerId),
          name: String(doc.ownerId.name || ''),
          email: String(doc.ownerId.email || ''),
          role: String(doc.ownerId.role || '')
        }
      : null,
    country: String(doc.country || ''),
    currency: String(doc.currency || ''),
    holderName: String(doc.holderName || ''),
    bankName: String(doc.bankName || ''),
    maskedAccountNumber: String(doc.accountNumberLast4 || '')
      ? `****${String(doc.accountNumberLast4)}`
      : '',
    ifsc: String(doc.ifsc || ''),
    branchName: String(doc.branchName || ''),
    accountType: doc.accountType || null,
    maskedUpiId: String(doc.upiIdMasked || ''),
    status: String(doc.status || 'PENDING') as AccountStatus,
    verifiedAt: doc.verifiedAt || null,
    verifiedBy: doc.verifiedBy
      ? {
          _id: String(doc.verifiedBy._id || ''),
          name: String(doc.verifiedBy.name || ''),
          email: String(doc.verifiedBy.email || '')
        }
      : null,
    rejectionReason: String(doc.rejectionReason || ''),
    isDefault: Boolean(doc.isDefault),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
};

const hasSensitiveChange = (current: any, patch: PayoutAccountPatchInput) => {
  const incomingKeys = Object.keys(patch || {});
  for (const key of incomingKeys) {
    if (!sensitiveKeys.has(key)) continue;
    if (key === 'accountNumber') return true;
    if (key === 'upiId') return true;
    const next = String((patch as any)[key] ?? '').trim();
    const prev = String(current?.[key] ?? '').trim();
    if (next !== prev) return true;
  }
  return false;
};

export const payoutAccountService = {
  async getMyAccount(userId: string) {
    const owner = await resolveOwner(userId);
    const doc = await payoutAccountRepository.findByOwner(owner.ownerType, owner.ownerId);
    return buildSafe(doc);
  },

  async createMyAccount(userId: string, input: PayoutAccountCreateInput) {
    const owner = await resolveOwner(userId);
    const existing = await payoutAccountRepository.findByOwner(owner.ownerType, owner.ownerId);
    if (existing?._id) throw createHttpError('Payout account already exists. Use update.', 409);

    const accountNumber = String(input.accountNumber || '').trim();
    const upiId = String(input.upiId || '').trim();
    const created = await payoutAccountRepository.createOne({
      ownerType: owner.ownerType,
      ownerId: new Types.ObjectId(owner.ownerId),
      country: String(input.country || process.env.DEFAULT_COUNTRY || 'IN').toUpperCase(),
      currency: String(input.currency || process.env.DEFAULT_CURRENCY || 'usd').toUpperCase(),
      holderName: String(input.holderName || '').trim(),
      bankName: String(input.bankName || '').trim(),
      accountNumberEncrypted: encryptBankValue(accountNumber),
      accountNumberLast4: accountNumber.slice(-4),
      ifsc: String(input.ifsc || '')
        .toUpperCase()
        .trim(),
      branchName: String(input.branchName || '').trim(),
      accountType: input.accountType || null,
      upiIdEncrypted: upiId ? encryptBankValue(upiId) : '',
      upiIdMasked: upiId ? maskUpiId(upiId) : '',
      isDefault: true,
      status: 'PENDING',
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId)
    });

    return buildSafe(created);
  },

  async patchMyAccount(userId: string, patch: PayoutAccountPatchInput) {
    const owner = await resolveOwner(userId);
    const current = await payoutAccountRepository.findByOwner(owner.ownerType, owner.ownerId);
    if (!current?._id) throw createHttpError('Payout account not found', 404);

    const updateSet: Record<string, any> = {
      updatedBy: new Types.ObjectId(userId),
      updatedAt: new Date()
    };
    if (patch.country !== undefined) updateSet.country = String(patch.country || '').toUpperCase();
    if (patch.currency !== undefined)
      updateSet.currency = String(patch.currency || '').toUpperCase();
    if (patch.holderName !== undefined)
      updateSet.holderName = String(patch.holderName || '').trim();
    if (patch.bankName !== undefined) updateSet.bankName = String(patch.bankName || '').trim();
    if (patch.accountNumber !== undefined) {
      const account = String(patch.accountNumber || '').trim();
      updateSet.accountNumberEncrypted = encryptBankValue(account);
      updateSet.accountNumberLast4 = account.slice(-4);
    }
    if (patch.ifsc !== undefined)
      updateSet.ifsc = String(patch.ifsc || '')
        .toUpperCase()
        .trim();
    if (patch.branchName !== undefined)
      updateSet.branchName = String(patch.branchName || '').trim();
    if (patch.accountType !== undefined) updateSet.accountType = patch.accountType || null;
    if (patch.upiId !== undefined) {
      const upi = String(patch.upiId || '').trim();
      updateSet.upiIdEncrypted = upi ? encryptBankValue(upi) : '';
      updateSet.upiIdMasked = upi ? maskUpiId(upi) : '';
    }

    if (hasSensitiveChange(current, patch)) {
      updateSet.status = 'PENDING';
      updateSet.verifiedAt = null;
      updateSet.verifiedBy = null;
      updateSet.rejectionReason = '';
    }

    const updated = await payoutAccountRepository.updateByOwner(owner.ownerType, owner.ownerId, {
      $set: updateSet
    });
    return buildSafe(updated);
  },

  async deleteMyAccount(userId: string) {
    const owner = await resolveOwner(userId);
    const deleted = await payoutAccountRepository.deleteByOwner(owner.ownerType, owner.ownerId);
    if (!deleted?._id) throw createHttpError('Payout account not found', 404);
    return { deleted: true };
  },

  async getByOwner(ownerType: OwnerType, ownerId: string) {
    const doc = await payoutAccountRepository.findByOwner(ownerType, ownerId);
    return buildSafe(doc);
  },

  async getByOwnerForPayout(ownerType: OwnerType, ownerId: string) {
    const doc = await payoutAccountRepository.findByOwner(ownerType, ownerId);
    if (!doc?._id) return null;
    return {
      _id: String((doc as any)._id || ''),
      holderName: String(doc.holderName || ''),
      bankName: String(doc.bankName || ''),
      maskedAccountNumber: String(doc.accountNumberLast4 || '')
        ? `****${String(doc.accountNumberLast4)}`
        : '',
      ifsc: String(doc.ifsc || ''),
      upiId: String(doc.upiIdMasked || ''),
      status: String(doc.status || 'PENDING'),
      rejectionReason: String((doc as any).rejectionReason || '')
    };
  },

  async listAdmin(filters: {
    ownerType?: OwnerType;
    status?: AccountStatus;
    q?: string;
    page: number;
    limit: number;
  }) {
    const result = await payoutAccountRepository.listForAdmin(filters);
    return {
      rows: result.rows.map(buildSafe),
      pagination: result.pagination
    };
  },

  async getAdminById(id: string) {
    if (!Types.ObjectId.isValid(id)) throw createHttpError('Invalid payout account id', 400);
    const doc = await payoutAccountRepository.findById(id);
    if (!doc?._id) throw createHttpError('Payout account not found', 404);
    return buildSafe(doc);
  },

  async verifyByAdmin(id: string, adminUserId: string) {
    if (!Types.ObjectId.isValid(id)) throw createHttpError('Invalid payout account id', 400);
    const updated = await payoutAccountRepository.updateById(id, {
      $set: {
        status: 'VERIFIED',
        verifiedAt: new Date(),
        verifiedBy: new Types.ObjectId(adminUserId),
        rejectionReason: '',
        updatedBy: new Types.ObjectId(adminUserId),
        updatedAt: new Date()
      }
    });
    if (!updated?._id) throw createHttpError('Payout account not found', 404);
    return buildSafe(updated);
  },

  async rejectByAdmin(id: string, adminUserId: string, reason: string) {
    if (!Types.ObjectId.isValid(id)) throw createHttpError('Invalid payout account id', 400);
    const updated = await payoutAccountRepository.updateById(id, {
      $set: {
        status: 'REJECTED',
        rejectionReason: String(reason || '').trim(),
        verifiedAt: null,
        verifiedBy: null,
        updatedBy: new Types.ObjectId(adminUserId),
        updatedAt: new Date()
      }
    });
    if (!updated?._id) throw createHttpError('Payout account not found', 404);
    return buildSafe(updated);
  },

  async getDecryptedAccountForInternalUse(ownerType: OwnerType, ownerId: string) {
    const doc = await payoutAccountRepository.findByOwnerWithSensitive(ownerType, ownerId);
    if (!doc?._id) return null;
    const decrypted = decryptBankValue(String((doc as any).accountNumberEncrypted || ''));
    return {
      accountNumber: decrypted,
      status: String(doc.status || 'PENDING')
    };
  }
};
