import { Request, Response } from 'express';
import messageService from './message.service';
import Logger from '../../utils/winstonLogger.utils';

const messageController = {
  /**
   * Get all threads/conversations for current user
   * GET /messages/
   */
  getThreads: async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          message: 'Unauthorized - User ID not found'
        });
      }
      const threads = await messageService.getThreads(userId as string);

      return res.status(200).json({
        message: 'Messages retrieved successfully',
        data: threads || []
      });
    } catch (error: any) {
      Logger.error('Error in getThreads:', error);
      return res.status(500).json({
        message: 'Error retrieving messages',
        error: error.message
      });
    }
  },

  /**
   * List all teachers (for new message modal)
   * GET /messages/listTeachers
   */
  listTeachers: async (req: Request, res: Response) => {
    try {
      const userRole = req.user?.role;
      const userId = req.user?.id;

      if (!userRole) {
        return res.status(401).json({
          message: 'Unauthorized - User ID not found'
        });
      }

      const teachers = await messageService.listTeachers(userRole as string, userId as string);
      return res.status(200).json({
        message: 'Teachers retrieved successfully',
        data: teachers || []
      });
    } catch (error: any) {
      Logger.error('Error in listTeachers:', error);
      return res.status(500).json({
        message: 'Error retrieving teachers',
        error: error.message
      });
    }
  },

  /**
   * Create a new thread or return existing one
   * POST /messages/thread
   */
  createThread: async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const { threadType, groupName, participants } = req.body;

      if (!userId) {
        return res.status(401).json({
          message: 'Unauthorized - User ID not found'
        });
      }

      if (!threadType || !participants || !Array.isArray(participants)) {
        return res.status(400).json({
          message: 'Missing required fields: threadType and participants array'
        });
      }

      if (threadType === 'GROUP' && !groupName) {
        return res.status(400).json({
          message: 'Group name is required for group threads'
        });
      }

      const thread = await messageService.createThread(
        userId as string,
        threadType,
        groupName,
        participants
      );

      return res.status(201).json({
        message: 'Thread created successfully',
        data: thread
      });
    } catch (error: any) {
      Logger.error('Error in createThread:', error);
      return res.status(500).json({
        message: 'Error creating thread',
        error: error.message
      });
    }
  },

  /**
   * Get messages for a specific thread
   * GET /messages/messages/:threadId
   */
  getMessages: async (req: Request, res: Response) => {
    try {
      const { threadId } = req.params;
      const userId = req.user?.id;
      const limit = parseInt(req.query.limit as string) || 30;
      const skip = parseInt(req.query.skip as string) || 0;

      if (!threadId) {
        return res.status(400).json({
          message: 'Thread ID is required'
        });
      }

      if (!userId) {
        return res.status(401).json({
          message: 'Unauthorized - User ID not found'
        });
      }

      const messages = await messageService.getMessages(threadId, userId as string, limit, skip);

      return res.status(200).json({
        message: 'Messages retrieved successfully',
        data: messages || []
      });
    } catch (error: any) {
      Logger.error('Error in getMessages:', error);
      return res.status(500).json({
        message: 'Error retrieving messages',
        error: error.message
      });
    }
  },

  /**
   * Get total unread message count for current user
   * GET /messages/unread-count
   */
  getUnreadCount: async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          message: 'Unauthorized - User ID not found'
        });
      }

      const count = await messageService.getTotalUnreadCount(userId as string);

      return res.status(200).json({
        message: 'Unread count retrieved successfully',
        data: { count }
      });
    } catch (error: any) {
      Logger.error('Error in getUnreadCount:', error);
      return res.status(500).json({
        message: 'Error retrieving unread count',
        error: error.message
      });
    }
  },

  /**
   * Add participants to a group
   * POST /messages/thread/:threadId/participants
   */
  addParticipants: async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const { threadId } = req.params;
      const { participants } = req.body;

      if (!userId) {
        return res.status(401).json({
          message: 'Unauthorized - User ID not found'
        });
      }

      if (!threadId) {
        return res.status(400).json({
          message: 'Thread ID is required'
        });
      }

      if (!participants || !Array.isArray(participants) || participants.length === 0) {
        return res.status(400).json({
          message: 'Participants array is required'
        });
      }

      const updatedThread = await messageService.addParticipants(
        threadId,
        participants,
        userId as string
      );

      return res.status(200).json({
        message: 'Participants added successfully',
        data: updatedThread
      });
    } catch (error: any) {
      Logger.error('Error in addParticipants:', error);
      return res.status(500).json({
        message: error.message || 'Error adding participants',
        error: error.message
      });
    }
  },

  /**
   * Leave a group
   * DELETE /messages/thread/:threadId/leave
   */
  leaveGroup: async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const { threadId } = req.params;

      if (!userId) {
        return res.status(401).json({
          message: 'Unauthorized - User ID not found'
        });
      }

      if (!threadId) {
        return res.status(400).json({
          message: 'Thread ID is required'
        });
      }

      const result = await messageService.leaveGroup(threadId, userId as string);

      return res.status(200).json({
        message: 'Left group successfully',
        data: result
      });
    } catch (error: any) {
      Logger.error('Error in leaveGroup:', error);
      return res.status(500).json({
        message: error.message || 'Error leaving group',
        error: error.message
      });
    }
  }
};

export default messageController;
