import { Types } from 'mongoose';
import TransactionModel from '../../../models/transaction.model';
import PayoutModel from '../../../models/payout.model';

const clampInt = (v: any, min: number, max: number, fallback: number) => {
  const n = parseInt(String(v || ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toUSD = (cents: any) => {
  const n = Number(cents || 0);
  if (!Number.isFinite(n)) return 0;
  return Number((n / 100).toFixed(2));
};

const PAYOUT_COMPLETED_STATUSES = ['SENT', 'SETTLED', 'PAID'];
const REPORT_DETAIL_ROW_LIMIT = 3000;

function parseDateRange(startDate?: string, endDate?: string) {
  const range: any = {};
  const safeStart = parseDateInput(startDate, 'startDate');
  const safeEnd = parseDateInput(endDate, 'endDate', true);
  if (safeStart) range.$gte = safeStart;
  if (safeEnd) range.$lte = safeEnd;
  if (safeStart && safeEnd && safeStart > safeEnd) {
    const err: any = new Error('Invalid date range: startDate cannot be after endDate');
    err.statusCode = 400;
    throw err;
  }
  return Object.keys(range).length ? range : null;
}

function parseDateInput(
  value: string | undefined,
  field: 'startDate' | 'endDate',
  endOfDay = false
) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const err: any = new Error(`Invalid ${field}`);
    err.statusCode = 400;
    throw err;
  }

  if (endOfDay) {
    parsed.setHours(23, 59, 59, 999);
  } else {
    parsed.setHours(0, 0, 0, 0);
  }
  return parsed;
}

type SortOrder = 'asc' | 'desc';

function normalizeSortOrder(value?: string): SortOrder {
  return String(value || '').toLowerCase() === 'asc' ? 'asc' : 'desc';
}

function getPayoutSortStage(sortBy?: string, sortOrder: SortOrder = 'desc') {
  if (!sortBy) return { createdAt: -1 as const, _id: 1 as const };
  const order = sortOrder === 'asc' ? 1 : -1;

  switch (sortBy) {
    case 'amount':
      return { netAmount: order, _id: 1 as const };
    case 'instructor':
    case 'instructorName':
      return { 'sp.schoolName': order, 'toUserDoc.name': order, _id: 1 as const };
    case 'date':
    case 'createdAt':
      return { createdAt: order, _id: 1 as const };
    default:
      return { createdAt: -1 as const, _id: 1 as const };
  }
}

function getRevenueSortStage(sortBy?: string, sortOrder: SortOrder = 'desc') {
  if (!sortBy) return { amountCents: -1 as const, _id: 1 as const };
  const order = sortOrder === 'asc' ? 1 : -1;

  switch (sortBy) {
    case 'amount':
      return { amountCents: order, _id: 1 as const };
    case 'transactions':
      return { transactions: order, _id: 1 as const };
    case 'course':
    case 'courseTitle':
      return { courseTitle: order, _id: 1 as const };
    case 'date':
    case 'createdAt':
    case 'lastDate':
      return { lastDate: order, _id: 1 as const };
    default:
      return { amountCents: -1 as const, _id: 1 as const };
  }
}

function getCommissionSortStage(sortBy?: string, sortOrder: SortOrder = 'desc') {
  if (!sortBy) return { lastDate: -1 as const, _id: 1 as const };
  const order = sortOrder === 'asc' ? 1 : -1;

  switch (sortBy) {
    case 'enrollments':
      return { enrollments: order, _id: 1 as const };
    case 'rate':
      return { rateNum: order, _id: 1 as const };
    case 'earned':
      return { earnedCents: order, _id: 1 as const };
    case 'course':
    case 'courseTitle':
      return { courseTitle: order, _id: 1 as const };
    case 'date':
    case 'createdAt':
    case 'lastDate':
      return { lastDate: order, _id: 1 as const };
    default:
      return { lastDate: -1 as const, _id: 1 as const };
  }
}

// -------- summary helpers (month-over-month like screenshots) --------
function monthRange(offsetMonths: number) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function pctChange(current: number, previous: number) {
  if (!Number.isFinite(previous) || previous <= 0) return current > 0 ? 100 : 0;
  const v = ((current - previous) / previous) * 100;
  const out = Number(v.toFixed(1));
  return Object.is(out, -0) ? 0 : out;
}

// -------- trend buckets --------
type TrendPeriod = 'weekly' | 'monthly' | 'yearly';
type TrendTab = 'payout' | 'revenue' | 'commission';
type SummaryPeriod = TrendPeriod;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function startOfIsoWeek(d: Date) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0..6, Sunday=0
  const diffToMonday = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diffToMonday);
  return x;
}

function endOfIsoWeek(d: Date) {
  const x = startOfIsoWeek(d);
  x.setDate(x.getDate() + 6);
  return endOfDay(x);
}

function toDateWindow(
  currentStart: Date,
  currentNaturalEnd: Date,
  previousStart: Date,
  previousNaturalEnd: Date,
  now: Date
) {
  const currentEnd = now < currentNaturalEnd ? now : currentNaturalEnd;
  const elapsedMs = Math.max(0, currentEnd.getTime() - currentStart.getTime());
  const previousByElapsed = new Date(previousStart.getTime() + elapsedMs);
  const previousEnd =
    previousByElapsed < previousNaturalEnd ? previousByElapsed : previousNaturalEnd;

  return {
    current: { start: currentStart, end: currentEnd },
    previous: { start: previousStart, end: previousEnd }
  };
}

function getSummaryWindows(period: SummaryPeriod) {
  const now = new Date();

  if (period === 'weekly') {
    const currentStart = startOfIsoWeek(now);
    const previousStart = new Date(currentStart);
    previousStart.setDate(previousStart.getDate() - 7);
    const windows = toDateWindow(
      currentStart,
      endOfIsoWeek(currentStart),
      previousStart,
      endOfIsoWeek(previousStart),
      now
    );

    return {
      ...windows,
      comparisonPeriod: 'vs previous week'
    };
  }

  if (period === 'yearly') {
    const y = now.getFullYear();
    const currentStart = new Date(y, 0, 1, 0, 0, 0, 0);
    const currentNaturalEnd = new Date(y, 11, 31, 23, 59, 59, 999);
    const previousStart = new Date(y - 1, 0, 1, 0, 0, 0, 0);
    const previousNaturalEnd = new Date(y - 1, 11, 31, 23, 59, 59, 999);
    const windows = toDateWindow(
      currentStart,
      currentNaturalEnd,
      previousStart,
      previousNaturalEnd,
      now
    );

    return {
      ...windows,
      comparisonPeriod: 'vs previous year'
    };
  }

  const current = monthRange(0);
  const previous = monthRange(-1);
  const windows = toDateWindow(current.start, current.end, previous.start, previous.end, now);

  return {
    ...windows,
    comparisonPeriod: 'vs previous month'
  };
}

function buildTrendBuckets(period: TrendPeriod) {
  const now = new Date();

  if (period === 'weekly') {
    // last 12 weeks
    const start = new Date(now);
    start.setDate(now.getDate() - 11 * 7);
    start.setHours(0, 0, 0, 0);

    const labels = Array.from({ length: 12 }).map((_, i) => `Week ${i + 1}`);
    return { start, end: now, labels, type: 'weekly' as const };
  }

  if (period === 'monthly') {
    // current year 12 months
    const start = new Date(now.getFullYear(), 0, 1);
    const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    const labels = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec'
    ];
    return { start, end, labels, type: 'monthly' as const, year: now.getFullYear() };
  }

  // yearly: last 5 years
  const start = new Date(now.getFullYear() - 4, 0, 1);
  const end = now;
  const labels = Array.from({ length: 5 }).map((_, i) => String(now.getFullYear() - (4 - i)));
  return { start, end, labels, type: 'yearly' as const };
}

function pdfSafeText(v: any) {
  const ascii = String(v ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '?');

  return ascii
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildPdfFromStreams(pageStreams: string[]) {
  const objects: string[] = [];
  const objectIds: number[] = [];
  let currentObjectId = 1;

  // 1: catalog
  objectIds.push(currentObjectId++);
  // 2: pages root
  objectIds.push(currentObjectId++);
  // 3: regular font
  objectIds.push(currentObjectId++);
  // 4: bold font
  objectIds.push(currentObjectId++);

  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];

  for (let i = 0; i < pageStreams.length; i++) {
    pageObjectIds.push(currentObjectId++);
    contentObjectIds.push(currentObjectId++);
  }

  objects[objectIds[0]] = `<< /Type /Catalog /Pages ${objectIds[1]} 0 R >>`;
  objects[objectIds[1]] = `<< /Type /Pages /Count ${pageStreams.length} /Kids [${pageObjectIds
    .map(id => `${id} 0 R`)
    .join(' ')}] >>`;
  objects[objectIds[2]] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[objectIds[3]] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

  for (let i = 0; i < pageStreams.length; i++) {
    const content = pageStreams[i];
    const pageObjectId = pageObjectIds[i];
    const contentObjectId = contentObjectIds[i];

    objects[pageObjectId] =
      `<< /Type /Page /Parent ${objectIds[1]} 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${objectIds[2]} 0 R /F2 ${objectIds[3]} 0 R >> >> ` +
      `/Contents ${contentObjectId} 0 R >>`;

    objects[contentObjectId] =
      `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`;
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 1; i < objects.length; i++) {
    if (!objects[i]) continue;
    offsets[i] = Buffer.byteLength(pdf, 'utf8');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < objects.length; i++) {
    const off = offsets[i] || 0;
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root ${objectIds[0]} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'utf8');
}

function fileNameSafe(v: string) {
  return (
    v
      .replace(/[^a-z0-9\-_]+/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'report'
  );
}

const approxTextWidth = (text: string, fontSize: number) => text.length * fontSize * 0.52;

function fitTextToWidth(text: string, maxWidth: number, fontSize: number) {
  const raw = String(text || '');
  if (maxWidth <= 0) return '';
  const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * 0.52)));
  if (raw.length <= maxChars) return raw;
  if (maxChars <= 2) return raw.slice(0, maxChars);
  return `${raw.slice(0, maxChars - 3)}...`;
}

function pdfText(x: number, y: number, text: string, fontSize = 10, font: 'F1' | 'F2' = 'F1') {
  return `BT /${font} ${fontSize} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfSafeText(text)}) Tj ET`;
}

function pdfLine(x1: number, y1: number, x2: number, y2: number) {
  return `${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`;
}

function pdfFillRect(x: number, y: number, w: number, h: number, gray: number) {
  const g = Math.max(0, Math.min(1, gray));
  return `q ${g.toFixed(3)} g ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f Q`;
}

function pdfStrokeRect(x: number, y: number, w: number, h: number) {
  return `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`;
}

export const adminFinancialService = {
  // ---------------- SUMMARY CARDS ----------------
  getSummary: async ({ period }: { period: SummaryPeriod }) => {
    const windows = getSummaryWindows(period);

    const [thisRevenue, lastRevenue, thisCommission, lastCommission, thisPayout, lastPayout] =
      await Promise.all([
        // total earnings: transactions amount (cents)
        TransactionModel.aggregate([
          {
            $match: {
              status: { $in: ['SUCCEEDED'] },
              createdAt: { $gte: windows.current.start, $lte: windows.current.end }
            }
          },
          { $group: { _id: null, total: { $sum: { $ifNull: ['$amount', 0] } } } }
        ]),
        TransactionModel.aggregate([
          {
            $match: {
              status: { $in: ['SUCCEEDED'] },
              createdAt: { $gte: windows.previous.start, $lte: windows.previous.end }
            }
          },
          { $group: { _id: null, total: { $sum: { $ifNull: ['$amount', 0] } } } }
        ]),

        // commission: sum platformFee (cents)
        TransactionModel.aggregate([
          {
            $match: {
              status: { $in: ['SUCCEEDED'] },
              createdAt: { $gte: windows.current.start, $lte: windows.current.end }
            }
          },
          { $group: { _id: null, total: { $sum: { $ifNull: ['$platformFee', 0] } } } }
        ]),
        TransactionModel.aggregate([
          {
            $match: {
              status: { $in: ['SUCCEEDED'] },
              createdAt: { $gte: windows.previous.start, $lte: windows.previous.end }
            }
          },
          { $group: { _id: null, total: { $sum: { $ifNull: ['$platformFee', 0] } } } }
        ]),

        // payouts: sum netAmount (cents)
        PayoutModel.aggregate([
          {
            $match: {
              status: { $in: PAYOUT_COMPLETED_STATUSES },
              createdAt: { $gte: windows.current.start, $lte: windows.current.end }
            }
          },
          { $group: { _id: null, total: { $sum: { $ifNull: ['$netAmount', 0] } } } }
        ]),
        PayoutModel.aggregate([
          {
            $match: {
              status: { $in: PAYOUT_COMPLETED_STATUSES },
              createdAt: { $gte: windows.previous.start, $lte: windows.previous.end }
            }
          },
          { $group: { _id: null, total: { $sum: { $ifNull: ['$netAmount', 0] } } } }
        ])
      ]);

    const revenueNow = toUSD(thisRevenue?.[0]?.total || 0);
    const revenuePrev = toUSD(lastRevenue?.[0]?.total || 0);

    const commissionNow = toUSD(thisCommission?.[0]?.total || 0);
    const commissionPrev = toUSD(lastCommission?.[0]?.total || 0);

    const payoutNow = toUSD(thisPayout?.[0]?.total || 0);
    const payoutPrev = toUSD(lastPayout?.[0]?.total || 0);

    return {
      totalPayouts: {
        amount: payoutNow,
        percentageChange: pctChange(payoutNow, payoutPrev),
        comparisonPeriod: windows.comparisonPeriod
      },
      commissionEarnings: {
        amount: commissionNow,
        percentageChange: pctChange(commissionNow, commissionPrev),
        comparisonPeriod: windows.comparisonPeriod
      },
      totalEarnings: {
        amount: revenueNow,
        percentageChange: pctChange(revenueNow, revenuePrev),
        comparisonPeriod: windows.comparisonPeriod
      }
    };
  },

  // ---------------- TREND (chart) ----------------
  getTrend: async ({ tab, period }: { tab: TrendTab; period: TrendPeriod }) => {
    const bucket = buildTrendBuckets(period);

    // choose source + amount field in cents
    const isPayout = tab === 'payout';
    const isCommission = tab === 'commission';

    const Model: any = isPayout ? PayoutModel : TransactionModel;

    const match: any = isPayout
      ? {
          status: { $in: PAYOUT_COMPLETED_STATUSES },
          createdAt: { $gte: bucket.start, $lte: bucket.end }
        }
      : { status: { $in: ['SUCCEEDED'] }, createdAt: { $gte: bucket.start, $lte: bucket.end } };

    const sumField = isPayout ? '$netAmount' : isCommission ? '$platformFee' : '$amount';

    let groupId: any;
    let sort: any;

    if (period === 'weekly') {
      groupId = { y: { $isoWeekYear: '$createdAt' }, w: { $isoWeek: '$createdAt' } };
      sort = { '_id.y': 1, '_id.w': 1 };
    } else if (period === 'monthly') {
      groupId = { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } };
      sort = { '_id.y': 1, '_id.m': 1 };
    } else {
      groupId = { y: { $year: '$createdAt' } };
      sort = { '_id.y': 1 };
    }

    const rows = await Model.aggregate([
      { $match: match },
      { $group: { _id: groupId, total: { $sum: { $ifNull: [sumField, 0] } } } },
      { $sort: sort }
    ]);
    const amountByBucket = new Map<string, number>();
    rows.forEach((r: any) => {
      if (period === 'weekly') {
        amountByBucket.set(`${r?._id?.y}-${r?._id?.w}`, Number(r?.total || 0));
        return;
      }
      if (period === 'monthly') {
        amountByBucket.set(`${r?._id?.y}-${r?._id?.m}`, Number(r?.total || 0));
        return;
      }
      amountByBucket.set(String(r?._id?.y), Number(r?.total || 0));
    });

    // format to chart points matching FE (label + amount in USD)
    const dataPoints: Array<{ label: string; amount: number }> = [];

    if (period === 'weekly') {
      // generate 12 points in order
      const now = new Date();
      for (let i = 0; i < 12; i++) {
        const d = new Date(now);
        d.setDate(now.getDate() - (11 - i) * 7);

        // get iso week/year using JS trick
        const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const dayNum = tmp.getUTCDay() || 7;
        tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
        const isoYear = tmp.getUTCFullYear();
        const yearStart = new Date(Date.UTC(isoYear, 0, 1));
        const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

        dataPoints.push({
          label: bucket.labels[i],
          amount: toUSD(amountByBucket.get(`${isoYear}-${weekNo}`) || 0)
        });
      }
    } else if (period === 'monthly') {
      for (let m = 1; m <= 12; m++) {
        dataPoints.push({
          label: bucket.labels[m - 1],
          amount: toUSD(amountByBucket.get(`${bucket.year}-${m}`) || 0)
        });
      }
    } else {
      // last 5 years
      const nowY = new Date().getFullYear();
      for (let i = 4; i >= 0; i--) {
        const year = nowY - i;
        dataPoints.push({
          label: String(year),
          amount: toUSD(amountByBucket.get(String(year)) || 0)
        });
      }
    }

    return { period, dataPoints };
  },

  // ---------------- PAYOUT TABLE ----------------
  listPayouts: async ({
    page,
    limit,
    search,
    sortBy,
    sortOrder,
    startDate,
    endDate
  }: {
    page: string;
    limit: string;
    search: string;
    sortBy?: string;
    sortOrder?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    const pageNum = clampInt(page, 1, 100000, 1);
    const limitNum = clampInt(limit, 1, 200, 10);
    const skip = (pageNum - 1) * limitNum;

    const dateRange = parseDateRange(startDate, endDate);
    const order = normalizeSortOrder(sortOrder);
    const sortStage = getPayoutSortStage(sortBy, order);

    // Join: payouts -> toUser -> schoolProfile (optional) + transaction reference
    // Search should match teacher/school name OR schoolProfile.schoolName
    const term = String(search || '').trim();
    const rx = term ? new RegExp(escapeRegex(term), 'i') : null;

    const pipeline: any[] = [
      {
        $match: {
          status: { $in: PAYOUT_COMPLETED_STATUSES },
          ...(dateRange ? { createdAt: dateRange } : {})
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'toUser',
          foreignField: '_id',
          as: 'toUserDoc'
        }
      },
      { $unwind: { path: '$toUserDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'schoolprofiles',
          localField: 'toUserDoc._id',
          foreignField: 'user',
          as: 'sp'
        }
      },
      { $unwind: { path: '$sp', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'transactions',
          localField: 'transaction',
          foreignField: '_id',
          as: 'tx'
        }
      },
      { $unwind: { path: '$tx', preserveNullAndEmptyArrays: true } }
    ];

    if (rx) {
      pipeline.push({
        $match: {
          $or: [{ 'toUserDoc.name': rx }, { 'toUserDoc.email': rx }, { 'sp.schoolName': rx }]
        }
      });
    }

    const countPipeline = [...pipeline, { $count: 'total' }];

    pipeline.push(
      { $sort: sortStage },
      { $skip: skip },
      { $limit: limitNum },
      {
        $project: {
          createdAt: 1,
          amount: { $ifNull: ['$netAmount', 0] }, // cents
          transactionId: { $ifNull: ['$tx.reference', { $ifNull: ['$tx.stripeTransferId', '—'] }] },
          instructorName: {
            $ifNull: ['$sp.schoolName', { $ifNull: ['$toUserDoc.name', '—'] }]
          },
          downloadUrl: { $ifNull: ['$tx.downloadUrl', null] }
        }
      }
    );

    const [rows, cnt] = await Promise.all([
      PayoutModel.aggregate(pipeline).allowDiskUse(true),
      PayoutModel.aggregate(countPipeline).allowDiskUse(true)
    ]);

    const total = cnt?.[0]?.total || 0;
    const pages = Math.max(1, Math.ceil(total / limitNum));

    return {
      rows: rows.map((r: any) => ({
        instructorName: r.instructorName,
        amount: toUSD(r.amount),
        transactionId: r.transactionId,
        downloadUrl: r.downloadUrl
      })),
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages,
        hasNextPage: pageNum < pages,
        hasPrevPage: pageNum > 1
      }
    };
  },

  // ---------------- REVENUE TABLE ----------------
  listRevenue: async ({
    page,
    limit,
    search,
    sortBy,
    sortOrder,
    startDate,
    endDate
  }: {
    page: string;
    limit: string;
    search: string;
    sortBy?: string;
    sortOrder?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    const pageNum = clampInt(page, 1, 100000, 1);
    const limitNum = clampInt(limit, 1, 200, 10);
    const skip = (pageNum - 1) * limitNum;

    const dateRange = parseDateRange(startDate, endDate);
    const term = String(search || '').trim();
    const rx = term ? new RegExp(escapeRegex(term), 'i') : null;
    const order = normalizeSortOrder(sortOrder);
    const sortStage = getRevenueSortStage(sortBy, order);

    const pipeline: any[] = [
      {
        $match: {
          status: { $in: ['SUCCEEDED'] },
          ...(dateRange ? { createdAt: dateRange } : {})
        }
      },
      // transaction -> booking -> course
      {
        $lookup: {
          from: 'bookings',
          localField: 'booking',
          foreignField: '_id',
          as: 'bookingDoc'
        }
      },
      { $unwind: { path: '$bookingDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'courses',
          localField: 'bookingDoc.course',
          foreignField: '_id',
          as: 'courseDoc'
        }
      },
      { $unwind: { path: '$courseDoc', preserveNullAndEmptyArrays: true } }
    ];

    if (rx) {
      pipeline.push({ $match: { 'courseDoc.title': rx } });
    }

    // Prefer rows backed by transactions that already have a downloadable receipt/invoice URL.
    pipeline.push(
      {
        $addFields: {
          hasDownloadUrl: {
            $cond: [
              {
                $and: [{ $ne: ['$downloadUrl', null] }, { $ne: ['$downloadUrl', ''] }]
              },
              1,
              0
            ]
          }
        }
      },
      { $sort: { hasDownloadUrl: -1, createdAt: -1, _id: 1 } }
    );

    // group by course
    pipeline.push({
      $group: {
        _id: '$courseDoc._id',
        courseTitle: { $first: { $ifNull: ['$courseDoc.title', 'Untitled Course'] } },
        amountCents: { $sum: { $ifNull: ['$amount', 0] } },
        transactions: { $sum: 1 },
        lastDate: { $max: '$createdAt' },
        downloadUrl: { $first: { $ifNull: ['$downloadUrl', null] } }
      }
    });

    const countPipeline = [...pipeline, { $count: 'total' }];

    pipeline.push({ $sort: sortStage }, { $skip: skip }, { $limit: limitNum });

    const [rows, cnt] = await Promise.all([
      TransactionModel.aggregate(pipeline).allowDiskUse(true),
      TransactionModel.aggregate(countPipeline).allowDiskUse(true)
    ]);

    const total = cnt?.[0]?.total || 0;
    const pages = Math.max(1, Math.ceil(total / limitNum));

    return {
      rows: rows.map((r: any) => ({
        courseId: r._id ? String(r._id) : null,
        courseTitle: r.courseTitle,
        amount: toUSD(r.amountCents),
        transactions: r.transactions,
        downloadUrl: r.downloadUrl
      })),
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages,
        hasNextPage: pageNum < pages,
        hasPrevPage: pageNum > 1
      }
    };
  },

  getRevenueReportPdf: async ({
    courseId,
    startDate,
    endDate
  }: {
    courseId: string;
    startDate?: string;
    endDate?: string;
  }) => {
    if (!Types.ObjectId.isValid(courseId)) {
      const err: any = new Error('Invalid course id');
      err.statusCode = 400;
      throw err;
    }

    const courseObj = new Types.ObjectId(courseId);
    const dateRange = parseDateRange(startDate, endDate);

    const basePipeline: any[] = [
      {
        $match: {
          status: { $in: ['SUCCEEDED'] },
          ...(dateRange ? { createdAt: dateRange } : {})
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
      { $unwind: { path: '$bookingDoc', preserveNullAndEmptyArrays: false } },
      { $match: { 'bookingDoc.course': courseObj } },
      {
        $lookup: {
          from: 'courses',
          localField: 'bookingDoc.course',
          foreignField: '_id',
          as: 'courseDoc'
        }
      },
      { $unwind: { path: '$courseDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          localField: 'payer',
          foreignField: '_id',
          as: 'payerDoc'
        }
      },
      { $unwind: { path: '$payerDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          localField: 'bookingDoc.student',
          foreignField: '_id',
          as: 'studentDoc'
        }
      },
      { $unwind: { path: '$studentDoc', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          amount: { $ifNull: ['$amount', 0] },
          createdAt: 1,
          reference: { $ifNull: ['$reference', '-'] },
          courseTitle: { $ifNull: ['$courseDoc.title', 'Untitled Course'] },
          payerRole: { $ifNull: ['$payerDoc.role', '-'] },
          payerName: { $ifNull: ['$payerDoc.name', 'Unknown User'] },
          payerEmail: { $ifNull: ['$payerDoc.email', '-'] },
          studentName: { $ifNull: ['$studentDoc.name', '-'] },
          studentEmail: { $ifNull: ['$studentDoc.email', '-'] }
        }
      }
    ];

    const reportAgg = await TransactionModel.aggregate([
      ...basePipeline,
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                totalEnrollments: { $sum: 1 },
                totalCents: { $sum: { $ifNull: ['$amount', 0] } },
                courseTitle: { $first: '$courseTitle' }
              }
            }
          ],
          details: [{ $sort: { createdAt: 1, _id: 1 } }, { $limit: REPORT_DETAIL_ROW_LIMIT + 1 }]
        }
      }
    ]).allowDiskUse(true);

    const summary = reportAgg?.[0]?.summary?.[0];
    const detailRowsRaw = reportAgg?.[0]?.details || [];
    const isTruncated = detailRowsRaw.length > REPORT_DETAIL_ROW_LIMIT;
    const rows = isTruncated ? detailRowsRaw.slice(0, REPORT_DETAIL_ROW_LIMIT) : detailRowsRaw;

    if (!summary || !rows.length) {
      const err: any = new Error('No revenue records found for this course');
      err.statusCode = 404;
      throw err;
    }

    const courseTitle = String(summary?.courseTitle || rows?.[0]?.courseTitle || 'Untitled Course');
    const generatedAt = new Date();
    const totalCents = Number(summary?.totalCents || 0);
    const totalEnrollments = Number(summary?.totalEnrollments || rows.length || 0);

    const displayRows = rows.map((r: any, idx: number) => {
      const d = new Date(r.createdAt);
      const dStr = Number.isNaN(d.getTime())
        ? '—'
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
            d.getDate()
          ).padStart(2, '0')}`;
      return {
        no: String(idx + 1),
        date: dStr,
        purchaser: String(r.payerName || 'Unknown User'),
        student: String(
          r.payerRole === 'parent' ? r.studentName || '-' : r.studentName || r.payerName || '-'
        ),
        email: String(r.payerEmail || '-'),
        amount: `$${toUSD(r.amount).toFixed(2)}`,
        ref: String(r.reference || '-')
      };
    });

    const pageWidth = 612;
    const margin = 40;
    const tableX = margin;
    const tableWidth = pageWidth - margin * 2;
    const headerTopY = 640;
    const headerHeight = 20;
    const rowHeight = 18;
    const minRowBaselineY = 94;

    const columns = [
      { key: 'no', title: '#', width: 26, align: 'left' as const },
      { key: 'date', title: 'Date', width: 78, align: 'left' as const },
      { key: 'purchaser', title: 'Purchaser', width: 105, align: 'left' as const },
      { key: 'student', title: 'Student', width: 105, align: 'left' as const },
      { key: 'email', title: 'Purchaser Email', width: 115, align: 'left' as const },
      { key: 'amount', title: 'Amount', width: 62, align: 'right' as const },
      { key: 'ref', title: 'Reference', width: 41, align: 'left' as const }
    ];

    const pageStreams: string[] = [];
    let pageNo = 1;
    let commands: string[] = [];
    let rowY = 0;

    const drawPageShell = () => {
      commands.push('0 g');
      commands.push('0.7 w');

      // Title block
      commands.push(pdfFillRect(margin, 728, tableWidth, 30, 0.93));
      commands.push(pdfText(margin + 10, 739, 'Revenue Report', 16, 'F2'));
      commands.push(pdfText(pageWidth - margin - 90, 739, `Page ${pageNo}`, 10, 'F1'));

      // Metadata
      commands.push(pdfText(margin, 711, `Course: ${courseTitle}`, 11, 'F2'));
      commands.push(
        pdfText(
          margin,
          695,
          `Date Range: ${startDate || 'Beginning'} to ${endDate || 'Now'}  |  Generated: ${generatedAt
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ')}`,
          9,
          'F1'
        )
      );
      if (isTruncated) {
        commands.push(
          pdfText(
            margin,
            680,
            `Showing first ${REPORT_DETAIL_ROW_LIMIT} rows out of ${totalEnrollments} total enrollments.`,
            8,
            'F1'
          )
        );
      }

      // Table header
      commands.push(pdfFillRect(tableX, headerTopY - headerHeight, tableWidth, headerHeight, 0.9));
      commands.push(pdfStrokeRect(tableX, headerTopY - headerHeight, tableWidth, headerHeight));
      commands.push(pdfLine(tableX, headerTopY, tableX + tableWidth, headerTopY));
      commands.push(
        pdfLine(tableX, headerTopY - headerHeight, tableX + tableWidth, headerTopY - headerHeight)
      );

      let x = tableX;
      for (const c of columns) {
        commands.push(pdfLine(x, headerTopY, x, headerTopY - headerHeight));
        commands.push(pdfText(x + 4, headerTopY - 14, c.title, 9, 'F2'));
        x += c.width;
      }
      commands.push(
        pdfLine(tableX + tableWidth, headerTopY, tableX + tableWidth, headerTopY - headerHeight)
      );
      rowY = headerTopY - headerHeight - 14;
    };

    const flushPage = () => {
      commands.push(pdfLine(margin, 56, pageWidth - margin, 56));
      commands.push(pdfText(margin, 42, 'HelloK12 Financial Report', 8, 'F1'));
      commands.push(
        pdfText(
          pageWidth - margin - 120,
          42,
          `Generated ${generatedAt.toISOString().slice(0, 10)}`,
          8,
          'F1'
        )
      );
      pageStreams.push(commands.join('\n'));
      pageNo += 1;
    };

    const startPage = () => {
      commands = [];
      drawPageShell();
    };

    const drawRow = (r: { [k: string]: string }, index: number) => {
      const rowTop = rowY + 6;
      const rowBottom = rowTop - rowHeight;
      if (index % 2 === 0) {
        commands.push(pdfFillRect(tableX, rowBottom, tableWidth, rowHeight, 0.965));
      }

      commands.push(pdfStrokeRect(tableX, rowBottom, tableWidth, rowHeight));

      let x = tableX;
      for (const c of columns) {
        const rawText = String(r[c.key] || '');
        const text = fitTextToWidth(rawText, c.width - 8, 9);
        if (c.align === 'right') {
          const textW = approxTextWidth(text, 9);
          commands.push(pdfText(x + c.width - 4 - textW, rowBottom + 6, text, 9, 'F1'));
        } else {
          commands.push(pdfText(x + 4, rowBottom + 6, text, 9, 'F1'));
        }
        commands.push(pdfLine(x, rowTop, x, rowBottom));
        x += c.width;
      }
      commands.push(pdfLine(tableX + tableWidth, rowTop, tableX + tableWidth, rowBottom));
      rowY -= rowHeight;
    };

    startPage();

    displayRows.forEach((r: any, idx: number) => {
      if (rowY < minRowBaselineY) {
        flushPage();
        startPage();
      }
      drawRow(r, idx);
    });

    // Totals box on final page
    if (rowY < 116) {
      flushPage();
      startPage();
    }

    const totalsBoxX = pageWidth - margin - 220;
    const totalsBoxY = rowY - 52;
    const totalsBoxW = 220;
    const totalsBoxH = 48;

    commands.push(pdfFillRect(totalsBoxX, totalsBoxY, totalsBoxW, totalsBoxH, 0.94));
    commands.push(
      pdfLine(totalsBoxX, totalsBoxY + totalsBoxH, totalsBoxX + totalsBoxW, totalsBoxY + totalsBoxH)
    );
    commands.push(pdfLine(totalsBoxX, totalsBoxY, totalsBoxX + totalsBoxW, totalsBoxY));
    commands.push(pdfLine(totalsBoxX, totalsBoxY, totalsBoxX, totalsBoxY + totalsBoxH));
    commands.push(
      pdfLine(totalsBoxX + totalsBoxW, totalsBoxY, totalsBoxX + totalsBoxW, totalsBoxY + totalsBoxH)
    );

    commands.push(
      pdfText(totalsBoxX + 10, totalsBoxY + 30, `Total Enrollments: ${totalEnrollments}`, 10, 'F2')
    );
    commands.push(
      pdfText(
        totalsBoxX + 10,
        totalsBoxY + 14,
        `Total Revenue: $${toUSD(totalCents).toFixed(2)}`,
        10,
        'F2'
      )
    );

    flushPage();

    return {
      buffer: buildPdfFromStreams(pageStreams),
      fileName: `revenue-${fileNameSafe(courseTitle)}-${generatedAt.toISOString().slice(0, 10)}.pdf`
    };
  },

  getCommissionReportPdf: async ({
    courseId,
    startDate,
    endDate
  }: {
    courseId: string;
    startDate?: string;
    endDate?: string;
  }) => {
    if (!Types.ObjectId.isValid(courseId)) {
      const err: any = new Error('Invalid course id');
      err.statusCode = 400;
      throw err;
    }

    const courseObj = new Types.ObjectId(courseId);
    const dateRange = parseDateRange(startDate, endDate);

    const basePipeline: any[] = [
      {
        $match: {
          status: { $in: ['SUCCEEDED'] },
          ...(dateRange ? { createdAt: dateRange } : {})
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
      { $unwind: { path: '$bookingDoc', preserveNullAndEmptyArrays: false } },
      { $match: { 'bookingDoc.course': courseObj } },
      {
        $lookup: {
          from: 'courses',
          localField: 'bookingDoc.course',
          foreignField: '_id',
          as: 'courseDoc'
        }
      },
      { $unwind: { path: '$courseDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          localField: 'payer',
          foreignField: '_id',
          as: 'payerDoc'
        }
      },
      { $unwind: { path: '$payerDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          localField: 'bookingDoc.student',
          foreignField: '_id',
          as: 'studentDoc'
        }
      },
      { $unwind: { path: '$studentDoc', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          amount: { $ifNull: ['$amount', 0] },
          platformFee: { $ifNull: ['$platformFee', 0] },
          createdAt: 1,
          reference: { $ifNull: ['$reference', '-'] },
          courseTitle: { $ifNull: ['$courseDoc.title', 'Untitled Course'] },
          payerRole: { $ifNull: ['$payerDoc.role', '-'] },
          payerName: { $ifNull: ['$payerDoc.name', 'Unknown User'] },
          payerEmail: { $ifNull: ['$payerDoc.email', '-'] },
          studentName: { $ifNull: ['$studentDoc.name', '-'] }
        }
      }
    ];

    const reportAgg = await TransactionModel.aggregate([
      ...basePipeline,
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                totalEnrollments: { $sum: 1 },
                totalCommissionCents: { $sum: { $ifNull: ['$platformFee', 0] } },
                courseTitle: { $first: '$courseTitle' }
              }
            }
          ],
          details: [{ $sort: { createdAt: 1, _id: 1 } }, { $limit: REPORT_DETAIL_ROW_LIMIT + 1 }]
        }
      }
    ]).allowDiskUse(true);

    const summary = reportAgg?.[0]?.summary?.[0];
    const detailRowsRaw = reportAgg?.[0]?.details || [];
    const isTruncated = detailRowsRaw.length > REPORT_DETAIL_ROW_LIMIT;
    const rows = isTruncated ? detailRowsRaw.slice(0, REPORT_DETAIL_ROW_LIMIT) : detailRowsRaw;

    if (!summary || !rows.length) {
      const err: any = new Error('No commission records found for this course');
      err.statusCode = 404;
      throw err;
    }

    const courseTitle = String(summary?.courseTitle || rows?.[0]?.courseTitle || 'Untitled Course');
    const generatedAt = new Date();
    const totalCommissionCents = Number(summary?.totalCommissionCents || 0);
    const totalEnrollments = Number(summary?.totalEnrollments || rows.length || 0);

    const displayRows = rows.map((r: any, idx: number) => {
      const d = new Date(r.createdAt);
      const dStr = Number.isNaN(d.getTime())
        ? '—'
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
            d.getDate()
          ).padStart(2, '0')}`;
      return {
        no: String(idx + 1),
        date: dStr,
        purchaser: String(r.payerName || 'Unknown User'),
        student: String(
          r.payerRole === 'parent' ? r.studentName || '-' : r.studentName || r.payerName || '-'
        ),
        email: String(r.payerEmail || '-'),
        commission: `$${toUSD(r.platformFee).toFixed(2)}`,
        amount: `$${toUSD(r.amount).toFixed(2)}`,
        ref: String(r.reference || '-')
      };
    });

    const pageWidth = 612;
    const margin = 40;
    const tableX = margin;
    const tableWidth = pageWidth - margin * 2;
    const headerTopY = 640;
    const headerHeight = 20;
    const rowHeight = 18;
    const minRowBaselineY = 94;

    const columns = [
      { key: 'no', title: '#', width: 22, align: 'left' as const },
      { key: 'date', title: 'Date', width: 70, align: 'left' as const },
      { key: 'purchaser', title: 'Purchaser', width: 92, align: 'left' as const },
      { key: 'student', title: 'Student', width: 92, align: 'left' as const },
      { key: 'email', title: 'Purchaser Email', width: 110, align: 'left' as const },
      { key: 'commission', title: 'Commission', width: 64, align: 'right' as const },
      { key: 'amount', title: 'Paid', width: 54, align: 'right' as const },
      { key: 'ref', title: 'Reference', width: 48, align: 'left' as const }
    ];

    const pageStreams: string[] = [];
    let pageNo = 1;
    let commands: string[] = [];
    let rowY = 0;

    const drawPageShell = () => {
      commands.push('0 g');
      commands.push('0.7 w');

      commands.push(pdfFillRect(margin, 728, tableWidth, 30, 0.93));
      commands.push(pdfText(margin + 10, 739, 'Commission Report', 16, 'F2'));
      commands.push(pdfText(pageWidth - margin - 90, 739, `Page ${pageNo}`, 10, 'F1'));

      commands.push(pdfText(margin, 711, `Course: ${courseTitle}`, 11, 'F2'));
      commands.push(
        pdfText(
          margin,
          695,
          `Date Range: ${startDate || 'Beginning'} to ${endDate || 'Now'}  |  Generated: ${generatedAt
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ')}`,
          9,
          'F1'
        )
      );
      if (isTruncated) {
        commands.push(
          pdfText(
            margin,
            680,
            `Showing first ${REPORT_DETAIL_ROW_LIMIT} rows out of ${totalEnrollments} total enrollments.`,
            8,
            'F1'
          )
        );
      }

      commands.push(pdfFillRect(tableX, headerTopY - headerHeight, tableWidth, headerHeight, 0.9));
      commands.push(pdfStrokeRect(tableX, headerTopY - headerHeight, tableWidth, headerHeight));
      commands.push(pdfLine(tableX, headerTopY, tableX + tableWidth, headerTopY));
      commands.push(
        pdfLine(tableX, headerTopY - headerHeight, tableX + tableWidth, headerTopY - headerHeight)
      );

      let x = tableX;
      for (const c of columns) {
        commands.push(pdfLine(x, headerTopY, x, headerTopY - headerHeight));
        commands.push(pdfText(x + 4, headerTopY - 14, c.title, 9, 'F2'));
        x += c.width;
      }
      commands.push(
        pdfLine(tableX + tableWidth, headerTopY, tableX + tableWidth, headerTopY - headerHeight)
      );
      rowY = headerTopY - headerHeight - 14;
    };

    const flushPage = () => {
      commands.push(pdfLine(margin, 56, pageWidth - margin, 56));
      commands.push(pdfText(margin, 42, 'HelloK12 Financial Report', 8, 'F1'));
      commands.push(
        pdfText(
          pageWidth - margin - 120,
          42,
          `Generated ${generatedAt.toISOString().slice(0, 10)}`,
          8,
          'F1'
        )
      );
      pageStreams.push(commands.join('\n'));
      pageNo += 1;
    };

    const startPage = () => {
      commands = [];
      drawPageShell();
    };

    const drawRow = (r: { [k: string]: string }, index: number) => {
      const rowTop = rowY + 6;
      const rowBottom = rowTop - rowHeight;
      if (index % 2 === 0) {
        commands.push(pdfFillRect(tableX, rowBottom, tableWidth, rowHeight, 0.965));
      }

      commands.push(pdfStrokeRect(tableX, rowBottom, tableWidth, rowHeight));

      let x = tableX;
      for (const c of columns) {
        const rawText = String(r[c.key] || '');
        const text = fitTextToWidth(rawText, c.width - 8, 9);
        if (c.align === 'right') {
          const textW = approxTextWidth(text, 9);
          commands.push(pdfText(x + c.width - 4 - textW, rowBottom + 6, text, 9, 'F1'));
        } else {
          commands.push(pdfText(x + 4, rowBottom + 6, text, 9, 'F1'));
        }
        commands.push(pdfLine(x, rowTop, x, rowBottom));
        x += c.width;
      }
      commands.push(pdfLine(tableX + tableWidth, rowTop, tableX + tableWidth, rowBottom));
      rowY -= rowHeight;
    };

    startPage();

    displayRows.forEach((r: any, idx: number) => {
      if (rowY < minRowBaselineY) {
        flushPage();
        startPage();
      }
      drawRow(r, idx);
    });

    if (rowY < 116) {
      flushPage();
      startPage();
    }

    const totalsBoxX = pageWidth - margin - 230;
    const totalsBoxY = rowY - 52;
    const totalsBoxW = 230;
    const totalsBoxH = 48;

    commands.push(pdfFillRect(totalsBoxX, totalsBoxY, totalsBoxW, totalsBoxH, 0.94));
    commands.push(
      pdfLine(totalsBoxX, totalsBoxY + totalsBoxH, totalsBoxX + totalsBoxW, totalsBoxY + totalsBoxH)
    );
    commands.push(pdfLine(totalsBoxX, totalsBoxY, totalsBoxX + totalsBoxW, totalsBoxY));
    commands.push(pdfLine(totalsBoxX, totalsBoxY, totalsBoxX, totalsBoxY + totalsBoxH));
    commands.push(
      pdfLine(totalsBoxX + totalsBoxW, totalsBoxY, totalsBoxX + totalsBoxW, totalsBoxY + totalsBoxH)
    );

    commands.push(
      pdfText(totalsBoxX + 10, totalsBoxY + 30, `Total Enrollments: ${totalEnrollments}`, 10, 'F2')
    );
    commands.push(
      pdfText(
        totalsBoxX + 10,
        totalsBoxY + 14,
        `Total Commission: $${toUSD(totalCommissionCents).toFixed(2)}`,
        10,
        'F2'
      )
    );

    flushPage();

    return {
      buffer: buildPdfFromStreams(pageStreams),
      fileName: `commission-${fileNameSafe(courseTitle)}-${generatedAt.toISOString().slice(0, 10)}.pdf`
    };
  },

  // ---------------- COMMISSION TABLE ----------------
  listCommission: async ({
    page,
    limit,
    search,
    sortBy,
    sortOrder,
    startDate,
    endDate
  }: {
    page: string;
    limit: string;
    search: string;
    sortBy?: string;
    sortOrder?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    const pageNum = clampInt(page, 1, 100000, 1);
    const limitNum = clampInt(limit, 1, 200, 10);
    const skip = (pageNum - 1) * limitNum;

    const dateRange = parseDateRange(startDate, endDate);
    const term = String(search || '').trim();
    const rx = term ? new RegExp(escapeRegex(term), 'i') : null;
    const order = normalizeSortOrder(sortOrder);
    const sortStage = getCommissionSortStage(sortBy, order);

    const pipeline: any[] = [
      {
        $match: {
          status: { $in: ['SUCCEEDED'] },
          ...(dateRange ? { createdAt: dateRange } : {})
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
      { $unwind: { path: '$bookingDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'courses',
          localField: 'bookingDoc.course',
          foreignField: '_id',
          as: 'courseDoc'
        }
      },
      { $unwind: { path: '$courseDoc', preserveNullAndEmptyArrays: true } }
    ];

    if (rx) {
      pipeline.push({ $match: { 'courseDoc.title': rx } });
    }

    // Prefer rows backed by transactions that already have a downloadable receipt/invoice URL.
    pipeline.push(
      {
        $addFields: {
          hasDownloadUrl: {
            $cond: [
              {
                $and: [{ $ne: ['$downloadUrl', null] }, { $ne: ['$downloadUrl', ''] }]
              },
              1,
              0
            ]
          }
        }
      },
      { $sort: { hasDownloadUrl: -1, createdAt: -1, _id: 1 } }
    );

    pipeline.push({
      $group: {
        _id: '$courseDoc._id',
        courseTitle: { $first: { $ifNull: ['$courseDoc.title', 'Untitled Course'] } },
        enrollments: { $sum: 1 },
        earnedCents: { $sum: { $ifNull: ['$platformFee', 0] } },
        lastDate: { $max: '$createdAt' },
        // If you have commission rate stored in tx metadata, read it:
        rate: { $first: { $ifNull: ['$metadata.commissionRate', null] } },
        downloadUrl: { $first: { $ifNull: ['$downloadUrl', null] } }
      }
    });
    pipeline.push({
      $addFields: {
        rateNum: { $convert: { input: '$rate', to: 'double', onError: 0, onNull: 0 } }
      }
    });

    const countPipeline = [...pipeline, { $count: 'total' }];

    pipeline.push({ $sort: sortStage }, { $skip: skip }, { $limit: limitNum });

    const [rows, cnt] = await Promise.all([
      TransactionModel.aggregate(pipeline).allowDiskUse(true),
      TransactionModel.aggregate(countPipeline).allowDiskUse(true)
    ]);

    const total = cnt?.[0]?.total || 0;
    const pages = Math.max(1, Math.ceil(total / limitNum));

    // If rate is missing, you can default from config/env later.
    return {
      rows: rows.map((r: any) => ({
        courseId: r._id ? String(r._id) : null,
        courseTitle: r.courseTitle,
        enrollments: r.enrollments,
        rate: r.rate !== null && r.rate !== undefined ? `${Number(r.rate).toFixed(1)}%` : '—',
        earned: toUSD(r.earnedCents),
        date: r.lastDate,
        downloadUrl: r._id
          ? `/api/v1/admin/financial/commission/${String(r._id)}/download${
              startDate || endDate
                ? `?${new URLSearchParams({
                    ...(startDate ? { startDate } : {}),
                    ...(endDate ? { endDate } : {})
                  }).toString()}`
                : ''
            }`
          : null
      })),
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages,
        hasNextPage: pageNum < pages,
        hasPrevPage: pageNum > 1
      }
    };
  }
};
