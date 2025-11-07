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

    // normalize overrides (Map → plain object) before indexing
    const overridesObj = mapToPlain<number[]>(sched.overrides);
    const override = overridesObj[dateISO];

    if (override && override.length) {
      return { slots: normalizeMinutes(override).map(toHHMM) };
    }

    // weekly fallback
    const w = weekdayFromISO(dateISO) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const mins = (sched.weekly && (sched.weekly as any)[w]) || [];
    return { slots: normalizeMinutes(mins).map(toHHMM) };
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

    // Ensure doc exists if mutating
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
    const current = existingOverrides[body.date] || [];
    const set = new Set(current);

    add.map(toMinutes).forEach(m => set.add(m));
    remove.map(toMinutes).forEach(m => set.delete(m));
    toggle.map(toMinutes).forEach(m => (set.has(m) ? set.delete(m) : set.add(m)));

    existingOverrides[body.date] = Array.from(set).sort((a, b) => a - b);

    const updated = await TeacherSchedule.findOneAndUpdate(
      { teacherId },
      // write plain object; Mongoose will cast back to Map<date, number[]>
      { $set: { overrides: existingOverrides } },
      { new: true, upsert: true, lean: true }
    );

    // Map-safe read (even if lean returns Map on some drivers)
    const updatedOverrides = mapToPlain<number[]>(updated?.overrides);
    return {
      date: body.date,
      slots: normalizeMinutes(updatedOverrides[body.date] || []).map(toHHMM)
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
