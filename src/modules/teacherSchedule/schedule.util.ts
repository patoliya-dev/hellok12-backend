import { Document, Types } from 'mongoose';
import { Lesson } from '../../models/lesson.model';
import { TeacherScheduleDoc } from '../../models/teacherSchedule.model';

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
  minute: number
): Promise<boolean> {
  // We fetch lessons for teacher and filter in JS — acceptable for moderate counts; optimize if needed.
  const lessons = await Lesson.find({ teacherId }).select({ schedule: 1 }).lean();
  for (const l of lessons) {
    if (!l?.schedule?.date) continue;
    const d = new Date(l.schedule?.date);
    // use UTC day/time (consistent with schedule util which uses UTC)
    if (d.getUTCDay() !== weekday) continue;
    // const hhmm = d.getUTCHours() * 60 + d.getUTCMinutes();
    // Convert '10:00 AM' to minutes (10*60 = 600)
    const timeStr = l.schedule.time.trim();
    const [time, period] = timeStr.split(' ');
    let [hours, mins] = time.split(':').map(Number);
    if (Number.isNaN(hours)) hours = 0;
    if (Number.isNaN(mins)) mins = 0;
    if (period?.toUpperCase() === 'PM' && hours !== 12) hours += 12;
    if (period?.toUpperCase() === 'AM' && hours === 12) hours = 0;
    const hhmm = hours * 60 + mins;

    console.log('Checking lessonExistsForWeekdaySlot slot:', {
      date: l.schedule.date,
      time: l.schedule.time,
      hhmm,
      minute
    });

    if (hhmm === minute) return true;
  }
  return false;
}

/**
 * Checks if there exists any lesson for teacher on specific date (YYYY-MM-DD) with start time equal to minute.
 */
export async function lessonExistsForDateSlot(
  teacherId: Types.ObjectId,
  dateISO: string,
  minute: number
): Promise<boolean> {
  const dateStart = new Date(dateISO + 'T00:00:00.000Z');
  const dateEnd = new Date(dateISO + 'T23:59:59.999Z');

  const lessons = await Lesson.find({
    teacherId,
    'schedule.date': { $gte: dateStart, $lte: dateEnd }
  })
    .select({ schedule: 1 })
    .lean();

  for (const l of lessons) {
    if (!l?.schedule?.date || !l.schedule?.time) continue;
    // Convert '10:00 AM' to minutes (10*60 = 600)
    const timeStr = l.schedule?.time?.trim();
    const [time, period] = timeStr.split(' ');
    let [hours, mins] = time.split(':').map(Number);
    if (Number.isNaN(hours)) hours = 0;
    if (Number.isNaN(mins)) mins = 0;
    if (period?.toUpperCase() === 'PM' && hours !== 12) hours += 12;
    if (period?.toUpperCase() === 'AM' && hours === 12) hours = 0;
    const hhmm = hours * 60 + mins;

    console.log('Checking lessonExistsForDateSlot slot:', {
      date: l.schedule.date,
      time: l.schedule.time,
      hhmm,
      minute
    });
    if (hhmm === minute) return true;
  }
  return false;
}

export async function getLessonMinutesForDate(
  teacherId: Types.ObjectId,
  dateISO: string
): Promise<Set<number>> {
  const dateStart = new Date(dateISO + 'T00:00:00.000Z');
  const dateEnd = new Date(dateISO + 'T23:59:59.999Z');

  const lessons = await Lesson.find({
    teacherId,
    'schedule.date': { $gte: dateStart, $lte: dateEnd }
  })
    .select({ 'schedule.time': 1, startAt: 1 })
    .lean();

  const out = new Set<number>();

  for (const l of lessons) {
    // Prefer schedule.time
    const timeStr = l?.schedule?.time;
    let mins: number | null = null;

    if (typeof timeStr === 'string') {
      // parse 12h format "10:00 AM", "2:30 PM", "10 AM"
      const m = timeStr
        .trim()
        .toUpperCase()
        .match(/^(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)$/);
      if (m) {
        let h = Number(m[1]);
        const mm = m[2] ? Number(m[2]) : 0;
        const suffix = m[3];
        if (h === 12) h = 0;
        if (suffix === 'PM') h += 12;
        mins = h * 60 + mm;
      }
    }

    // fallback to startAt if schedule.time not parseable
    if (mins === null || mins === undefined) {
      if (l?.startAt) {
        const d = new Date(l.startAt);
        // use UTC to match dateISO boundaries above
        mins = d.getUTCHours() * 60 + d.getUTCMinutes();
      }
    }

    if (Number.isFinite(mins)) out.add(mins as number);
  }

  return out;
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
