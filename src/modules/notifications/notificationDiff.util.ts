import { DateTime } from 'luxon';

export type NotificationDiffValue =
  | string
  | number
  | boolean
  | null
  | {
      raw: string | null;
      label: string;
    };

export type NotificationDiffEntry = {
  field: string;
  label: string;
  before: NotificationDiffValue;
  after: NotificationDiffValue;
};

type DiffConfig<T = any> = {
  field: string;
  label: string;
  getBefore: (row: T) => any;
  getAfter: (row: T) => any;
  serialize?: (value: any, timezone?: string) => NotificationDiffValue;
};

const toDateLabel = (value: any, timezone = 'UTC'): NotificationDiffValue => {
  if (!value) return { raw: null, label: 'N/A' };
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return { raw: null, label: 'N/A' };
  return {
    raw: date.toISOString(),
    label: DateTime.fromJSDate(date)
      .setZone(timezone || 'UTC')
      .toFormat("dd LLL yyyy, hh:mm a 'UTC'ZZ")
  };
};

const normalizeString = (value: any, limit = 180): string => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
};

const normalizeScalar = (value: any): NotificationDiffValue => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return normalizeString(value);
  if (Array.isArray(value)) return normalizeString(value.join(', '), 180);
  if (value instanceof Date) return value.toISOString();
  return normalizeString(JSON.stringify(value));
};

const stable = (value: any): string => {
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value ?? null);
};

const buildDiff = (beforeDoc: any, afterDoc: any, fields: DiffConfig[], timezone = 'UTC') => {
  const out: NotificationDiffEntry[] = [];
  fields.forEach(field => {
    const beforeRaw = field.getBefore(beforeDoc);
    const afterRaw = field.getAfter(afterDoc);
    if (stable(beforeRaw) === stable(afterRaw)) return;
    out.push({
      field: field.field,
      label: field.label,
      before: field.serialize ? field.serialize(beforeRaw, timezone) : normalizeScalar(beforeRaw),
      after: field.serialize ? field.serialize(afterRaw, timezone) : normalizeScalar(afterRaw)
    });
  });
  return out;
};

// Main-field allowlist only (no noisy internals)
const COURSE_MAIN_FIELDS: DiffConfig[] = [
  { field: 'title', label: 'Title', getBefore: c => c?.title, getAfter: c => c?.title },
  {
    field: 'description',
    label: 'Description',
    getBefore: c => c?.description,
    getAfter: c => c?.description
  },
  { field: 'price', label: 'Price', getBefore: c => c?.price, getAfter: c => c?.price },
  { field: 'currency', label: 'Currency', getBefore: c => c?.currency, getAfter: c => c?.currency },
  {
    field: 'ageGroups',
    label: 'Age groups',
    getBefore: c => c?.ageGroups,
    getAfter: c => c?.ageGroups
  },
  {
    field: 'studentCapacity',
    label: 'Capacity',
    getBefore: c => c?.studentCapacity,
    getAfter: c => c?.studentCapacity
  },
  {
    field: 'startDate',
    label: 'Start date',
    getBefore: c => c?.startDate,
    getAfter: c => c?.startDate,
    serialize: (v, tz) => toDateLabel(v, tz)
  },
  {
    field: 'endDate',
    label: 'End date',
    getBefore: c => c?.endDate,
    getAfter: c => c?.endDate,
    serialize: (v, tz) => toDateLabel(v, tz)
  },
  { field: 'status', label: 'Status', getBefore: c => c?.status, getAfter: c => c?.status }
];

const LESSON_MAIN_FIELDS: DiffConfig[] = [
  { field: 'title', label: 'Title', getBefore: l => l?.title, getAfter: l => l?.title },
  {
    field: 'description',
    label: 'Description',
    getBefore: l => l?.description,
    getAfter: l => l?.description
  },
  { field: 'status', label: 'Status', getBefore: l => l?.status, getAfter: l => l?.status },
  {
    field: 'startAt',
    label: 'Start time',
    getBefore: l => l?.startAt,
    getAfter: l => l?.startAt,
    serialize: (v, tz) => toDateLabel(v, tz)
  },
  {
    field: 'endAt',
    label: 'End time',
    getBefore: l => l?.endAt,
    getAfter: l => l?.endAt,
    serialize: (v, tz) => toDateLabel(v, tz)
  },
  {
    field: 'teacherId',
    label: 'Assigned teacher',
    getBefore: l => l?.teacherId,
    getAfter: l => l?.teacherId
  }
];

export const buildCourseDiff = (beforeCourse: any, afterCourse: any, timezone = 'UTC') =>
  buildDiff(beforeCourse, afterCourse, COURSE_MAIN_FIELDS, timezone);

export const buildLessonDiff = (beforeLesson: any, afterLesson: any, timezone = 'UTC') =>
  buildDiff(beforeLesson, afterLesson, LESSON_MAIN_FIELDS, timezone);
