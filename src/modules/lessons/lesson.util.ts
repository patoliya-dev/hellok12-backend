import { DateTime } from 'luxon';
/**
 * Normalize time in either "HH:MM" (24h) or "h:MM AM/PM" (12h) into "HH:MM" 24h string.
 * Returns null if unrecognized.
 */
export function normalizeToHHMM24(time?: string | null): string | null {
  if (!time || typeof time !== 'string') return null;
  const t = time.trim();

  // 24h: allow "9:00" or "09:00" or "23:59"
  const re24 = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  const m24 = t.match(re24);
  if (m24) {
    const hh = String(Number(m24[1])).padStart(2, '0');
    const mm = m24[2];
    return `${hh}:${mm}`;
  }

  // 12h: "9:00 AM", "09:00 pm", "12:30 PM"
  const re12 = /^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/i;
  const m12 = t.match(re12);
  if (m12) {
    let hh = Number(m12[1]);
    const mm = m12[2];
    const ampm = m12[3].toUpperCase();
    if (ampm === 'AM' && hh === 12) hh = 0;
    if (ampm === 'PM' && hh !== 12) hh += 12;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  return null;
}

/**
 * Robust parseStartEnd:
 * - If startAt (string) provided -> parse as Date and compute endAt.
 * - Else require schedule.date (Date | ISO or YYYY-MM-DD), schedule.time, schedule.duration.
 * - Build a local Date object for the provided date + time (new Date(year, monthIndex, day, hour, minute)).
 *
 * Returns: { startAt: Date, endAt: Date }
 * Throws Error(...) when invalid inputs are supplied.
 */
export async function parseStartEnd(
  schedule: { date?: Date | string; time?: string; duration?: number } = {},
  startAt?: string,
  endAt?: string,
  timeZone: string = 'UTC'
): Promise<{ startAt: Date; endAt: Date }> {
  // 1) If explicit startAt passed — assume it's an ISO instant (UTC or offset) and compute end
  if (startAt) {
    const s = new Date(startAt);
    if (Number.isNaN(s.getTime())) throw new Error('Invalid startAt');
    const dur = Number(schedule.duration || 0);
    if (!Number.isFinite(dur) || dur <= 0)
      throw new Error('Invalid or missing duration for startAt');
    const e = new Date(s.getTime() + dur * 60_000);
    return { startAt: s, endAt: e };
  }

  // 2) Build from schedule
  if (!schedule.date || !schedule.time || !schedule.duration) {
    throw new Error('Missing schedule.date/time/duration');
  }

  const tz = normalizeTimezone(timeZone);

  // Normalize time to HH:MM 24-hour format
  const hhmm = normalizeToHHMM24(String(schedule.time));
  if (!hhmm) throw new Error('Invalid schedule.time format');
  const [hourStr, minuteStr] = hhmm.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  // figure out year/month/day from schedule.date
  let year: number, month: number, day: number;
  if (schedule.date instanceof Date) {
    const d = schedule.date;
    if (Number.isNaN(d.getTime())) throw new Error('Invalid schedule.date');
    // IMPORTANT: we must interpret the local Y/M/D *in the user's timezone*
    // fromJSDate will treat the JS Date instant as an absolute instant;
    // setZone(tz) will convert that instant into user's timezone and we take local Y/M/D.
    const dt = DateTime.fromJSDate(d, { zone: 'utc' }).setZone(tz);
    year = dt.year;
    month = dt.month;
    day = dt.day;
  } else if (typeof schedule.date === 'string') {
    const ds = schedule.date.trim();
    // Prefer "YYYY-MM-DD" plain date format
    const dateOnlyMatch = ds.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
      year = Number(dateOnlyMatch[1]);
      month = Number(dateOnlyMatch[2]);
      day = Number(dateOnlyMatch[3]);
    } else {
      // If front-end gave full ISO, parse it as instant and convert to user's zone to get the local date
      const parsedIso = DateTime.fromISO(ds, { setZone: true }); // preserve offset if present
      if (!parsedIso.isValid) throw new Error('Invalid schedule.date');
      const local = parsedIso.setZone(tz);
      year = local.year;
      month = local.month;
      day = local.day;
    }
  } else {
    throw new Error('Unsupported schedule.date type');
  }

  const dur = Number(schedule.duration);
  if (!Number.isFinite(dur) || dur <= 0) throw new Error('Invalid schedule.duration');

  // Build local DateTime in user's timezone and then convert to UTC JS Date
  const startDt = DateTime.fromObject({ year, month, day, hour, minute }, { zone: tz });
  if (!startDt.isValid) throw new Error('Failed to construct start datetime');

  const endDt = startDt.plus({ minutes: dur });

  const startUtc = startDt.toUTC().toJSDate();
  const endUtc = endDt.toUTC().toJSDate();

  return { startAt: startUtc, endAt: endUtc };
}

/** Helper: parse "HH:MM AM/PM" into 24h hours/minutes */
export function parseHHMM(hhmm: string) {
  const [hhStr, mmStr] = hhmm.split(':');
  const hours = Number(hhStr);
  const minutes = Number(mmStr);
  return { hours, minutes };
}

/**
 * Given an ISO date string or undefined and a timeZone, return UTC start/end instants for that day.
 * - isoDate can be YYYY-MM-DD (local date) or ISO instant. If undefined, uses now (in timezone).
 */
export function getDayRangeFromISO(isoDate?: string, timeZone: string = 'UTC') {
  const tz = normalizeTimezone(timeZone);

  const base = isoDate
    ? // If isoDate is "YYYY-MM-DD" treat as local date in timezone
      /^\d{4}-\d{2}-\d{2}$/.test(isoDate)
      ? DateTime.fromISO(isoDate, { zone: tz }).startOf('day')
      : DateTime.fromISO(isoDate, { zone: tz })
    : DateTime.now().setZone(tz);

  const start = base.startOf('day').toUTC().toJSDate();
  const end = base.endOf('day').toUTC().toJSDate();
  return { start, end };
}

/**
 * Given isoStartDate (YYYY-MM-DD or ISO) and weekStart (0=sun,1=mon) and timezone, return UTC start/end of that week.
 * Returns Date objects (UTC instants).
 */
export function getWeekRangeFromISO(
  isoStartDate?: string,
  weekStart: 0 | 1 = 1,
  timeZone: string = 'UTC'
) {
  const tz = normalizeTimezone(timeZone);

  // Determine an anchor in user's timezone
  const anchor = isoStartDate
    ? /^\d{4}-\d{2}-\d{2}$/.test(isoStartDate)
      ? DateTime.fromISO(isoStartDate, { zone: tz })
      : DateTime.fromISO(isoStartDate, { zone: tz })
    : DateTime.now().setZone(tz);

  // compute week start in that timezone
  // luxon's weekday: 1 = Monday ... 7 = Sunday
  const weekday = anchor.weekday; // 1..7
  const desired = weekStart === 1 ? 1 : 7; // weekStart: mon ->1, sun ->7
  const diffDays = (weekday - desired + 7) % 7;
  const weekStartDt = anchor.minus({ days: diffDays }).startOf('day');
  const weekEndDt = weekStartDt.plus({ days: 6 }).endOf('day');

  return { start: weekStartDt.toUTC().toJSDate(), end: weekEndDt.toUTC().toJSDate() };
}

/**
 * Normalize known aliases, e.g. "Asia/Calcutta" → "Asia/Kolkata"
 * and fallback to UTC if invalid.
 */
export function normalizeTimezone(tz?: string): string {
  if (!tz) return 'UTC';
  if (tz === 'Asia/Calcutta') return 'Asia/Kolkata';
  try {
    // validate using luxon
    const maybe = DateTime.now().setZone(tz);
    if (!maybe.isValid) return 'UTC';
    return tz;
  } catch {
    return 'UTC';
  }
}
