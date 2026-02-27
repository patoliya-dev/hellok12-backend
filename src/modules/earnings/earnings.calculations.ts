export type SalesTotals = {
  grossCents: number;
  platformFeeCents: number;
  netCents: number;
};

export const centsToAmount = (value: number) => Number((Number(value || 0) / 100).toFixed(2));

export const computeNetCents = (grossCents: number, platformFeeCents: number, refundCents = 0) =>
  Math.max(Number(grossCents || 0) - Number(platformFeeCents || 0) - Number(refundCents || 0), 0);

export const percentageChange = (currentAmount: number, previousAmount: number) => {
  if (!Number.isFinite(previousAmount) || previousAmount <= 0) return currentAmount > 0 ? 100 : 0;
  const delta = ((currentAmount - previousAmount) / previousAmount) * 100;
  const out = Number(delta.toFixed(1));
  return Object.is(out, -0) ? 0 : out;
};

export const normalizeGrowthPercent = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  if (value > 999.9) return 999.9;
  if (value < -999.9) return -999.9;
  return Number(value.toFixed(1));
};

export const buildSummaryAmounts = (
  sales: SalesTotals,
  paidOutCents: number,
  allTimeNetCents: number,
  allTimePaidOutCents: number
) => {
  const grossSales = centsToAmount(sales.grossCents);
  const platformFees = centsToAmount(sales.platformFeeCents);
  const netEarnings = centsToAmount(sales.netCents);
  const paidOut = centsToAmount(paidOutCents);
  const availableBalance = centsToAmount(Math.max(allTimeNetCents - allTimePaidOutCents, 0));

  return {
    grossSales,
    platformFees,
    netEarnings,
    paidOut,
    availableBalance,
    pending: 0
  };
};
