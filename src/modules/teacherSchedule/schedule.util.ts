// Time helpers & validation shared by service + validators
export const TIME_24H = /^([01]\d|2[0-3]):([0-5]\d)$/; // HH:MM
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const toHHMM = (mins: number): string =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

export const normalizeTimes = (times: string[]): string[] => Array.from(new Set(times)).sort();

export const normalizeMinutes = (mins: number[]): number[] =>
  Array.from(new Set(mins)).sort((a, b) => a - b);

export function ensureAligned(times: string[], slot: number): string | null {
  for (const t of times) {
    const m = toMinutes(t);
    if (!Number.isFinite(m) || m < 0 || m >= 24 * 60) return `Invalid time ${t}`;
    if (m % slot !== 0) return `Time ${t} not aligned to ${slot}`;
  }
  return null;
}

export function weekdayFromISO(date: string): number {
  // Sun=0 .. Sat=6 (aligns with our schema keys)
  const d = new Date(date + 'T00:00:00.000Z');
  return d.getUTCDay();
}

// Normalizes a Mongoose Map<string, number[]> or plain object into a plain object
export function mapToPlain<T = number[]>(input: any): Record<string, T> {
  if (!input) return {};
  if (input instanceof Map) return Object.fromEntries(input as Map<string, T>);
  return input as Record<string, T>;
}
