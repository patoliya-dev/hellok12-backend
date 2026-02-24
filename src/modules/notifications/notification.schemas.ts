import { z } from 'zod';
import { NOTIFICATION_TYPES } from '../../models/notification.model';

const objectIdRegex = /^[a-f\d]{24}$/i;

const boolFromQuery = z.preprocess(v => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const normalized = v.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return v;
}, z.boolean().optional());

const intFromQuery = (fallback: number, min: number, max: number) =>
  z.preprocess(v => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim()) return Number(v);
    return fallback;
  }, z.number().int().min(min).max(max));

const dateFromQuery = z.preprocess(v => {
  if (typeof v === 'string' && v.trim()) return new Date(v);
  return undefined;
}, z.date().optional());

const objectIdFromQuery = z.preprocess(v => {
  if (typeof v === 'string' && v.trim()) return v.trim();
  return undefined;
}, z.string().regex(objectIdRegex, 'Invalid object id').optional());

const typeFromQuery = z.preprocess(v => {
  if (typeof v === 'string' && v.trim()) return v.trim();
  return undefined;
}, z.enum(NOTIFICATION_TYPES).optional());

export const listNotificationsSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z
    .object({
      page: intFromQuery(1, 1, 100000),
      limit: intFromQuery(20, 1, 100),
      unread: boolFromQuery,
      type: typeFromQuery,
      roleTargeted: boolFromQuery,
      startDate: dateFromQuery,
      endDate: dateFromQuery,
      recipientUserId: objectIdFromQuery
    })
    .refine(data => !(data.startDate && data.endDate) || data.startDate <= data.endDate, {
      message: 'startDate must be before endDate',
      path: ['startDate']
    })
});

export const notificationIdParamsSchema = z.object({
  body: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  params: z.object({
    id: z.string().regex(objectIdRegex, 'Invalid notification id')
  })
});

export const readAllNotificationsSchema = z.object({
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
  body: z
    .object({
      type: z.enum(NOTIFICATION_TYPES).optional()
    })
    .optional()
    .default({})
});

export type ListNotificationsInput = z.infer<typeof listNotificationsSchema>['query'];
