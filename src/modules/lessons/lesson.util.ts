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
export function parseStartEnd(
  schedule: { date?: Date | string; time?: string; duration?: number } = {},
  startAt?: string,
  endAt?: string
): { startAt: Date; endAt: Date } {
  // 1) Authoritative startAt path
  if (startAt) {
    const start = new Date(startAt);
    if (Number.isNaN(start.getTime())) throw new Error('Invalid startAt');
    const dur = Number(schedule.duration || 0);
    if (!Number.isFinite(dur) || dur <= 0)
      throw new Error('Invalid or missing duration for startAt');
    const end = new Date(start.getTime() + dur * 60_000);
    return { startAt: start, endAt: end };
  }

  // 2) Fallback: require schedule.date, schedule.time, schedule.duration
  if (!schedule.date || !schedule.time || !schedule.duration) {
    throw new Error('Missing schedule.date/time/duration');
  }

  // Normalize time to HH:MM (24h)
  const hhmm = normalizeToHHMM24(String(schedule.time));
  if (!hhmm) throw new Error('Invalid schedule.time format');

  const [hhStr, mmStr] = hhmm.split(':');
  const hour = Number(hhStr);
  const minute = Number(mmStr);

  // Normalize date -> derive year, month, day
  let year: number, monthIndex: number, day: number;

  if (schedule.date instanceof Date) {
    // Use the Date object provided (interpret its local Y/M/D)
    const d = schedule.date as Date;
    if (Number.isNaN(d.getTime())) throw new Error('Invalid schedule.date');
    year = d.getFullYear();
    monthIndex = d.getMonth();
    day = d.getDate();
  } else if (typeof schedule.date === 'string') {
    const ds = schedule.date.trim();

    // If it's a pure date "YYYY-MM-DD"
    const dateOnlyMatch = ds.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
      year = Number(dateOnlyMatch[1]);
      monthIndex = Number(dateOnlyMatch[2]) - 1;
      day = Number(dateOnlyMatch[3]);
    } else {
      // If it's an ISO string with time zone e.g. "2025-11-13T00:00:00.000Z"
      // parse to Date then extract year/month/day *in UTC date portion* or local depending on intent.
      // We'll assume the date string represents the day the user selected (most clients send "YYYY-MM-DD")
      // so extract YYYY-MM-DD from the ISO (first 10 chars) if present.
      const isoDatePartMatch = ds.match(/^(\d{4}-\d{2}-\d{2})/);
      if (isoDatePartMatch) {
        const [y, m, d] = isoDatePartMatch[1].split('-').map(Number);
        year = y;
        monthIndex = m - 1;
        day = d;
      } else {
        // as a last fallback try Date parse (less preferred)
        const parsed = new Date(ds);
        if (Number.isNaN(parsed.getTime())) throw new Error('Invalid schedule.date');
        year = parsed.getFullYear();
        monthIndex = parsed.getMonth();
        day = parsed.getDate();
      }
    }
  } else {
    throw new Error('Unsupported schedule.date type');
  }

  // Build a **local** Date using year/month/day/hour/minute (avoid ambiguous string parsing).
  // This ensures consistent local-time semantics and valid Date object.
  const localStart = new Date(year, monthIndex, day, hour, minute, 0, 0);
  if (Number.isNaN(localStart.getTime())) throw new Error('Failed to construct start date');

  const dur = Number(schedule.duration);
  if (!Number.isFinite(dur) || dur <= 0) throw new Error('Invalid schedule.duration');

  const localEnd = new Date(localStart.getTime() + dur * 60_000);
  return { startAt: localStart, endAt: localEnd };
}

/** Helper: parse "HH:MM AM/PM" into 24h hours/minutes */
export function parseHHMM(hhmm: string) {
  const [hhStr, mmStr] = hhmm.split(':');
  const hours = Number(hhStr);
  const minutes = Number(mmStr);
  return { hours, minutes };
}
