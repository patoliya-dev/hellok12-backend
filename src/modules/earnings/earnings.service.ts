import { DateTime } from 'luxon';
import {
  buildSummaryAmounts,
  centsToAmount,
  normalizeGrowthPercent,
  percentageChange
} from './earnings.calculations';
import { EarningsActorRole, earningsRepositoryV2 } from './earnings.repository';

type LegacyTrendPeriod = 'weekly' | 'monthly' | 'yearly';
type EarningsRange = 'week' | 'month' | 'year';

type RangeWindow = {
  currentStart: DateTime;
  currentEnd: DateTime;
  previousStart: DateTime;
  previousEnd: DateTime;
  comparisonPeriod: string;
};

type Bucket = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

/**
 * Legacy FE screens still use weekly/monthly/yearly.
 * New endpoints use week/month/year.
 * Keep both mappings so old clients do not break during rollout.
 */
const RANGE_TO_LEGACY: Record<EarningsRange, LegacyTrendPeriod> = {
  week: 'weekly',
  month: 'monthly',
  year: 'yearly'
};

const LEGACY_TO_RANGE: Record<LegacyTrendPeriod, EarningsRange> = {
  weekly: 'week',
  monthly: 'month',
  yearly: 'year'
};

// Accept both legacy and new range values from query params.
const normalizeRange = (value?: string): EarningsRange => {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  if (v === 'week' || v === 'weekly') return 'week';
  if (v === 'year' || v === 'yearly') return 'year';
  return 'month';
};

const resolveRole = (role?: string): EarningsActorRole => {
  return role === 'school' ? 'school' : 'teacher';
};

// Parse date input in user timezone, then normalize to UTC boundaries for DB filters.
const parseDateAtBoundary = (value: unknown, boundary: 'start' | 'end', timeZone: string) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const parsed = DateTime.fromISO(raw, { zone: timeZone });
  if (!parsed.isValid) return null;

  return boundary === 'start' ? parsed.startOf('day').toUTC() : parsed.endOf('day').toUTC();
};

const startOfIsoWeek = (dt: DateTime) => dt.startOf('day').minus({ days: dt.weekday - 1 });

/**
 * Builds to-date windows used for current-vs-previous percentage comparisons.
 * Important: previous period is clipped to the same elapsed duration so
 * "month-to-date vs previous month-to-date" remains apples-to-apples.
 */
const getToDateWindow = (period: EarningsRange, nowLocal: DateTime): RangeWindow => {
  if (period === 'week') {
    const currentStart = startOfIsoWeek(nowLocal);
    const currentEnd = nowLocal;
    const elapsedMs = Math.max(0, currentEnd.toMillis() - currentStart.toMillis());

    const previousStart = currentStart.minus({ weeks: 1 });
    const previousNaturalEnd = previousStart.plus({ days: 6 }).endOf('day');
    const previousByElapsed = previousStart.plus({ milliseconds: elapsedMs });
    const previousEnd =
      previousByElapsed.toMillis() < previousNaturalEnd.toMillis()
        ? previousByElapsed
        : previousNaturalEnd;

    return {
      currentStart,
      currentEnd,
      previousStart,
      previousEnd,
      comparisonPeriod: 'vs previous week'
    };
  }

  if (period === 'year') {
    const currentStart = nowLocal.startOf('year');
    const currentEnd = nowLocal;
    const elapsedMs = Math.max(0, currentEnd.toMillis() - currentStart.toMillis());

    const previousStart = currentStart.minus({ years: 1 });
    const previousNaturalEnd = previousStart.endOf('year');
    const previousByElapsed = previousStart.plus({ milliseconds: elapsedMs });
    const previousEnd =
      previousByElapsed.toMillis() < previousNaturalEnd.toMillis()
        ? previousByElapsed
        : previousNaturalEnd;

    return {
      currentStart,
      currentEnd,
      previousStart,
      previousEnd,
      comparisonPeriod: 'vs previous year'
    };
  }

  const currentStart = nowLocal.startOf('month');
  const currentEnd = nowLocal;
  const elapsedMs = Math.max(0, currentEnd.toMillis() - currentStart.toMillis());

  const previousStart = currentStart.minus({ months: 1 });
  const previousNaturalEnd = previousStart.endOf('month');
  const previousByElapsed = previousStart.plus({ milliseconds: elapsedMs });
  const previousEnd =
    previousByElapsed.toMillis() < previousNaturalEnd.toMillis()
      ? previousByElapsed
      : previousNaturalEnd;

  return {
    currentStart,
    currentEnd,
    previousStart,
    previousEnd,
    comparisonPeriod: 'vs previous month'
  };
};

const getDefaultGraphRange = (range: EarningsRange, nowLocal: DateTime) => {
  if (range === 'week') {
    const end = nowLocal.endOf('day');
    const start = startOfIsoWeek(nowLocal).minus({ weeks: 11 }).startOf('day');
    return { start, end };
  }

  if (range === 'year') {
    return {
      start: nowLocal.startOf('year').minus({ years: 4 }),
      end: nowLocal.endOf('day')
    };
  }

  return {
    start: nowLocal.startOf('year'),
    end: nowLocal.endOf('year')
  };
};

const buildWeekBuckets = (startLocal: DateTime, endLocal: DateTime): Bucket[] => {
  const buckets: Bucket[] = [];
  let cursor = startOfIsoWeek(startLocal);
  const hardEnd = endLocal.endOf('day');
  let index = 1;

  while (cursor.toMillis() <= hardEnd.toMillis()) {
    const bucketEnd = cursor.plus({ days: 6 }).endOf('day');
    buckets.push({
      key: `${cursor.weekYear}-${cursor.weekNumber}`,
      label: `Week ${index}`,
      start: cursor.toUTC().toJSDate(),
      end: bucketEnd.toUTC().toJSDate()
    });
    cursor = cursor.plus({ weeks: 1 });
    index += 1;
  }

  return buckets;
};

const buildMonthBuckets = (startLocal: DateTime, endLocal: DateTime): Bucket[] => {
  const buckets: Bucket[] = [];
  let cursor = startLocal.startOf('month');
  const hardEnd = endLocal.endOf('month');
  const spansMultiYear = cursor.year !== hardEnd.year;

  while (cursor.toMillis() <= hardEnd.toMillis()) {
    const monthEnd = cursor.endOf('month');
    const shortMonth = cursor.toFormat('LLL');
    buckets.push({
      key: `${cursor.year}-${cursor.month}`,
      label: spansMultiYear ? `${shortMonth} ${cursor.year}` : shortMonth,
      start: cursor.toUTC().toJSDate(),
      end: monthEnd.toUTC().toJSDate()
    });
    cursor = cursor.plus({ months: 1 }).startOf('month');
  }

  return buckets;
};

const buildYearBuckets = (startLocal: DateTime, endLocal: DateTime): Bucket[] => {
  const buckets: Bucket[] = [];
  let cursor = startLocal.startOf('year');
  const hardEnd = endLocal.endOf('year');

  while (cursor.toMillis() <= hardEnd.toMillis()) {
    const yearEnd = cursor.endOf('year');
    buckets.push({
      key: String(cursor.year),
      label: String(cursor.year),
      start: cursor.toUTC().toJSDate(),
      end: yearEnd.toUTC().toJSDate()
    });
    cursor = cursor.plus({ years: 1 }).startOf('year');
  }

  return buckets;
};

const buildBuckets = (range: EarningsRange, startLocal: DateTime, endLocal: DateTime) => {
  if (range === 'week') return buildWeekBuckets(startLocal, endLocal);
  if (range === 'year') return buildYearBuckets(startLocal, endLocal);
  return buildMonthBuckets(startLocal, endLocal);
};

const toTransactionStatus = (value?: string) => {
  const status = String(value || '')
    .trim()
    .toUpperCase();

  if (status === 'SUCCEEDED') return 'PAID';
  return status || 'PAID';
};

export const EarningsServiceV2 = {
  /**
   * Returns earnings summary cards and balance metrics.
   * Earnings = PAID purchases only (from transactions); payouts are returned separately
   * as cash-out metrics and must not reduce the earnings totals.
   */
  async getEarningsSummary(args: {
    userId: string;
    role?: string;
    timeZone?: string;
    range?: string;
    from?: string;
    to?: string;
  }) {
    const timeZone = args.timeZone || 'UTC';
    const role = resolveRole(args.role);
    const nowLocal = DateTime.now().setZone(timeZone);

    const weekWindow = getToDateWindow('week', nowLocal);
    const monthWindow = getToDateWindow('month', nowLocal);
    const yearWindow = getToDateWindow('year', nowLocal);

    const [weekCurrent, weekPrevious, monthCurrent, monthPrevious, yearCurrent, yearPrevious] =
      await Promise.all([
        earningsRepositoryV2.aggregateSalesTotals({
          role,
          userId: args.userId,
          startDate: weekWindow.currentStart.toUTC().toJSDate(),
          endDate: weekWindow.currentEnd.toUTC().toJSDate()
        }),
        earningsRepositoryV2.aggregateSalesTotals({
          role,
          userId: args.userId,
          startDate: weekWindow.previousStart.toUTC().toJSDate(),
          endDate: weekWindow.previousEnd.toUTC().toJSDate()
        }),
        earningsRepositoryV2.aggregateSalesTotals({
          role,
          userId: args.userId,
          startDate: monthWindow.currentStart.toUTC().toJSDate(),
          endDate: monthWindow.currentEnd.toUTC().toJSDate()
        }),
        earningsRepositoryV2.aggregateSalesTotals({
          role,
          userId: args.userId,
          startDate: monthWindow.previousStart.toUTC().toJSDate(),
          endDate: monthWindow.previousEnd.toUTC().toJSDate()
        }),
        earningsRepositoryV2.aggregateSalesTotals({
          role,
          userId: args.userId,
          startDate: yearWindow.currentStart.toUTC().toJSDate(),
          endDate: yearWindow.currentEnd.toUTC().toJSDate()
        }),
        earningsRepositoryV2.aggregateSalesTotals({
          role,
          userId: args.userId,
          startDate: yearWindow.previousStart.toUTC().toJSDate(),
          endDate: yearWindow.previousEnd.toUTC().toJSDate()
        })
      ]);

    const selectedRange = normalizeRange(args.range);
    const selectedDefaults = getToDateWindow(selectedRange, nowLocal);
    const selectedFrom =
      parseDateAtBoundary(args.from, 'start', timeZone) || selectedDefaults.currentStart.toUTC();
    const selectedTo =
      parseDateAtBoundary(args.to, 'end', timeZone) || selectedDefaults.currentEnd.toUTC();

    // Keep earnings (sales) and payouts as separate aggregates.
    const [selectedSales, selectedPaidOut, allTimeSales, allTimePaidOut] = await Promise.all([
      earningsRepositoryV2.aggregateSalesTotals({
        role,
        userId: args.userId,
        startDate: selectedFrom.toJSDate(),
        endDate: selectedTo.toJSDate()
      }),
      earningsRepositoryV2.aggregatePaidOutTotals({
        userId: args.userId,
        startDate: selectedFrom.toJSDate(),
        endDate: selectedTo.toJSDate()
      }),
      earningsRepositoryV2.aggregateSalesTotals({
        role,
        userId: args.userId,
        startDate: new Date(0),
        endDate: nowLocal.toUTC().toJSDate()
      }),
      earningsRepositoryV2.aggregatePaidOutTotals({
        userId: args.userId
      })
    ]);

    const selectedAmounts = buildSummaryAmounts(
      selectedSales,
      selectedPaidOut,
      allTimeSales.netCents,
      allTimePaidOut
    );

    const weekCurrentAmount = centsToAmount(weekCurrent.netCents);
    const weekPreviousAmount = centsToAmount(weekPrevious.netCents);
    const monthCurrentAmount = centsToAmount(monthCurrent.netCents);
    const monthPreviousAmount = centsToAmount(monthPrevious.netCents);
    const yearCurrentAmount = centsToAmount(yearCurrent.netCents);
    const yearPreviousAmount = centsToAmount(yearPrevious.netCents);

    return {
      range: selectedRange,
      from: selectedFrom.toJSDate(),
      to: selectedTo.toJSDate(),
      grossSales: selectedAmounts.grossSales,
      platformFees: selectedAmounts.platformFees,
      netEarnings: selectedAmounts.netEarnings,
      paidOut: selectedAmounts.paidOut,
      availableBalance: selectedAmounts.availableBalance,
      pending: selectedAmounts.pending,

      // Backward-compatible cards used by existing app screens.
      thisWeek: {
        amount: weekCurrentAmount,
        percentageChange: normalizeGrowthPercent(
          percentageChange(weekCurrentAmount, weekPreviousAmount)
        ),
        comparisonPeriod: weekWindow.comparisonPeriod
      },
      thisMonth: {
        amount: monthCurrentAmount,
        percentageChange: normalizeGrowthPercent(
          percentageChange(monthCurrentAmount, monthPreviousAmount)
        ),
        comparisonPeriod: monthWindow.comparisonPeriod
      },
      thisYear: {
        amount: yearCurrentAmount,
        percentageChange: normalizeGrowthPercent(
          percentageChange(yearCurrentAmount, yearPreviousAmount)
        ),
        comparisonPeriod: yearWindow.comparisonPeriod
      }
    };
  },

  async getEarningsGraph(args: {
    userId: string;
    role?: string;
    range?: string;
    period?: string;
    from?: string;
    to?: string;
    timeZone?: string;
  }) {
    const timeZone = args.timeZone || 'UTC';
    const role = resolveRole(args.role);
    const legacyPeriod = String(args.period || '')
      .trim()
      .toLowerCase() as LegacyTrendPeriod;
    const selectedRange = normalizeRange(args.range || LEGACY_TO_RANGE[legacyPeriod] || 'month');
    const nowLocal = DateTime.now().setZone(timeZone);

    const defaults = getDefaultGraphRange(selectedRange, nowLocal);
    const from = parseDateAtBoundary(args.from, 'start', timeZone) || defaults.start.toUTC();
    const to = parseDateAtBoundary(args.to, 'end', timeZone) || defaults.end.toUTC();

    const startLocal = from.setZone(timeZone);
    const endLocal = to.setZone(timeZone);
    const buckets = buildBuckets(selectedRange, startLocal, endLocal);

    // Graph is based on purchase settlement time buckets (never payout events).
    const rows = await earningsRepositoryV2.aggregateSalesByRangeBucket({
      role,
      userId: args.userId,
      bucket: selectedRange,
      startDate: buckets[0]?.start || from.toJSDate(),
      endDate: buckets[buckets.length - 1]?.end || to.toJSDate()
    });

    const totalsByKey = new Map<
      string,
      { grossCents: number; platformFeeCents: number; netCents: number }
    >();

    rows.forEach((row: any) => {
      if (selectedRange === 'week') {
        totalsByKey.set(`${row?._id?.y}-${row?._id?.w}`, {
          grossCents: Number(row?.grossCents || 0),
          platformFeeCents: Number(row?.platformFeeCents || 0),
          netCents: Number(row?.netCents || 0)
        });
        return;
      }

      if (selectedRange === 'month') {
        totalsByKey.set(`${row?._id?.y}-${row?._id?.m}`, {
          grossCents: Number(row?.grossCents || 0),
          platformFeeCents: Number(row?.platformFeeCents || 0),
          netCents: Number(row?.netCents || 0)
        });
        return;
      }

      totalsByKey.set(String(row?._id?.y), {
        grossCents: Number(row?.grossCents || 0),
        platformFeeCents: Number(row?.platformFeeCents || 0),
        netCents: Number(row?.netCents || 0)
      });
    });

    const graphBuckets = buckets.map(bucket => {
      const totals = totalsByKey.get(bucket.key) || {
        grossCents: 0,
        platformFeeCents: 0,
        netCents: 0
      };

      return {
        label: bucket.label,
        start: bucket.start,
        end: bucket.end,
        grossSales: centsToAmount(totals.grossCents),
        platformFees: centsToAmount(totals.platformFeeCents),
        netEarnings: centsToAmount(totals.netCents)
      };
    });

    return {
      range: selectedRange,
      period: RANGE_TO_LEGACY[selectedRange],
      from: from.toJSDate(),
      to: to.toJSDate(),
      buckets: graphBuckets,
      // Backward-compatible shape used by current teacher/school graphs.
      dataPoints: graphBuckets.map(item => ({
        label: item.label,
        amount: item.netEarnings
      }))
    };
  },

  /**
   * Returns sales entry rows for earnings table filters.
   * Amounts are normalized to net purchase earnings in USD for UI display.
   */
  async listEarnings(args: {
    userId: string;
    role?: string;
    lessonType?: string;
    status?: string;
    minAmount?: string | number;
    maxAmount?: string | number;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    timeZone?: string;
  }) {
    const timeZone = args.timeZone || 'UTC';
    const role = resolveRole(args.role);
    const page = Math.max(1, Number(args.page || 1));
    const limit = Math.min(100, Math.max(1, Number(args.limit || 10)));
    const startDate = parseDateAtBoundary(args.startDate, 'start', timeZone)?.toJSDate();
    const endDate = parseDateAtBoundary(args.endDate, 'end', timeZone)?.toJSDate();
    const minAmount =
      args.minAmount !== undefined && args.minAmount !== null ? Number(args.minAmount) : undefined;
    const maxAmount =
      args.maxAmount !== undefined && args.maxAmount !== null ? Number(args.maxAmount) : undefined;

    const result = await earningsRepositoryV2.listSalesEntries({
      role,
      userId: args.userId,
      lessonType: args.lessonType,
      status: args.status,
      minAmount: Number.isFinite(minAmount as number) ? (minAmount as number) : undefined,
      maxAmount: Number.isFinite(maxAmount as number) ? (maxAmount as number) : undefined,
      startDate,
      endDate,
      page,
      limit,
      sortBy: args.sortBy || 'date',
      sortOrder: args.sortOrder || 'desc'
    });

    const data = result.rows.map((row: any) => ({
      _id: String(row._id),
      date: row.date,
      lessonService: row.lessonService,
      amount: Number(row.amount || 0),
      currency: 'USD',
      status: toTransactionStatus(row.status),
      lessonType: row.lessonType
    }));

    return {
      data,
      pagination: result.pagination
    };
  },

  async getTotalPayoutsAfterCommission(args: {
    userId: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
    timeZone?: string;
  }) {
    const timeZone = args.timeZone || 'UTC';
    const startDate = parseDateAtBoundary(args.startDate, 'start', timeZone)?.toJSDate();
    const endDate = parseDateAtBoundary(args.endDate, 'end', timeZone)?.toJSDate();
    const page = Math.max(1, Number(args.page || 1));
    const limit = Math.min(100, Math.max(1, Number(args.limit || 10)));

    const result = await earningsRepositoryV2.listPaidOutPayouts({
      userId: args.userId,
      startDate,
      endDate,
      page,
      limit
    });

    const payouts = result.rows.map((payout: any) => ({
      _id: String(payout._id),
      invoiceNumber:
        payout?.transaction?.reference ||
        payout?.paymentRef ||
        `PAYOUT-${String(payout._id).slice(-6).toUpperCase()}`,
      date: payout?.paidAt || payout?.createdAt,
      // Keep cents for backward compatibility; frontend converts /100 today.
      amount: Number(payout?.netAmount || payout?.amount || 0),
      status: String(payout?.status || ''),
      downloadUrl: payout?.transaction?.downloadUrl || null
    }));

    return {
      payouts,
      total: result.pagination.total,
      pagination: result.pagination
    };
  }
};
