import { Types, Document } from 'mongoose';
import { TeacherSchedule, TeacherScheduleDoc } from '../../models/teacherSchedule.model';
import {
  ensureAligned,
  normalizeMinutes,
  normalizeTimes,
  toMinutes,
  toHHMM,
  weekdayFromISO,
  mapToPlain
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
  ): Promise<{ slots: string[] }> {
    // Auto-create on first visit
    const sched = await this.getOrCreate(teacherId);

    const overridesObj = mapToPlain<number[]>(sched.overrides);

    // Distinguish between “no entry” and “empty array”
    if (Object.prototype.hasOwnProperty.call(overridesObj, dateISO)) {
      const override = overridesObj[dateISO] || [];
      // Return exactly what's stored, even if empty
      return { slots: normalizeMinutes(override).map(toHHMM) };
    }

    // Fallback to weekly if no override entry
    const w = weekdayFromISO(dateISO) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const mins = (sched.weekly && (sched.weekly as any)[w]) || [];
    return { slots: normalizeMinutes(mins).map(toHHMM) };
  }

  // ---------------- helpers ----------------

  /** Return the weekly baseline (minutes[]) for a given ISO date (YYYY-MM-DD). */
  private static weeklyBaselineForDate(
    sched: ScheduleLean | TeacherScheduleDoc,
    dateISO: string
  ): number[] {
    const w = weekdayFromISO(dateISO) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const weeklyAny = (sched.weekly as any) || {};
    const list: number[] = Array.isArray(weeklyAny[w]) ? weeklyAny[w] : [];
    return normalizeMinutes(list);
  }

  /** Convert an HH:MM[] list to minutes[], aligned/validated against the slot size. */
  private static validateAndToMinutes(
    times: string[],
    slotMinutes: number,
    field: string
  ): number[] {
    const normTimes = normalizeTimes(times || []);
    const err = ensureAligned(normTimes, slotMinutes);
    if (err) {
      const e = new Error(err);
      (e as any).code = '422_VALIDATION';
      (e as any).fields = [{ path: field, message: err }];
      throw e;
    }
    return normTimes.map(toMinutes);
  }

  /** Add/remove/toggle slots for one date override (strings HH:MM) */
  static async patchDateSlots(
    teacherId: Types.ObjectId,
    body: { date: string; add?: string[]; remove?: string[]; toggle?: string[] }
  ): Promise<{ date: string; slots: string[] }> {
    let sched = await TeacherSchedule.findOne({ teacherId });
    if (!sched) {
      sched = await TeacherSchedule.create({
        teacherId,
        slotMinutes: 60,
        weekly: {},
        overrides: {}
      });
    }

    const slot = sched.slotMinutes ?? 60;

    // Validate inputs and convert to minutes
    const addMins = body.add ? this.validateAndToMinutes(body.add, slot, 'body.add') : [];
    const removeMins = body.remove
      ? this.validateAndToMinutes(body.remove, slot, 'body.remove')
      : [];
    const toggleMins = body.toggle
      ? this.validateAndToMinutes(body.toggle, slot, 'body.toggle')
      : [];

    // Normalize overrides map to a plain object for safe read/write.
    const overridesObj = mapToPlain<number[]>(sched.overrides);
    const hasExistingOverride = Object.prototype.hasOwnProperty.call(overridesObj, body.date);
    const currentOverride = hasExistingOverride ? overridesObj[body.date] || [] : null;

    // Determine the starting point for edits:
    //  If an override exists -> start from that.
    //  Else -> start from weekly baseline (prevents accidental loss of weekly on first change).
    const baseline = this.weeklyBaselineForDate(sched as any, body.date);
    const startMinutes = hasExistingOverride ? currentOverride : baseline;

    // Apply operations
    const set = new Set<number>(startMinutes);
    addMins.forEach(m => set.add(m));
    removeMins.forEach(m => set.delete(m));
    toggleMins.forEach(m => (set.has(m) ? set.delete(m) : set.add(m)));

    // Build the next value
    const nextMinutes = normalizeMinutes(Array.from(set));

    // If next == baseline -> remove override (clean up).
    // Else -> persist override for that date.
    const baselineStr = JSON.stringify(baseline);
    const nextStr = JSON.stringify(nextMinutes);

    if (nextStr === baselineStr) {
      if (hasExistingOverride) {
        delete overridesObj[body.date];
      }
    } else {
      overridesObj[body.date] = nextMinutes;
    }

    // Persist the overrides (write plain object; Mongoose casts back to Map)
    const updated = await TeacherSchedule.findOneAndUpdate(
      { teacherId },
      { $set: { overrides: overridesObj } },
      { new: true, upsert: true, lean: true }
    );

    // Compute effective slots for response:
    //  If override exists after save -> return it.
    //  Else -> return weekly baseline (so UI reflects "back to default").
    const updatedOverrides = mapToPlain<number[]>(updated?.overrides);
    const hasOverrideAfter = Object.prototype.hasOwnProperty.call(updatedOverrides, body.date);
    const effectiveMinutes = hasOverrideAfter ? updatedOverrides[body.date] || [] : baseline;

    return {
      date: body.date,
      slots: normalizeMinutes(effectiveMinutes).map(toHHMM)
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
    const { slots } = await this.getSlotsForDate(teacherId, body.date);
    if (!slots.length) return { ok: false, reasons: ['OUTSIDE_AVAILABILITY'] };

    // Alignment
    const alignErr = ensureAligned([body.start, body.end], slot);
    if (alignErr) return { ok: false, reasons: ['NOT_ALIGNED'] };

    const s = toMinutes(body.start);
    const e = toMinutes(body.end);
    if (e <= s) return { ok: false, reasons: ['END_BEFORE_START'] };

    // Build a set of available minutes for quick containment check
    const available = new Set(slots.map(toMinutes));
    for (let t = s; t < e; t += slot) {
      if (!available.has(t)) return { ok: false, reasons: ['OUTSIDE_AVAILABILITY'] };
    }

    return { ok: true };
  }
}
