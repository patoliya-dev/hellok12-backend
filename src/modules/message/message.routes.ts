import express from 'express';
import messageController from './message.controller';
import { authenticate } from '../../middlewares/auth';

const router = express.Router();

/**
 * @route   GET /messages/
 * @desc    Get all threads/conversations for current user
 * @access  Private
 */
router.get('/', authenticate, messageController.getThreads);

/**
 * @route   GET /messages/listTeachers
 * @desc    Get list of teachers for new message modal
 * @access  Private
 */
router.get('/listTeachers', authenticate, messageController.listTeachers);

/**
 * @route   GET /messages/unread-count
 * @desc    Get total unread message count for current user
 * @access  Private
 */
router.get('/unread-count', authenticate, messageController.getUnreadCount);

/**
 * @route   GET /messages/messages/:threadId
 * @desc    Get messages for a specific thread
 * @access  Private
 * @query   limit - Number of messages to fetch (default: 30)
 * @query   skip - Number of messages to skip for pagination (default: 0)
 */
router.get('/messages/:threadId', authenticate, messageController.getMessages);

/**
 * @route   POST /messages/thread
 * @desc    Create a new thread or get existing one
 * @access  Private
 * @body    threadType - 'DIRECT' or 'GROUP'
 * @body    participants - Array of user IDs
 * @body    groupName - Name of group (required if threadType is 'GROUP')
 */
router.post('/thread', authenticate, messageController.createThread);

export default router;
