import { Types, Document } from 'mongoose';
import { TeacherSchedule, TeacherScheduleDoc } from '../../models/teacherSchedule.model';
import {
  ensureAligned,
  normalizeMinutes,
  normalizeTimes,
  toMinutes,
  toHHMM,
  weekdayFromISO,
  mapToPlain,
  buildSlotItemsFromMinutes,
  lessonExistsForWeekdaySlot,
  lessonExistsForDateSlot,
  getLessonMinutesForDate,
  weeklyBaselineForDate
} from './schedule.util';

type Lean<T> = Omit<T, keyof Document> & { _id: Types.ObjectId };
type ScheduleLean = Lean<TeacherScheduleDoc>;

export class ScheduleService {
  /** Fetch schedule or auto create and fetch schedule */
  static async getOrCreate(teacherId: Types.ObjectId): Promise<ScheduleLean> {
    const found = await TeacherSchedule.findOne({ teacherId }).lean<ScheduleLean>();
    if (found) return found;

    const created = await TeacherSchedule.create({
      teacherId,
      slotMinutes: 60,
      overrides: {}
    });

    return (await TeacherSchedule.findById(created._id).lean<ScheduleLean>())!;
  }

  /** Fetch schedule or null */
  static async get(teacherId: Types.ObjectId): Promise<ScheduleLean | null> {
    return TeacherSchedule.findOne({ teacherId }).lean<ScheduleLean>();
  }

  /** Upsert weekly + slotMinutes (PATCH creates doc if absent) */
  static async upsertWeekly(
    teacherId: Types.ObjectId,
    body: {
      slotMinutes?: number;
      weekly?: Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, string[]>>;
      month?: string;
    }
  ): Promise<ScheduleLean> {
    const existing = await TeacherSchedule.findOne({ teacherId });

    const slot = body.slotMinutes ?? existing?.slotMinutes ?? 60;

    // Validate alignment if weekly provided
    if (body.weekly) {
      for (const [k, arr] of Object.entries(body.weekly)) {
        const idx = Number(k) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
        const times = normalizeTimes(arr || []);
        const err = ensureAligned(times, slot);
        if (err) {
          const e = new Error(err);
          (e as any).code = '422_VALIDATION';
          (e as any).fields = [{ path: 'body.weekly', message: err }];
          throw e;
        }
      }
    }

    // Convert weekly strings -> minutes
    const weeklyMins: Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, number[]>> = {};
    if (body.weekly) {
      for (const [k, arr] of Object.entries(body.weekly)) {
        const idx = Number(k) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
        weeklyMins[idx] = normalizeTimes(arr || []).map(toMinutes);
      }
    }

    // If user provided a month -> operate on monthly[month]; else legacy weekly behavior
    const monthKey = body.month?.trim();

    // Validate that we are not removing weekly slots that are used by lessons
    if (body.weekly && existing) {
      // determine baseline array to compare against depending on target (monthly vs weekly)
      const conflicts: Array<{ weekday: number; slot: string }> = [];

      // existing source for comparison:
      const existingWeeklySource: Record<number, number[]> = {};
      // load existing weekly baseline (legacy)
      for (let dow = 0; dow <= 6; dow++) {
        existingWeeklySource[dow] = Array.isArray((existing.weekly as any)[dow])
          ? (existing.weekly as any)[dow]
          : [];
      }

      // if month provided, attempt to read existing monthly entry
      let existingMonthlyForMonth: Record<number, number[]> | null = null;
      if (
        monthKey &&
        existing.monthly &&
        Object.prototype.hasOwnProperty.call(existing.monthly, monthKey)
      ) {
        existingMonthlyForMonth = (existing.monthly as any)?.[monthKey] || null;
      }

      for (let dow = 0; dow <= 6; dow++) {
        const existingArr: number[] = existingMonthlyForMonth
          ? existingMonthlyForMonth[dow] || []
          : existingWeeklySource[dow] || [];
        const incomingArr: number[] = (weeklyMins as any)[dow] || [];
        const removed = existingArr.filter(m => !incomingArr.includes(m));
        for (const m of removed) {
          // if targetting a month -> check lessons for that month dates which fall on this weekday;
          // otherwise legacy behavior checks weekday across all lessons.
          if (monthKey) {
            // compute all dateISO strings for that month that have this weekday and check each date
            const [yyyy, mmStr] = monthKey.split('-').map(Number);
            const monthIndex = mmStr - 1;
            // iterate days of month and for those matching dow check lessonExistsForDateSlot
            const daysInMonth = new Date(yyyy, monthIndex + 1, 0).getDate();
            for (let d = 1; d <= daysInMonth; d++) {
              const dayISO = `${String(yyyy).padStart(4, '0')}-${String(mmStr).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              const weekday = weekdayFromISO(dayISO);
              if (weekday !== dow) continue;
              const exists = await lessonExistsForDateSlot(teacherId, dayISO, m);
              if (exists) {
                conflicts.push({ weekday: dow, slot: toHHMM(m) });
                break; // stop checking more dates once conflict found for this m
              }
            }
          } else {
            // legacy: check by weekday across all lessons
            const exists = await lessonExistsForWeekdaySlot(teacherId, dow, m);
            if (exists) conflicts.push({ weekday: dow, slot: toHHMM(m) });
          }
        }
      }

      if (conflicts.length) {
        const e = new Error('Cannot remove slots used by existing lessons');
        (e as any).code = '422_VALIDATION';
        (e as any).fields = conflicts.map(c => ({
          path: monthKey ? `body.monthly.${monthKey}.${c.weekday}` : `body.weekly.${c.weekday}`,
          message: `Slot ${c.slot} is used by existing lesson`
        }));
        throw e;
      }
    }

    // Build $set
    const $set: Partial<TeacherScheduleDoc> = {};
    if (body.slotMinutes) $set.slotMinutes = body.slotMinutes;

    if (body.weekly) {
      if (monthKey) {
        // we must merge or set the particular month's weekly mapping
        // build a safe object to set under monthly
        const monthlyMap = existing?.monthly ? mapToPlain<number[]>(existing.monthly) : {};
        monthlyMap[monthKey] = weeklyMins as any;
        $set.monthly = monthlyMap as any;
      } else {
        // legacy: update top-level weekly mapping
        $set.weekly = weeklyMins as any;
      }
    }

    const updated = await TeacherSchedule.findOneAndUpdate(
      { teacherId },
      { $set },
      { new: true, upsert: true }
    ).lean<ScheduleLean>();

    return updated!;
  }

  /** Return available slots for a specific date (override > weekly) as HH:MM[] */
  static async getSlotsForDate(
    teacherId: Types.ObjectId,
    dateISO: string
  ): Promise<{ slots: { disabled: boolean; minutes: number; label: string }[] }> {
    // Auto-create on first visit
    const sched = await this.getOrCreate(teacherId);
    const slot = sched.slotMinutes ?? 60;

    // Normalize overrides to plain object
    const overridesObj = mapToPlain<number[]>(sched.overrides);

    // If override key exists in overridesObj:
    if (Object.prototype.hasOwnProperty.call(overridesObj, dateISO)) {
      // explicit override (could be [] to block all slots)
      const overrideMins = overridesObj[dateISO] || [];
      // return slot items (disabled flags computed by checking lessons)
      const slotItems = buildSlotItemsFromMinutes(overrideMins, slot);
      // mark disabled where lessons already exist at that minute
      const usedMinutes = await getLessonMinutesForDate(teacherId, dateISO);
      return { slots: slotItems.map(s => ({ ...s, disabled: usedMinutes.has(s.minutes) })) };
    }

    // Monthly-only baseline:
    // Only use monthly baseline for the date's month. If the month entry is absent,
    // return empty slots (no default from legacy weekly or previous months).
    const monthKey = dateISO.slice(0, 7);
    const monthlyMap = (sched as any).monthly || {};
    const monthEntry = monthlyMap && monthlyMap[monthKey];
    const weeklyMins: number[] =
      monthEntry && Array.isArray(monthEntry[weekdayFromISO(dateISO)])
        ? (monthEntry[weekdayFromISO(dateISO)] as number[])
        : [];
    const slotItems = buildSlotItemsFromMinutes(weeklyMins, slot);

    // Determine lesson-used minutes for that date and mark disabled accordingly
    const usedMinutes = await getLessonMinutesForDate(teacherId, dateISO);

    return { slots: slotItems.map(s => ({ ...s, disabled: usedMinutes.has(s.minutes) })) };
  }

  /**
   * Fetch month-level schedule info for a given month "YYYY-MM".
   * Returns monthly weekly baseline (per weekday), overrides (per date), and optionally per-date slot items.
   */
  static async getSlotsForMonth(
    teacherId: Types.ObjectId,
    monthKey: string
  ): Promise<{
    month: string;
    weekly: Partial<Record<number, string[]>>;
    overrides: Record<string, { minutes: number; label: string; disabled: boolean }[]>;
    slotsByDate?: Record<string, { minutes: number; label: string; disabled: boolean }[]>;
  }> {
    // validate monthKey outside or assume correct (YYYY-MM)
    const sched = await this.getOrCreate(teacherId);
    const slot = sched.slotMinutes ?? 60;

    // build monthly weekly baseline from sched.monthly if present else fallback to sched.weekly
    const monthlyMap = (sched as any).monthly || {};
    const resultWeekly: Partial<Record<number, string[]>> = {};

    for (let dow = 0; dow <= 6; dow++) {
      // Use monthly baseline only (do not fallback to legacy weekly)
      const monthEntry = monthlyMap && monthlyMap[monthKey];
      const arr: number[] = monthEntry && Array.isArray(monthEntry[dow]) ? monthEntry[dow] : [];
      resultWeekly[dow] = (arr || []).map((m: number) => toHHMM(m));
    }

    // collect all overrides within that month (keys like YYYY-MM-DD)
    const overridesPlain = mapToPlain<number[]>((sched.overrides as any) || {});
    const overridesForMonth: Record<string, number[]> = {};
    const slotsByDate: Record<string, { minutes: number; label: string; disabled: boolean }[]> = {};

    // compute date range for the month
    const [yearStr, monthStr] = monthKey.split('-');
    const y = Number(yearStr);
    const m = Number(monthStr) - 1;
    const first = new Date(Date.UTC(y, m, 1));
    const last = new Date(Date.UTC(y, m + 1, 0));

    // iterate through days in month and prepare slot items
    for (let d = 1; d <= last.getUTCDate(); d++) {
      const yyyy = y;
      const mm = String(m + 1).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      const iso = `${yyyy}-${mm}-${dd}`;

      const overrideMins = overridesPlain[iso];
      let effectiveMins: number[] = [];

      if (Object.prototype.hasOwnProperty.call(overridesPlain, iso)) {
        effectiveMins = overrideMins || [];
      } else {
        // Monthly-only baseline for that weekday, or empty if month not defined.
        const dow = weekdayFromISO(iso);
        const baseline =
          (sched.monthly &&
            (sched.monthly as any)[monthKey] &&
            (sched.monthly as any)[monthKey][dow]) ||
          [];
        effectiveMins = Array.isArray(baseline) ? baseline : [];
      }

      // build slot items and mark disabled if lessons exist
      const slotItems = buildSlotItemsFromMinutes(effectiveMins, slot);
      const usedMinutes = await getLessonMinutesForDate(teacherId, iso);
      const finalItems = slotItems.map(s => ({ ...s, disabled: usedMinutes.has(s.minutes) }));

      slotsByDate[iso] = finalItems;
      if (Object.prototype.hasOwnProperty.call(overridesPlain, iso)) {
        overridesForMonth[iso] = overrideMins || [];
      }
    }

    return {
      month: monthKey,
      weekly: resultWeekly,
      overrides: Object.keys(overridesForMonth).length
        ? Object.fromEntries(Object.keys(overridesForMonth).map(d => [d, slotsByDate[d]]))
        : {},
      slotsByDate
    };
  }

  /** Add/remove/toggle slots for one date override (strings HH:MM) */
  static async patchDateSlots(
    teacherId: Types.ObjectId,
    body: { date: string; add?: string[]; remove?: string[]; toggle?: string[] }
  ): Promise<{ date: string; slots: string[] }> {
    // --------------------------
    // 1) Load schedule and validate
    // --------------------------
    const sched = await TeacherSchedule.findOne({ teacherId });
    const slot = sched?.slotMinutes ?? 60;

    const add = normalizeTimes(body.add || []);
    const remove = normalizeTimes(body.remove || []);
    const toggle = normalizeTimes(body.toggle || []);

    // ensure times align to slotMinutes
    for (const arr of [add, remove, toggle]) {
      const err = ensureAligned(arr, slot);
      if (err) {
        const e = new Error(err);
        (e as any).code = '422_VALIDATION';
        (e as any).fields = [{ path: 'body', message: err }];
        throw e;
      }
    }

    // Ensure doc exists for mutation (minimal safe defaults)
    const doc =
      sched ||
      (await TeacherSchedule.create({
        teacherId,
        slotMinutes: slot,
        weekly: {},
        monthly: {},
        overrides: {}
      }));

    // --------------------------
    // 2) Source-of-truth & working set
    //    priority: override -> monthly -> legacy weekly -> []
    // --------------------------
    const existingOverrides = mapToPlain<number[]>((doc.overrides as any) || {});
    const hasExistingOverride = Object.prototype.hasOwnProperty.call(existingOverrides, body.date);
    const currentOverride = hasExistingOverride ? existingOverrides[body.date] || [] : null;

    const baseline = weeklyBaselineForDate(doc as any, body.date) || [];

    // Source for applying deltas
    const source = hasExistingOverride ? currentOverride || [] : baseline;

    // Work with minutes set
    const working = new Set<number>((source || []).map(Number));
    add.map(toMinutes).forEach(m => working.add(m));
    remove.map(toMinutes).forEach(m => working.delete(m));
    toggle.map(toMinutes).forEach(m => (working.has(m) ? working.delete(m) : working.add(m)));

    const resulting = Array.from(working).sort((a, b) => a - b);

    // --------------------------
    // 3) Validate removals against existing lessons
    //    (removals are computed relative to the authoritative previous set)
    // --------------------------
    const removedComparedTo = hasExistingOverride ? currentOverride || [] : baseline;
    const removed = (removedComparedTo || []).filter(m => !resulting.includes(m));

    const conflicts: Array<{ slot: string }> = [];
    for (const m of removed) {
      const exists = await lessonExistsForDateSlot(teacherId, body.date, m);
      if (exists) conflicts.push({ slot: toHHMM(m) });
    }
    if (conflicts.length) {
      const e = new Error('Cannot remove slots used by existing lessons on this date');
      (e as any).code = '422_VALIDATION';
      (e as any).fields = conflicts.map(c => ({
        path: 'body',
        message: `Slot ${c.slot} is used by a lesson on ${body.date}`
      }));
      throw e;
    }

    // --------------------------
    // 4) Persist: only update overrides map
    //    - If resulting equals baseline AND the user did NOT explicitly operate to make it empty,
    //      then remove the override (no-op). BUT:
    //    - If resulting is empty but the user provided operations (explicit removal), persist explicit empty override.
    // --------------------------
    const baselineSorted = (baseline || []).slice().sort((a, b) => a - b);
    const equalToBaseline =
      resulting.length === baselineSorted.length &&
      resulting.every((v, i) => baselineSorted[i] === v);

    const userDidMutate = !!(add.length || remove.length || toggle.length);

    if (equalToBaseline) {
      if (userDidMutate) {
        // user operated but resulting matches baseline:
        // if resulting is empty -> persist explicit empty override (requirement #6)
        if (resulting.length === 0) {
          existingOverrides[body.date] = [];
        } else {
          // user mutated but final matches baseline -> delete override (no-op)
          if (hasExistingOverride) delete existingOverrides[body.date];
        }
      } else {
        // no user mutation & equals baseline -> no-op
        // (shouldn't happen normally; do nothing)
      }
    } else {
      // different from baseline -> persist explicit override (even if empty due to explicit removes)
      existingOverrides[body.date] = resulting;
    }

    const updated = await TeacherSchedule.findOneAndUpdate(
      { teacherId },
      { $set: { overrides: existingOverrides } },
      { new: true, upsert: true, lean: true }
    );

    const updatedOverrides = mapToPlain<number[]>((updated?.overrides as any) || {});
    const hasOverrideAfter = Object.prototype.hasOwnProperty.call(updatedOverrides, body.date);
    const effectiveMinutes = hasOverrideAfter ? updatedOverrides[body.date] || [] : baseline;
    return {
      date: body.date,
      slots: normalizeMinutes(effectiveMinutes || [])?.map(toHHMM)
    };
  }

  /** Validate a lesson block against the schedule for a given date */
  static async validateBlock(
    teacherId: Types.ObjectId,
    body: { date: string; start: string; end: string }
  ): Promise<{ ok: boolean; reasons?: string[] }> {
    const sched = await this.get(teacherId);
    if (!sched) return { ok: false, reasons: ['NO_SCHEDULE'] };

    const slot = sched.slotMinutes ?? 60;
    const slotsRes = await this.getSlotsForDate(teacherId, body.date);
    if (!slotsRes?.slots?.length) return { ok: false, reasons: ['OUTSIDE_AVAILABILITY'] };

    // Alignment
    const alignErr = ensureAligned([body.start, body.end], slot);
    if (alignErr) return { ok: false, reasons: ['NOT_ALIGNED'] };

    const s = toMinutes(body.start);
    const e = toMinutes(body.end);
    if (e <= s) return { ok: false, reasons: ['END_BEFORE_START'] };

    // Build a set of available minutes for quick containment check
    const available = new Set(slotsRes.slots.map(si => si.minutes));
    for (let t = s; t < e; t += slot) {
      if (!available.has(t)) return { ok: false, reasons: ['OUTSIDE_AVAILABILITY'] };
    }

    return { ok: true };
  }
}
