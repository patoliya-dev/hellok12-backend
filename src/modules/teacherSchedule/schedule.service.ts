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
    body: { slotMinutes?: number; weekly?: Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, string[]>> }
  ): Promise<ScheduleLean> {
    // Fetch current or create defaults in memory (but write on update)
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

    // === Validate that we are not removing weekly slots that are used by lessons ===
    if (body.weekly && existing) {
      // For each weekday, detect removed slots (existing minus incoming) and check lessons
      const conflicts: Array<{ weekday: number; slot: string }> = [];

      const incomingWeeklyMins: Partial<Record<number, number[]>> = {};
      for (const k of Object.keys(body.weekly)) {
        const idx = Number(k);
        incomingWeeklyMins[idx] = (body.weekly as any)[k]
          ? normalizeTimes((body.weekly as any)[k]).map(toMinutes)
          : [];
      }

      for (let dow = 0; dow <= 6; dow++) {
        const existingArr: number[] = (existing.weekly && (existing.weekly as any)[dow]) || [];
        const incomingArr: number[] = incomingWeeklyMins[dow] || [];
        const removed = existingArr.filter(m => !incomingArr.includes(m));
        for (const m of removed) {
          const exists = await lessonExistsForWeekdaySlot(teacherId, dow, m);
          if (exists) {
            conflicts.push({ weekday: dow, slot: toHHMM(m) });
          }
        }
      }

      if (conflicts.length) {
        const e = new Error('Cannot remove slots used by existing lessons');
        (e as any).code = '422_VALIDATION';
        (e as any).fields = conflicts.map(c => ({
          path: `body.weekly.${c.weekday}`,
          message: `Slot ${c.slot} is used by existing lesson`
        }));
        throw e;
      }
    }

    const $set: Partial<TeacherScheduleDoc> = {};
    if (body.slotMinutes) $set.slotMinutes = body.slotMinutes;
    if (body.weekly) $set.weekly = weeklyMins as any;

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

    // Fallback: compute from weekly by weekday
    const w = weekdayFromISO(dateISO) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const weeklyMins = (sched.weekly && (sched.weekly as any)[w]) || [];

    const slotItems = buildSlotItemsFromMinutes(weeklyMins, slot);

    // Determine lesson-used minutes for that date and mark disabled accordingly
    const usedMinutes = await getLessonMinutesForDate(teacherId, dateISO);

    return { slots: slotItems.map(s => ({ ...s, disabled: usedMinutes.has(s.minutes) })) };
  }

  /** Add/remove/toggle slots for one date override (strings HH:MM) */
  static async patchDateSlots(
    teacherId: Types.ObjectId,
    body: { date: string; add?: string[]; remove?: string[]; toggle?: string[] }
  ): Promise<{ date: string; slots: string[] }> {
    const sched = await TeacherSchedule.findOne({ teacherId });
    const slot = sched?.slotMinutes ?? 60;

    const add = normalizeTimes(body.add || []);
    const remove = normalizeTimes(body.remove || []);
    const toggle = normalizeTimes(body.toggle || []);

    for (const arr of [add, remove, toggle]) {
      const err = ensureAligned(arr, slot);
      if (err) {
        const e = new Error(err);
        (e as any).code = '422_VALIDATION';
        (e as any).fields = [{ path: 'body', message: err }];
        throw e;
      }
    }

    // Ensure doc exists if we’re mutating
    const doc =
      sched ||
      (await TeacherSchedule.create({
        teacherId,
        slotMinutes: slot,
        weekly: {},
        overrides: {}
      }));

    // Map-safe read/update
    const existingOverrides = mapToPlain<number[]>(doc.overrides);
    const hasExistingOverride = Object.prototype.hasOwnProperty.call(existingOverrides, body.date);
    const current = hasExistingOverride ? existingOverrides[body.date] || [] : null;

    // Determine the starting point for edits:
    //  If an override exists -> start from that.
    //  Else -> start from weekly baseline (prevents accidental loss of weekly on first change).
    const baseline = weeklyBaselineForDate(sched as any, body.date);
    const startMinutes = hasExistingOverride ? current : baseline;

    const set = new Set(startMinutes);
    add.map(toMinutes).forEach(m => set.add(m));
    remove.map(toMinutes).forEach(m => set.delete(m));
    toggle.map(toMinutes).forEach(m => (set.has(m) ? set.delete(m) : set.add(m)));

    // === NEW: Validate we are not removing slots used by lessons on this date ===
    const resulting = Array.from(set).sort((a, b) => a - b);
    const removedSlots: number[] = current ? current.filter(m => !resulting.includes(m)) : [];

    const conflicts: Array<{ slot: string }> = [];
    for (const m of removedSlots) {
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

    existingOverrides[body.date] = resulting;

    const updated = await TeacherSchedule.findOneAndUpdate(
      { teacherId },
      // write plain object; Mongoose will cast back to Map<date, number[]>
      { $set: { overrides: existingOverrides } },
      { new: true, upsert: true, lean: true }
    );

    // Map-safe read (even if lean returns Map on some drivers)
    const updatedOverrides = mapToPlain<number[]>(updated?.overrides);
    const hasOverrideAfter = Object.prototype.hasOwnProperty.call(updatedOverrides, body.date);
    const effectiveMinutes = hasOverrideAfter ? updatedOverrides[body.date] || [] : baseline;
    return {
      date: body.date,
      slots: normalizeMinutes(effectiveMinutes)?.map(toHHMM)
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
