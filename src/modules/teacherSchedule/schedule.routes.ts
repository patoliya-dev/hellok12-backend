import { Router } from 'express';
import { authenticate, authorize } from '../../middlewares/auth';
import { validateRequest } from '../../middlewares/validation';
import {
  getScheduleSchema,
  upsertWeeklySchema,
  getSlotsForDateSchema,
  patchDateSlotsSchema,
  validateLessonBlockSchema,
  getSlotsForMonthSchema
} from './schedule.schemas';
import * as ctrl from './schedule.controller';

const r = Router();
const allow = ['teacher', 'school', 'super_admin']; // extend if admins need access

// 1) Read schedule (no auto-create)
r.get(
  '/:teacherId/schedule',
  authenticate,
  authorize(allow),
  validateRequest(getScheduleSchema),
  ctrl.getSchedule
);

// 2) Upsert weekly + slotMinutes
r.patch(
  '/:teacherId/schedule',
  authenticate,
  authorize(allow),
  validateRequest(upsertWeeklySchema),
  ctrl.upsertWeekly
);

// 3) Get slots for a specific date (for lesson time picker)
r.get(
  '/:teacherId/schedule/slots',
  authenticate,
  authorize(allow),
  validateRequest(getSlotsForDateSchema),
  ctrl.getSlotsForDate
);

r.get(
  '/:teacherId/schedule/month',
  authenticate,
  authorize(allow),
  validateRequest(getSlotsForMonthSchema),
  ctrl.getSlotsForMonth
);

// 4) Patch slots for a specific date (override add/remove/toggle)
r.post(
  '/:teacherId/schedule/date',
  authenticate,
  authorize(allow),
  validateRequest(patchDateSlotsSchema),
  ctrl.patchDateSlots
);

// 5) Validate a proposed lesson block
r.post(
  '/:teacherId/schedule/validate',
  authenticate,
  authorize(allow),
  validateRequest(validateLessonBlockSchema),
  ctrl.validateLessonBlock
);

export default r;
