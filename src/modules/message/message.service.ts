import messageModel from '../../models/message.model';
import messageThreadModel from '../../models/messageThread.model';
import { User } from '../../models/user.model';

const messageService = {
  /**
   * Get all threads for a user with unread counts
   */
  getThreads: async (userId: string) => {
    const threads = await messageThreadModel
      .find({ participants: userId })
      .populate({
        path: 'createdBy',
        select: 'name role',
        populate: { path: 'profileImage', select: 'url' }
      })
      .populate({
        path: 'lastMessage',
        select: 'body sender createdAt',
        populate: {
          path: 'sender',
          select: 'name'
        }
      })
      .populate({
        path: 'participants',
        select: 'name role',
        populate: { path: 'profileImage', select: 'url' }
      })
      .sort({ updatedAt: -1 })
      .lean({ virtuals: true });

    // Map threads with user-specific unread count
    return threads.map(thread => ({
      ...thread,
      unreadCount: thread.unreadCount?.[userId] || 0
    }));
  },

  /**
   * List all teachers (for new message modal)
   */
  listTeachers: async (userRole: string) => {
    const role = userRole === 'student' ? 'teacher' : 'student';

    const teachers = await User.find({ role })
      .populate('profileImage', 'url')
      .select('name email')
      .limit(50)
      .sort({ name: 1 });

    return teachers;
  },

  /**
   * Create a new thread or return existing one
   */
  createThread: async (
    userId: string,
    threadType: string,
    groupName: string,
    participants: string[]
  ) => {
    // For direct messages, check if thread already exists
    if (threadType === 'DIRECT' && participants.length === 2) {
      const existingThread: any = await messageThreadModel
        .findOne({
          threadType: 'DIRECT',
          participants: { $all: participants, $size: 2 }
        })
        .populate({
          path: 'createdBy',
          select: 'name role',
          populate: { path: 'profileImage', select: 'url' }
        })
        .populate({
          path: 'lastMessage',
          select: 'body sender createdAt'
        })
        .populate({
          path: 'participants',
          select: 'name role',
          populate: { path: 'profileImage', select: 'url' }
        })
        .lean();

      if (existingThread) {
        return {
          ...existingThread,
          unreadCount: existingThread.unreadCount?.[userId] || 0
        };
      }
    }

    // Create unread count map for all participants
    const unreadMap: any = {};
    participants.forEach(id => (unreadMap[id] = 0));

    // Create new thread
    const thread = await messageThreadModel.create({
      participants,
      createdBy: userId,
      threadType,
      groupName: groupName || null,
      unreadCount: unreadMap
    });

    const newThread: any = await messageThreadModel
      .findOne({ _id: thread._id })
      .populate({
        path: 'createdBy',
        select: 'name role',
        populate: { path: 'profileImage', select: 'url' }
      })
      .populate('lastMessage', 'body sender createdAt')
      .populate({
        path: 'participants',
        select: 'name role',
        populate: { path: 'profileImage', select: 'url' }
      })
      .lean();

    return {
      ...newThread,
      unreadCount: newThread?.unreadCount?.[userId] || 0
    };
  },

  /**
   * Get messages for a specific thread (with pagination support)
   */
  getMessages: async (threadId: string, limit: number = 30, skip: number = 0) => {
    const messages = await messageModel
      .find({ thread: threadId })
      .sort({ sentAt: -1 })
      .limit(limit)
      .skip(skip)
      .populate({
        path: 'sender',
        select: 'name role',
        populate: { path: 'profileImage', select: 'url' }
      })
      .populate({
        path: 'readBy',
        select: 'name role',
        populate: { path: 'profileImage', select: 'url' }
      })
      .populate({
        path: 'attachments',
        select: 'url name mime'
      })
      .lean();

    return messages.reverse(); // Return in chronological order
  },

  /**
   * Get unread message count for a user across all threads
   */
  getTotalUnreadCount: async (userId: string) => {
    const threads = await messageThreadModel
      .find({ participants: userId })
      .select('unreadCount')
      .lean();

    return threads.reduce((total, thread) => {
      return total + (thread.unreadCount?.[userId] || 0);
    }, 0);
  }
};

export default messageService;
