import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth';
import { createErrorResponse, createSuccessResponse } from '../../utils/apiResponse';
import { notificationService } from './notification.service';

const unauthorized = (res: Response) =>
  res.status(401).json(createErrorResponse('Authentication required', 'Unauthorized', 401));

export const notificationController = {
  async list(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return unauthorized(res);

      const filters = (req as any).validatedQuery || req.query;
      const result = await notificationService.list(req.user, filters);

      return res.status(200).json(createSuccessResponse(result, 'Notifications fetched'));
    } catch (error: any) {
      return res
        .status(500)
        .json(createErrorResponse(error?.message || 'Failed to fetch notifications', 'Error', 500));
    }
  },

  async unreadCount(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return unauthorized(res);

      const count = await notificationService.unreadCount(req.user);
      return res
        .status(200)
        .json(createSuccessResponse({ unreadCount: count }, 'Unread count fetched'));
    } catch (error: any) {
      return res
        .status(500)
        .json(createErrorResponse(error?.message || 'Failed to fetch unread count', 'Error', 500));
    }
  },

  async markAsRead(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return unauthorized(res);

      const params = (req as any).validatedParams || req.params;
      const updated = await notificationService.markAsRead(req.user, params.id);

      if (!updated) {
        return res
          .status(404)
          .json(createErrorResponse('Notification not found', 'Not Found', 404));
      }

      return res.status(200).json(createSuccessResponse(updated, 'Notification marked as read'));
    } catch (error: any) {
      return res
        .status(500)
        .json(createErrorResponse(error?.message || 'Failed to mark as read', 'Error', 500));
    }
  },

  async markAllAsRead(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return unauthorized(res);

      const body = (req as any).validatedBody || req.body;
      const modifiedCount = await notificationService.markAllAsRead(req.user, body.type);

      return res
        .status(200)
        .json(createSuccessResponse({ modifiedCount }, 'Notifications marked as read'));
    } catch (error: any) {
      return res
        .status(500)
        .json(createErrorResponse(error?.message || 'Failed to mark all as read', 'Error', 500));
    }
  },

  async remove(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.user) return unauthorized(res);

      const params = (req as any).validatedParams || req.params;
      const removed = await notificationService.removeForUser(req.user, params.id);

      if (!removed) {
        return res
          .status(404)
          .json(createErrorResponse('Notification not found', 'Not Found', 404));
      }

      return res.status(200).json(createSuccessResponse({ removed: true }, 'Notification deleted'));
    } catch (error: any) {
      return res
        .status(500)
        .json(createErrorResponse(error?.message || 'Failed to delete notification', 'Error', 500));
    }
  }
};
