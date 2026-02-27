import { Types } from 'mongoose';
import PayoutModel from '../../../models/payout.model';
import TransactionModel from '../../../models/transaction.model';
import { User } from '../../../models/user.model';

const toObjectId = (value: string) => new Types.ObjectId(value);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MANUAL_ACTIVE_STATUSES = ['DRAFT', 'APPROVED', 'PAID'];

export const payoutRepository = {
  async findBlockingPayoutOverlap(args: {
    payeeType: 'TEACHER' | 'SCHOOL';
    payeeId: string;
    periodStart: Date;
    periodEnd: Date;
    excludePayoutId?: string;
  }) {
    const query: any = {
      payoutKind: 'MANUAL',
      payeeType: args.payeeType,
      payeeId: toObjectId(args.payeeId),
      status: { $in: ['APPROVED', 'PAID'] },
      periodStart: { $lte: args.periodEnd },
      periodEnd: { $gte: args.periodStart }
    };

    if (args.excludePayoutId && Types.ObjectId.isValid(args.excludePayoutId)) {
      query._id = { $ne: toObjectId(args.excludePayoutId) };
    }

    return PayoutModel.findOne(query).select('_id status periodStart periodEnd').lean();
  },

  async findManualPayoutByExactPeriod(args: {
    payeeType: 'TEACHER' | 'SCHOOL';
    payeeId: string;
    periodStart: Date;
    periodEnd: Date;
  }) {
    return PayoutModel.findOne({
      payoutKind: 'MANUAL',
      payeeType: args.payeeType,
      payeeId: toObjectId(args.payeeId),
      periodStart: args.periodStart,
      periodEnd: args.periodEnd
    })
      .select('_id status createdAt')
      .lean();
  },

  async findSettledTransactionsForPayee(args: {
    payeeType: 'TEACHER' | 'SCHOOL';
    payeeId: string;
    periodStart: Date;
    periodEnd: Date;
  }) {
    const payeeObjectId = toObjectId(args.payeeId);

    const payeeMatch =
      args.payeeType === 'TEACHER'
        ? {
            $or: [
              { payee: payeeObjectId, payeeType: 'teacher' },
              { payee: payeeObjectId, payeeType: null },
              { payee: payeeObjectId, payeeType: { $exists: false } },
              { 'courseDoc.ownerType': 'teacher', 'courseDoc.ownerId': payeeObjectId }
            ]
          }
        : {
            $or: [
              { payeeType: 'school', payee: payeeObjectId },
              { school: payeeObjectId },
              { payee: payeeObjectId },
              { 'courseDoc.ownerType': 'school', 'courseDoc.ownerId': payeeObjectId }
            ]
          };

    return TransactionModel.aggregate([
      {
        $match: {
          status: 'SUCCEEDED'
        }
      },
      {
        $addFields: {
          __settledAt: {
            $ifNull: ['$paidAt', '$createdAt']
          }
        }
      },
      {
        $match: {
          __settledAt: { $gte: args.periodStart, $lte: args.periodEnd }
        }
      },
      {
        $lookup: {
          from: 'bookings',
          localField: 'booking',
          foreignField: '_id',
          as: 'bookingDoc'
        }
      },
      {
        $unwind: {
          path: '$bookingDoc',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $lookup: {
          from: 'courses',
          localField: 'bookingDoc.course',
          foreignField: '_id',
          as: 'courseDoc'
        }
      },
      {
        $unwind: {
          path: '$courseDoc',
          preserveNullAndEmptyArrays: true
        }
      },
      { $match: payeeMatch },
      {
        $project: {
          _id: 1,
          amount: 1,
          platformFee: 1,
          netAmount: 1,
          currency: 1,
          status: 1,
          createdAt: '$__settledAt',
          paidAt: '$__settledAt',
          reference: 1,
          metadata: 1,
          payeeType: 1,
          payee: 1,
          school: 1,
          booking: {
            _id: '$bookingDoc._id',
            paymentStatus: '$bookingDoc.paymentStatus',
            isTrial: '$bookingDoc.isTrial',
            course: {
              _id: '$courseDoc._id',
              title: '$courseDoc.title',
              ownerType: '$courseDoc.ownerType',
              ownerId: '$courseDoc.ownerId'
            }
          }
        }
      }
    ]);
  },

  async findTransactionIdsAlreadyUsedInManualPayouts(transactionIds: string[]) {
    if (!transactionIds.length) return new Set<string>();

    const docs = await PayoutModel.find({
      payoutKind: 'MANUAL',
      status: { $in: MANUAL_ACTIVE_STATUSES },
      'lineItems.transactionId': {
        $in: transactionIds.filter(v => Types.ObjectId.isValid(v)).map(v => toObjectId(v))
      }
    })
      .select('lineItems.transactionId')
      .lean();

    const used = new Set<string>();
    docs.forEach((doc: any) => {
      (doc?.lineItems || []).forEach((item: any) => {
        if (item?.transactionId) used.add(String(item.transactionId));
      });
    });

    return used;
  },

  async createManualPayout(input: Record<string, any>) {
    return PayoutModel.create(input);
  },

  async replaceCancelledPayout(id: string, input: Record<string, any>) {
    return PayoutModel.findOneAndUpdate(
      {
        _id: id,
        payoutKind: 'MANUAL',
        status: 'CANCELLED'
      },
      {
        $set: {
          ...input,
          status: 'DRAFT',
          paymentRef: null,
          paidAt: null,
          paidBy: null,
          updatedAt: new Date()
        }
      },
      { new: true }
    )
      .populate('payeeId', 'name email role school')
      .populate('paidBy', 'name email role')
      .lean();
  },

  async listManualPayouts(args: {
    page: number;
    limit: number;
    search?: string;
    payeeType?: 'TEACHER' | 'SCHOOL';
    payeeId?: string;
    status?: 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED';
    from?: Date;
    to?: Date;
  }) {
    const query: any = { payoutKind: 'MANUAL' };

    if (args.payeeType) query.payeeType = args.payeeType;
    if (args.payeeId && Types.ObjectId.isValid(args.payeeId))
      query.payeeId = toObjectId(args.payeeId);
    if (args.status) query.status = args.status;
    if (args.from || args.to) {
      query.createdAt = {
        ...(args.from ? { $gte: args.from } : {}),
        ...(args.to ? { $lte: args.to } : {})
      };
    }

    const search = String(args.search || '').trim();
    if (search) {
      const regex = new RegExp(escapeRegExp(search), 'i');
      const matchingPayees = await User.find({
        $or: [{ name: regex }, { email: regex }]
      })
        .select('_id')
        .limit(200)
        .lean();

      const payeeIds = matchingPayees.map(user => user._id);
      if (!payeeIds.length) {
        return {
          rows: [],
          pagination: {
            total: 0,
            page: args.page,
            limit: args.limit,
            pages: 1,
            hasNextPage: false,
            hasPrevPage: args.page > 1
          }
        };
      }

      if (query.payeeId) {
        const currentPayeeId = String(query.payeeId);
        const found = payeeIds.some(id => String(id) === currentPayeeId);
        if (!found) {
          return {
            rows: [],
            pagination: {
              total: 0,
              page: args.page,
              limit: args.limit,
              pages: 1,
              hasNextPage: false,
              hasPrevPage: args.page > 1
            }
          };
        }
      } else {
        query.payeeId = { $in: payeeIds };
      }
    }

    const skip = (args.page - 1) * args.limit;

    const [rows, total] = await Promise.all([
      PayoutModel.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(args.limit)
        .populate('payeeId', 'name email role')
        .populate('paidBy', 'name email')
        .lean(),
      PayoutModel.countDocuments(query)
    ]);

    return {
      rows,
      pagination: {
        total,
        page: args.page,
        limit: args.limit,
        pages: Math.max(1, Math.ceil(total / args.limit)),
        hasNextPage: args.page * args.limit < total,
        hasPrevPage: args.page > 1
      }
    };
  },

  async getManualPayoutById(id: string) {
    return PayoutModel.findOne({ _id: id, payoutKind: 'MANUAL' })
      .populate('payeeId', 'name email role school')
      .populate('paidBy', 'name email role')
      .lean();
  },

  async approvePayout(id: string) {
    return PayoutModel.findOneAndUpdate(
      {
        _id: id,
        payoutKind: 'MANUAL',
        status: 'DRAFT'
      },
      {
        $set: {
          status: 'APPROVED',
          updatedAt: new Date()
        }
      },
      { new: true }
    )
      .populate('payeeId', 'name email role')
      .lean();
  },

  async markPaid(
    id: string,
    input: { paymentRef: string; paidAt: Date; paidBy: string; note?: string }
  ) {
    const existing = await PayoutModel.findOne({
      _id: id,
      payoutKind: 'MANUAL',
      status: 'APPROVED'
    })
      .select('metadata')
      .lean();
    const mergedMetadata = {
      ...(existing?.metadata || {}),
      ...(input.note ? { note: input.note } : {})
    };

    return PayoutModel.findOneAndUpdate(
      {
        _id: id,
        payoutKind: 'MANUAL',
        status: 'APPROVED'
      },
      {
        $set: {
          status: 'PAID',
          paymentRef: input.paymentRef,
          paidAt: input.paidAt,
          paidBy: toObjectId(input.paidBy),
          updatedAt: new Date(),
          metadata: mergedMetadata
        }
      },
      { new: true }
    )
      .populate('payeeId', 'name email role')
      .populate('paidBy', 'name email role')
      .lean();
  },

  async cancelPayout(id: string, note?: string) {
    const existing = await PayoutModel.findOne({
      _id: id,
      payoutKind: 'MANUAL',
      status: { $in: ['DRAFT', 'APPROVED'] }
    })
      .select('metadata')
      .lean();
    const mergedMetadata = {
      ...(existing?.metadata || {}),
      ...(note ? { note } : {})
    };

    return PayoutModel.findOneAndUpdate(
      {
        _id: id,
        payoutKind: 'MANUAL',
        status: { $in: ['DRAFT', 'APPROVED'] }
      },
      {
        $set: {
          status: 'CANCELLED',
          updatedAt: new Date(),
          metadata: mergedMetadata
        }
      },
      { new: true }
    )
      .populate('payeeId', 'name email role')
      .lean();
  }
};
