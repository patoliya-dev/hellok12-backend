import { PipelineStage, Types } from 'mongoose';
import payoutModel from '../../models/payout.model';
import TransactionModel from '../../models/transaction.model';
import { SalesTotals } from './earnings.calculations';

export type EarningsActorRole = 'teacher' | 'school';

const toObjectId = (value: string) => {
  if (!Types.ObjectId.isValid(value)) return null;
  return new Types.ObjectId(value);
};

const normalizeLegacyStatusToTransactionStatuses = (value?: string) => {
  const status = String(value || '')
    .trim()
    .toUpperCase();
  if (!status) return null;

  if (['PAID', 'SENT', 'SETTLED', 'SUCCEEDED', 'COMPLETED'].includes(status)) {
    return ['SUCCEEDED'];
  }

  if (['PENDING', 'PROCESSING'].includes(status)) {
    return ['PENDING', 'PROCESSING'];
  }

  if (['FAILED', 'REFUNDED'].includes(status)) {
    return [status];
  }

  return [];
};

const buildReceiverMatch = (
  role: EarningsActorRole,
  userObjId: Types.ObjectId
): PipelineStage.Match['$match'] => {
  if (role === 'school') {
    return {
      $or: [
        { payeeType: 'school', payee: userObjId },
        { school: userObjId },
        { payee: userObjId },
        { 'courseDoc.ownerType': 'school', 'courseDoc.ownerId': userObjId }
      ]
    };
  }

  return {
    $or: [
      { payeeType: 'teacher', payee: userObjId },
      { payee: userObjId, payeeType: null },
      { payee: userObjId, payeeType: { $exists: false } },
      { 'courseDoc.ownerType': 'teacher', 'courseDoc.ownerId': userObjId }
    ]
  };
};

const buildBaseSalesPipeline = (args: {
  role: EarningsActorRole;
  userObjId: Types.ObjectId;
  startDate: Date;
  endDate: Date;
  statuses?: string[];
}): PipelineStage[] => {
  const statuses = args.statuses?.length ? args.statuses : ['SUCCEEDED'];

  return [
    {
      $match: {
        status: { $in: statuses }
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
        __settledAt: { $gte: args.startDate, $lte: args.endDate }
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
    {
      $match: buildReceiverMatch(args.role, args.userObjId)
    },
    {
      $match: {
        $or: [
          { bookingDoc: null },
          {
            $and: [{ 'bookingDoc.paymentStatus': 'PAID' }, { 'bookingDoc.isTrial': { $ne: true } }]
          }
        ]
      }
    }
  ];
};

const totalsGroupStage: PipelineStage.Group = {
  $group: {
    _id: null,
    grossCents: { $sum: { $ifNull: ['$amount', 0] } },
    platformFeeCents: { $sum: { $ifNull: ['$platformFee', 0] } },
    netCents: {
      $sum: {
        $ifNull: [
          '$netAmount',
          { $subtract: [{ $ifNull: ['$amount', 0] }, { $ifNull: ['$platformFee', 0] }] }
        ]
      }
    }
  }
};

const buildPaidOutDateRangeOr = (startDate?: Date, endDate?: Date) => {
  if (!startDate && !endDate) return null;

  const range = {
    ...(startDate ? { $gte: startDate } : {}),
    ...(endDate ? { $lte: endDate } : {})
  };

  return [
    { paidAt: range },
    { paidAt: null, createdAt: range },
    { paidAt: { $exists: false }, createdAt: range }
  ];
};

const buildPayoutPayeeMatch = (userId: string, userObjId: Types.ObjectId) => ({
  $or: [
    { payeeId: userObjId },
    { toUser: userObjId },
    { 'metadata.raw.payoutReceiverId': String(userId) },
    { 'metadata.payoutReceiverId': String(userId) },
    { 'metadata.schoolId': String(userId) }
  ]
});

export const earningsRepositoryV2 = {
  async aggregateSalesTotals(args: {
    role: EarningsActorRole;
    userId: string;
    startDate: Date;
    endDate: Date;
    statuses?: string[];
  }): Promise<SalesTotals> {
    const userObjId = toObjectId(args.userId);
    if (!userObjId) {
      return { grossCents: 0, platformFeeCents: 0, netCents: 0 };
    }

    const pipeline = buildBaseSalesPipeline({
      role: args.role,
      userObjId,
      startDate: args.startDate,
      endDate: args.endDate,
      statuses: args.statuses
    });
    pipeline.push(totalsGroupStage);

    const result = await TransactionModel.aggregate(pipeline);
    return {
      grossCents: Number(result?.[0]?.grossCents || 0),
      platformFeeCents: Number(result?.[0]?.platformFeeCents || 0),
      netCents: Number(result?.[0]?.netCents || 0)
    };
  },

  async aggregateSalesByRangeBucket(args: {
    role: EarningsActorRole;
    userId: string;
    bucket: 'week' | 'month' | 'year';
    startDate: Date;
    endDate: Date;
  }) {
    const userObjId = toObjectId(args.userId);
    if (!userObjId) return [];

    const pipeline = buildBaseSalesPipeline({
      role: args.role,
      userObjId,
      startDate: args.startDate,
      endDate: args.endDate
    });

    const groupId =
      args.bucket === 'week'
        ? { y: { $isoWeekYear: '$__settledAt' }, w: { $isoWeek: '$__settledAt' } }
        : args.bucket === 'month'
          ? { y: { $year: '$__settledAt' }, m: { $month: '$__settledAt' } }
          : { y: { $year: '$__settledAt' } };

    pipeline.push({
      $group: {
        _id: groupId,
        grossCents: { $sum: { $ifNull: ['$amount', 0] } },
        platformFeeCents: { $sum: { $ifNull: ['$platformFee', 0] } },
        netCents: {
          $sum: {
            $ifNull: [
              '$netAmount',
              { $subtract: [{ $ifNull: ['$amount', 0] }, { $ifNull: ['$platformFee', 0] }] }
            ]
          }
        }
      }
    });

    pipeline.push({
      $sort:
        args.bucket === 'week'
          ? { '_id.y': 1, '_id.w': 1 }
          : args.bucket === 'month'
            ? { '_id.y': 1, '_id.m': 1 }
            : { '_id.y': 1 }
    });

    return TransactionModel.aggregate(pipeline);
  },

  async listSalesEntries(args: {
    role: EarningsActorRole;
    userId: string;
    lessonType?: string;
    status?: string;
    minAmount?: number;
    maxAmount?: number;
    startDate?: Date;
    endDate?: Date;
    page: number;
    limit: number;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
  }) {
    const userObjId = toObjectId(args.userId);
    if (!userObjId) {
      return {
        rows: [],
        pagination: { total: 0, page: args.page, limit: args.limit, totalPages: 0 }
      };
    }

    const statuses = normalizeLegacyStatusToTransactionStatuses(args.status);
    if (Array.isArray(statuses) && statuses.length === 0) {
      return {
        rows: [],
        pagination: { total: 0, page: args.page, limit: args.limit, totalPages: 0 }
      };
    }

    const basePipeline = buildBaseSalesPipeline({
      role: args.role,
      userObjId,
      startDate: args.startDate || new Date(0),
      endDate: args.endDate || new Date(),
      statuses: statuses || undefined
    });

    if (args.lessonType) {
      basePipeline.push({ $match: { 'courseDoc.lessonType': args.lessonType } });
    }

    if (typeof args.minAmount === 'number' || typeof args.maxAmount === 'number') {
      const minCents = typeof args.minAmount === 'number' ? Math.max(0, args.minAmount * 100) : 0;
      const maxCents =
        typeof args.maxAmount === 'number'
          ? Math.max(minCents, args.maxAmount * 100)
          : Number.MAX_SAFE_INTEGER;

      basePipeline.push({
        $addFields: {
          __netCents: {
            $ifNull: [
              '$netAmount',
              { $subtract: [{ $ifNull: ['$amount', 0] }, { $ifNull: ['$platformFee', 0] }] }
            ]
          }
        }
      });

      basePipeline.push({ $match: { __netCents: { $gte: minCents, $lte: maxCents } } });
    }

    const sortFieldMap: Record<string, string> = {
      date: '__settledAt',
      createdAt: '__settledAt',
      amount: '__netCents',
      description: 'lessonService',
      lessonService: 'lessonService'
    };

    const sortField = sortFieldMap[args.sortBy] || '__settledAt';
    const sortDirection = args.sortOrder === 'asc' ? 1 : -1;
    const skip = (args.page - 1) * args.limit;

    const projectionAndNormalize: PipelineStage[] = [
      {
        $addFields: {
          __netCents: {
            $ifNull: [
              '$netAmount',
              { $subtract: [{ $ifNull: ['$amount', 0] }, { $ifNull: ['$platformFee', 0] }] }
            ]
          },
          lessonService: {
            $ifNull: [
              '$courseDoc.title',
              { $ifNull: ['$title', { $ifNull: ['$reference', 'Purchase'] }] }
            ]
          }
        }
      }
    ];

    const countPipeline = [...basePipeline, ...projectionAndNormalize, { $count: 'total' }];
    const dataPipeline: PipelineStage[] = [
      ...basePipeline,
      ...projectionAndNormalize,
      { $sort: { [sortField]: sortDirection, _id: 1 } as any },
      { $skip: skip },
      { $limit: args.limit },
      {
        $project: {
          _id: 1,
          date: '$__settledAt',
          lessonService: 1,
          lessonType: '$courseDoc.lessonType',
          amountCents: '$__netCents',
          status: '$status'
        }
      },
      {
        $addFields: {
          amount: { $divide: ['$amountCents', 100] }
        }
      }
    ];

    const [rows, count] = await Promise.all([
      TransactionModel.aggregate(dataPipeline),
      TransactionModel.aggregate(countPipeline)
    ]);

    const total = Number(count?.[0]?.total || 0);
    return {
      rows,
      pagination: {
        total,
        page: args.page,
        limit: args.limit,
        totalPages: Math.ceil(total / args.limit)
      }
    };
  },

  async aggregatePaidOutTotals(args: { userId: string; startDate?: Date; endDate?: Date }) {
    const userObjId = toObjectId(args.userId);
    if (!userObjId) return 0;

    const query: any = {
      status: { $in: ['PAID', 'SETTLED'] },
      ...buildPayoutPayeeMatch(args.userId, userObjId)
    };

    const dateRangeOr = buildPaidOutDateRangeOr(args.startDate, args.endDate);
    if (dateRangeOr) {
      query.$and = [{ $or: dateRangeOr }];
    }

    const result = await payoutModel.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalCents: { $sum: { $ifNull: ['$netAmount', { $ifNull: ['$amount', 0] }] } }
        }
      }
    ]);

    return Number(result?.[0]?.totalCents || 0);
  },

  async listPaidOutPayouts(args: {
    userId: string;
    startDate?: Date;
    endDate?: Date;
    page: number;
    limit: number;
  }) {
    const userObjId = toObjectId(args.userId);
    if (!userObjId) {
      return {
        rows: [],
        pagination: {
          total: 0,
          page: args.page,
          limit: args.limit,
          totalPages: 0
        }
      };
    }

    const query: any = {
      status: { $in: ['PAID', 'SETTLED'] },
      ...buildPayoutPayeeMatch(args.userId, userObjId)
    };

    const dateRangeOr = buildPaidOutDateRangeOr(args.startDate, args.endDate);
    if (dateRangeOr) {
      query.$and = [{ $or: dateRangeOr }];
    }

    const skip = (args.page - 1) * args.limit;
    const [rows, total] = await Promise.all([
      payoutModel
        .find(query)
        .populate({ path: 'transaction', select: 'downloadUrl reference' })
        .populate({ path: 'invoice', select: 'invoiceNumber' })
        .sort({ paidAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(args.limit)
        .lean(),
      payoutModel.countDocuments(query)
    ]);

    return {
      rows,
      pagination: {
        total,
        page: args.page,
        limit: args.limit,
        totalPages: Math.ceil(total / args.limit)
      }
    };
  }
};
