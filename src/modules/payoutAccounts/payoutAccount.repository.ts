import { FilterQuery, Types } from 'mongoose';
import { PayoutAccountModel } from '../../models/payoutAccount.model';
import { User } from '../../models/user.model';

const toObjectId = (id: string) => new Types.ObjectId(id);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const payoutAccountRepository = {
  async findByOwner(ownerType: 'TEACHER' | 'SCHOOL', ownerId: string) {
    return PayoutAccountModel.findOne({
      ownerType,
      ownerId: toObjectId(ownerId)
    })
      .populate('ownerId', 'name email role')
      .populate('verifiedBy', 'name email role')
      .lean();
  },

  async findByOwnerWithSensitive(ownerType: 'TEACHER' | 'SCHOOL', ownerId: string) {
    return PayoutAccountModel.findOne({
      ownerType,
      ownerId: toObjectId(ownerId)
    })
      .select('+accountNumberEncrypted +upiIdEncrypted')
      .populate('ownerId', 'name email role')
      .populate('verifiedBy', 'name email role')
      .lean();
  },

  async createOne(input: Record<string, any>) {
    return PayoutAccountModel.create(input);
  },

  async updateByOwner(
    ownerType: 'TEACHER' | 'SCHOOL',
    ownerId: string,
    update: Record<string, any>
  ) {
    return PayoutAccountModel.findOneAndUpdate(
      { ownerType, ownerId: toObjectId(ownerId) },
      update,
      { new: true }
    )
      .populate('ownerId', 'name email role')
      .populate('verifiedBy', 'name email role')
      .lean();
  },

  async deleteByOwner(ownerType: 'TEACHER' | 'SCHOOL', ownerId: string) {
    return PayoutAccountModel.findOneAndDelete({ ownerType, ownerId: toObjectId(ownerId) }).lean();
  },

  async listForAdmin(filters: {
    ownerType?: 'TEACHER' | 'SCHOOL';
    status?: 'PENDING' | 'VERIFIED' | 'REJECTED';
    q?: string;
    page: number;
    limit: number;
  }) {
    const query: FilterQuery<any> = {};
    if (filters.ownerType) query.ownerType = filters.ownerType;
    if (filters.status) query.status = filters.status;

    const search = String(filters.q || '').trim();
    if (search) {
      const regex = new RegExp(escapeRegExp(search), 'i');
      const users = await User.find({ $or: [{ name: regex }, { email: regex }] })
        .select('_id')
        .limit(200)
        .lean();
      const ids = users.map(u => u._id);
      if (!ids.length) {
        return {
          rows: [],
          pagination: {
            total: 0,
            page: filters.page,
            limit: filters.limit,
            pages: 1,
            hasNextPage: false,
            hasPrevPage: filters.page > 1
          }
        };
      }
      query.ownerId = { $in: ids };
    }

    const skip = (filters.page - 1) * filters.limit;
    const [rows, total] = await Promise.all([
      PayoutAccountModel.find(query)
        .sort({ updatedAt: -1, _id: -1 })
        .skip(skip)
        .limit(filters.limit)
        .populate('ownerId', 'name email role')
        .populate('verifiedBy', 'name email role')
        .lean(),
      PayoutAccountModel.countDocuments(query)
    ]);

    return {
      rows,
      pagination: {
        total,
        page: filters.page,
        limit: filters.limit,
        pages: Math.max(1, Math.ceil(total / filters.limit)),
        hasNextPage: filters.page * filters.limit < total,
        hasPrevPage: filters.page > 1
      }
    };
  },

  async findById(id: string) {
    return PayoutAccountModel.findById(id)
      .populate('ownerId', 'name email role')
      .populate('verifiedBy', 'name email role')
      .lean();
  },

  async updateById(id: string, update: Record<string, any>) {
    return PayoutAccountModel.findByIdAndUpdate(id, update, { new: true })
      .populate('ownerId', 'name email role')
      .populate('verifiedBy', 'name email role')
      .lean();
  }
};
