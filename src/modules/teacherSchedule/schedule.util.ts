import { DateTime } from 'luxon';
import { Document, Types } from 'mongoose';
import { TeacherScheduleDoc } from '../../models/teacherSchedule.model';
import { Lesson } from '../../models/lesson.model';
import { getDayRangeFromISO } from '../lessons/lesson.util';

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

// timezone-aware weekday helper (0=Sun .. 6=Sat)
export function weekdayFromISO(date: string, timeZone: string = 'UTC'): number {
  try {
    const dt = DateTime.fromISO(date, { zone: timeZone });
    if (!dt.isValid) {
      // fallback to UTC parsing
      return new Date(date + 'T00:00:00.000Z').getUTCDay();
    }
    // Luxon's weekday: 1 = Monday ... 7 = Sunday. Convert to 0=Sun..6=Sat
    return dt.weekday % 7;
  } catch {
    return new Date(date + 'T00:00:00.000Z').getUTCDay();
  }
}

// Normalizes a Mongoose Map<string, number[]> or plain object into a plain object
export function mapToPlain<T = number[]>(input: any): Record<string, T> {
  if (!input) return {};
  if (input instanceof Map) return Object.fromEntries(input as Map<string, T>);
  return input as Record<string, T>;
}

// Helper: build array of slot items from minutes array
export function buildSlotItemsFromMinutes(
  mins: number[],
  slotMinutes: number
): { minutes: number; label: string }[] {
  // normalize & sort
  const normalized = normalizeMinutes(mins || []);
  return normalized.map(m => ({
    minutes: m,
    label: toHHMM(m) // HH:MM (24h) — frontend can format to 12h if desired
    // disabled will be filled later if lessons exist
  }));
}

/**
 * Return array of { start: number, end: number } intervals (minutes-of-day in teacher's timezone)
 * for all lessons that start on the given dateISO (teacher-local day).
 *
 * We:
 *  - compute UTC start/end instants for the teacher-local day using getDayRangeFromISO
 *  - query lessons by startAt between those UTC instants (authoritative)
 *  - convert each lesson's startAt/endAt into teacher timezone and return local minute intervals
 */
export async function getLessonMinuteIntervalsForDate(
  teacherId: Types.ObjectId,
  dateISO: string,
  timeZone: string = 'UTC'
): Promise<Array<{ start: number; end: number }>> {
  // compute UTC day range that corresponds to the *teacher's* local date
  const { start: startUtc, end: endUtc } = getDayRangeFromISO(dateISO, timeZone);

  // Query lessons by startAt (UTC instants falling within that teacher-day)
  const lessons = await Lesson.find({
    teacherId,
    startAt: { $gte: startUtc, $lte: endUtc }
  })
    .select({ startAt: 1, endAt: 1 })
    .lean();

  const intervals: Array<{ start: number; end: number }> = [];

  for (const l of lessons) {
    if (!l?.startAt || !l?.endAt) continue;
    try {
      const s = DateTime.fromJSDate(new Date(l.startAt)).setZone(timeZone);
      const e = DateTime.fromJSDate(new Date(l.endAt)).setZone(timeZone);
      if (!s.isValid || !e.isValid) continue;
      const startMin = s.hour * 60 + s.minute;
      const endMin = e.hour * 60 + e.minute;
      // if lesson goes past midnight in local zone, clamp into 0..1440 interval or split if needed.
      // For slot matching within a single day, clamp to day's boundaries.
      const clampedStart = Math.max(0, Math.min(24 * 60, startMin));
      const clampedEnd = Math.max(0, Math.min(24 * 60, endMin));
      if (clampedEnd > clampedStart) intervals.push({ start: clampedStart, end: clampedEnd });
    } catch (err) {
      continue;
    }
  }

  return intervals;
}

/**
 * Backward-compatible helper: if some code still expects a Set of minutes (start times),
 * you can call getLessonMinuteIntervalsForDate and derive the set of starts:
 */
export async function getLessonMinutesForDate(
  teacherId: Types.ObjectId,
  dateISO: string,
  timeZone: string = 'UTC'
): Promise<Set<number>> {
  const intervals = await getLessonMinuteIntervalsForDate(teacherId, dateISO, timeZone);
  const set = new Set<number>();
  for (const iv of intervals) set.add(iv.start);
  return set;
}

// -------------------------
// Helpers for lesson checks
// -------------------------
/**
 * Checks if there exists any lesson for teacher that falls on the given weekday (0=Sun..6=Sat)
 * and has start time equal to minute (minute-of-day).
 *
 * NOTE: This implementation fetches lessons for the teacher and filters in JS for clarity.
 * If teachers have many lessons, convert to a Mongo-side filter using $expr/$dayOfWeek/$hour/$minute.
 */
export async function lessonExistsForWeekdaySlot(
  teacherId: Types.ObjectId,
  weekday: number,
  minute: number,
  timeZone: string = 'UTC'
): Promise<boolean> {
  // Fetch lessons for the teacher and base weekday on lesson.startAt in teacher timezone
  const lessons = await Lesson.find({ teacherId }).select({ schedule: 1, startAt: 1 }).lean();
  for (const l of lessons) {
    if (!l?.startAt) continue;
    try {
      const dt = DateTime.fromJSDate(new Date(l.startAt)).setZone(timeZone);
      if (!dt.isValid) continue;
      const lessonWeekday = dt.weekday % 7; // convert 1..7 -> 0..6 with Sunday=0
      if (lessonWeekday !== weekday) continue;

      const hhmm = parseTimeToMinutes(l?.schedule?.time, l.startAt);

      // console.debug(`Checking lessonExistsForWeekdaySlot: startAt=${l.startAt}, time=${l?.schedule?.time}, hhmm=${hhmm}, minute=${minute}`);
      if (Number.isFinite(hhmm) && hhmm === minute) return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Normalize an array of mixed minute/string values to numeric minutes.
 * Accepts numbers (kept), "HH:MM" strings, "h:mm AM/PM" strings, or mixed.
 * Returns a sorted, unique array of numeric minutes.
 */
export function normalizeMinutesArray(values: Array<number | string | undefined | null>): number[] {
  const out: number[] = [];
  for (const v of values || []) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'number') {
      if (Number.isFinite(v)) out.push(v);
      continue;
    }
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) continue;
      // Try parse as 24h "HH:MM"
      try {
        const n = toMinutes(s);
        if (Number.isFinite(n)) {
          out.push(n);
          continue;
        }
      } catch {
        // fallthrough to other parse
      }
      // try 12h parse "h:mm AM/PM"
      const m = s.toUpperCase().match(/^(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)$/);
      if (m) {
        let h = Number(m[1]);
        const mm = m[2] ? Number(m[2]) : 0;
        const suffix = m[3];
        if (h === 12) h = 0;
        if (suffix === 'PM') h += 12;
        out.push(h * 60 + mm);
        continue;
      }
      // If still not parsed, skip
    }
  }
  // unique + sort
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

/**
 * Checks if there exists any lesson for teacher on specific date (YYYY-MM-DD) with start time equal to minute.
 */
export async function lessonExistsForDateSlot(
  teacherId: Types.ObjectId,
  dateISO: string,
  minute: number,
  timeZone: string = 'UTC'
): Promise<boolean> {
  // Use the timezone-correct interval resolver
  const intervals = await getLessonMinuteIntervalsForDate(teacherId, dateISO, timeZone);

  // Slot is considered "used" if any lesson starts exactly on that minute
  return intervals.some(iv => iv.start === minute);
}

type Lean<T> = Omit<T, keyof Document> & { _id: Types.ObjectId };
type ScheduleLean = Lean<TeacherScheduleDoc>;

/** Return the weekly baseline (minutes[]) for a given ISO date (YYYY-MM-DD). */
export function weeklyBaselineForDate(
  sched: ScheduleLean | TeacherScheduleDoc,
  dateISO: string
): number[] {
  const w = weekdayFromISO(dateISO) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  // monthKey: YYYY-MM
  const monthKey = dateISO.slice(0, 7);
  // Monthly-first behavior:
  // If teacher has an explicit monthly baseline for the given monthKey, return it.
  // IMPORTANT: Do NOT fall back to legacy `weekly` automatically — if the month entry
  // does not exist, we treat baseline as empty (no default schedule).
  if (sched.monthly && Object.prototype.hasOwnProperty.call(sched.monthly as any, monthKey)) {
    const monthlyAny = (sched.monthly as any)[monthKey] || {};
    const list: number[] = Array.isArray(monthlyAny[w]) ? monthlyAny[w] : [];
    return normalizeMinutes(list);
  }

  // No monthly entry: return empty baseline so frontend shows empty slots.
  return [];
}

/**
 * Parse a schedule.time string OR fallback to a startAt Date to return minute-of-day (UTC).
 * Accepts:
 *  - "HH:MM" (24h)
 *  - "h:mm AM/PM"
 *  - "HH" or "H" (hours)
 *  - if timeStr absent or unparsable, will use startAt (Date) if provided.
 *
 * Returns number minutes (0..1439) or null if cannot parse.
 */
export function parseTimeToMinutes(
  timeStr?: string | null,
  startAt?: string | Date | null
): number | null {
  if (typeof timeStr === 'string' && timeStr.trim()) {
    const s = timeStr.trim();
    // Attempt 24h HH:MM or HH
    const re24 = /^([01]?\d|2[0-3])(?::([0-5]\d))?$/;
    const m24 = s.match(re24);
    if (m24) {
      const hh = Number(m24[1]);
      const mm = m24[2] ? Number(m24[2]) : 0;
      return hh * 60 + mm;
    }

    // attempt 12h
    const re12 = /^(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)$/i;
    const m12 = s.match(re12);
    if (m12) {
      let h = Number(m12[1]);
      const mm = m12[2] ? Number(m12[2]) : 0;
      const ampm = m12[3].toUpperCase();
      if (h === 12) h = 0;
      if (ampm === 'PM') h += 12;
      return h * 60 + mm;
    }
    // fallback: try parse "H" or "HH" as whole hour
    const reHour = /^([0-1]?\d|2[0-3])$/;
    if (reHour.test(s)) {
      return Number(s) * 60;
    }
  }

  // fallback to startAt (Date) if available (use UTC hours/minutes to match other logic)
  if (startAt) {
    const d =
      typeof startAt === 'string'
        ? new Date(startAt)
        : startAt instanceof Date
          ? startAt
          : new Date(String(startAt));
    if (!isNaN(d.getTime())) {
      return d.getUTCHours() * 60 + d.getUTCMinutes();
    }
  }

  return null;
}
