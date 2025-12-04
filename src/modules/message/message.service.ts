import bookingModel from '../../models/booking.model';
import { Course } from '../../models/course.model';
import messageModel from '../../models/message.model';
import messageThreadModel from '../../models/messageThread.model';
import { User } from '../../models/user.model';

const messageService = {
  /**
   * Get all threads for a user with unread counts
   */
  getThreads: async (userId: string) => {
    // Get active threads (user is current participant)
    const activeThreads = await messageThreadModel
      .find({ participants: userId })
      .populate({
        path: 'createdBy',
        select: 'name role',
        populate: { path: 'profileImage', select: 'url' }
      })
      .populate({
        path: 'lastMessage',
        select: 'body sender attachments createdAt',
        populate: {
          path: 'sender',
          select: 'name'
        }
      })
      .populate({
        path: 'participants',
        select: 'name role lastSeen availabilityStatus',
        populate: { path: 'profileImage', select: 'url' }
      })
      .sort({ updatedAt: -1 })
      .lean({ virtuals: true });

    // Get threads user has left (and hasn't been re-added to)
    const leftThreads = await messageThreadModel
      .find({
        'formerParticipants.userId': userId,
        participants: { $ne: userId }, //  Exclude if user is current participant
        threadType: 'GROUP'
      })
      .populate({
        path: 'createdBy',
        select: 'name role',
        populate: { path: 'profileImage', select: 'url' }
      })
      .populate({
        path: 'lastMessage',
        select: 'body sender attachments createdAt',
        populate: {
          path: 'sender',
          select: 'name'
        }
      })
      .populate({
        path: 'participants',
        select: 'name role lastSeen availabilityStatus',
        populate: { path: 'profileImage', select: 'url' }
      })
      .sort({ updatedAt: -1 })
      .lean({ virtuals: true });

    // Map active threads
    const mappedActiveThreads = activeThreads.map(thread => {
      // Check if user was previously a former participant
      const wasFormerParticipant = thread.formerParticipants?.some(
        (fp: any) => fp.userId.toString() === userId.toString()
      );

      return {
        ...thread,
        unreadCount: thread.unreadCount?.[userId] || 0,
        isActive: true,
        hasLeft: false,
        wasReAdded: wasFormerParticipant || false, //  Flag for UI
        previousLeftAt: wasFormerParticipant
          ? thread.formerParticipants.find((fp: any) => fp.userId.toString() === userId.toString())
              ?.leftAt
          : null
      };
    });

    // Map left threads
    const mappedLeftThreads = leftThreads.map(thread => {
      const formerParticipant = thread.formerParticipants?.find(
        (fp: any) => fp.userId.toString() === userId.toString()
      );

      return {
        ...thread,
        unreadCount: 0,
        isActive: false,
        hasLeft: true,
        leftAt: formerParticipant?.leftAt || null,
        wasReAdded: false
      };
    });

    const allThreads = [...mappedActiveThreads, ...mappedLeftThreads];
    return allThreads.sort(
      (a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  },

  /**
   * List all teachers (for new message modal)
   */
  listTeachers: async (userRole: string, userId: string) => {
    if (['student', 'parent'].includes(userRole)) {
      // For students/parents: Find teachers from their purchased courses

      // Step 1: Find all bookings for this user (or their children if parent)
      const bookingFilter: any = {};

      if (userRole === 'parent') {
        // Get parent's children by querying students with this parent ID
        const children = await User.find({
          parent: userId,
          role: 'student'
        }).select('_id');

        const childrenIds = children.map(child => child._id);
        bookingFilter.student = { $in: childrenIds };
      } else {
        bookingFilter.student = userId;
      }

      // Get all bookings with paid/not_required status
      const bookings = await bookingModel
        .find({
          ...bookingFilter,
          paymentStatus: { $in: ['PAID', 'NOT_REQUIRED'] }
        })
        .distinct('course');

      if (bookings.length === 0) {
        return [];
      }

      // Step 2: Find all teachers from these courses
      const courses = await Course.find({
        _id: { $in: bookings }
      }).distinct('teachers');

      // Step 3: Get teacher details
      const teachers = await User.find({
        _id: { $in: courses },
        role: 'teacher'
      })
        .populate('profileImage', 'url')
        .select('name email')
        .limit(50)
        .sort({ name: 1 });

      return teachers;
    } else if (userRole === 'teacher') {
      // For teachers: Find students from courses they're teaching

      // Step 1: Find all courses where this teacher is assigned
      const courses = await Course.find({
        teachers: userId
      }).distinct('_id');

      if (courses.length === 0) {
        return [];
      }

      // Step 2: Find all students who have booked these courses
      const studentIds = await bookingModel
        .find({
          course: { $in: courses },
          paymentStatus: { $in: ['PAID', 'NOT_REQUIRED'] }
        })
        .distinct('student');

      // Step 3: Get the students and find their parents
      const students = await User.find({
        _id: { $in: studentIds }
      }).select('_id parent role');

      // Separate students with parents and students without parents
      const parentIds = students.filter(student => student.parent).map(student => student.parent);

      const independentStudentIds = students
        .filter(student => !student.parent && student.role === 'student')
        .map(student => student._id);

      // Step 4: Get parent and independent student details
      const users = await User.find({
        $or: [
          { _id: { $in: parentIds }, role: 'parent' },
          { _id: { $in: independentStudentIds }, role: 'student' }
        ]
      })
        .populate('profileImage', 'url')
        .select('name email role')
        .limit(50)
        .sort({ name: 1 });

      return users;
    } else {
      // For other roles (school, etc.), return empty or implement custom logic
      return [];
    }
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
          select: 'name role lastSeen availabilityStatus',
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
        select: 'name role lastSeen availabilityStatus',
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
  getMessages: async (threadId: string, userId: string, limit: number = 30, skip: number = 0) => {
    const thread: any = await messageThreadModel
      .findById(threadId)
      .select('participants formerParticipants')
      .lean();

    if (!thread) {
      throw new Error('Thread not found');
    }

    const isCurrentParticipant = thread.participants.some(
      (p: any) => p.toString() === userId.toString()
    );

    const query: any = { thread: threadId };

    //  If user is current participant, show ALL messages (including when they were away)
    if (!isCurrentParticipant) {
      // User has left - only show messages before they left
      const formerParticipant = thread.formerParticipants?.find(
        (fp: any) => fp.userId.toString() === userId.toString()
      );

      if (formerParticipant) {
        query.sentAt = { $lte: formerParticipant.leftAt };
      } else {
        throw new Error('You do not have access to this conversation');
      }
    }

    const messages = await messageModel
      .find(query)
      .sort({ sentAt: -1 })
      .limit(limit)
      .skip(skip)
      .populate({
        path: 'sender',
        select: 'name role lastSeen availabilityStatus',
        populate: { path: 'profileImage', select: 'url' }
      })
      .populate({
        path: 'readBy',
        select: 'name role lastSeen availabilityStatus',
        populate: { path: 'profileImage', select: 'url' }
      })
      .populate({
        path: 'attachments',
        select: 'url name mime'
      })
      .lean();

    return messages.reverse();
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
  },

  /**
   * Add participants to a group thread
   */
  addParticipants: async (threadId: string, newParticipants: string[], requesterId: string) => {
    const thread: any = await messageThreadModel.findById(threadId).lean();

    if (!thread) {
      throw new Error('Thread not found');
    }

    if (thread.threadType !== 'GROUP') {
      throw new Error('Cannot add participants to a direct message thread');
    }

    const isParticipant = thread.participants.some(
      (p: any) => p.toString() === requesterId.toString()
    );

    if (!isParticipant) {
      throw new Error('Only group members can add participants');
    }

    // Filter out participants who are already in the group
    const existingParticipantIds = thread.participants.map((p: any) => p.toString());
    const participantsToAdd = newParticipants.filter(
      id => !existingParticipantIds.includes(id.toString())
    );

    if (participantsToAdd.length === 0) {
      throw new Error('All specified users are already participants');
    }

    // Verify that all new participants exist
    const users = await User.find({ _id: { $in: participantsToAdd } }).select('_id');
    if (users.length !== participantsToAdd.length) {
      throw new Error('One or more users not found');
    }

    //  Separate re-additions from truly new participants
    const formerParticipantIds =
      thread.formerParticipants?.map((fp: any) => fp.userId.toString()) || [];
    const reAddedUsers: string[] = [];
    const newUsers: string[] = [];

    participantsToAdd.forEach(id => {
      if (formerParticipantIds.includes(id.toString())) {
        reAddedUsers.push(id);
      } else {
        newUsers.push(id);
      }
    });

    // Build update object
    const updateObj: any = {
      $addToSet: { participants: { $each: participantsToAdd } }
    };

    // Initialize unread count for all added participants
    participantsToAdd.forEach(participantId => {
      updateObj[`unreadCount.${participantId}`] = 0;
    });

    //  Remove re-added users from formerParticipants
    if (reAddedUsers.length > 0) {
      updateObj.$pull = {
        formerParticipants: { userId: { $in: reAddedUsers } }
      };
    }

    // Update the thread
    await messageThreadModel.findByIdAndUpdate(threadId, updateObj);

    // Get requester and user names for system message
    const requester = await User.findById(requesterId).select('name');
    const addedUserDocs = await User.find({ _id: { $in: participantsToAdd } }).select('name');
    const addedUserNames = addedUserDocs.map(u => u.name);

    //  Create different system messages for re-additions vs new additions
    let systemMessageBody = '';

    if (reAddedUsers.length > 0 && newUsers.length === 0) {
      // All are re-additions
      const reAddedNames = addedUserDocs
        .filter(u => reAddedUsers.includes(u._id.toString()))
        .map(u => u.name)
        .join(', ');
      systemMessageBody = `${requester?.name} added ${reAddedNames} back to the group`;
    } else if (reAddedUsers.length > 0 && newUsers.length > 0) {
      // Mixed: some re-additions, some new
      const reAddedNames = addedUserDocs
        .filter(u => reAddedUsers.includes(u._id.toString()))
        .map(u => u.name)
        .join(', ');
      const newNames = addedUserDocs
        .filter(u => newUsers.includes(u._id.toString()))
        .map(u => u.name)
        .join(', ');
      systemMessageBody = `${requester?.name} added ${reAddedNames} back and ${newNames} to the group`;
    } else {
      // All are new participants
      systemMessageBody = `${requester?.name} added ${addedUserNames.join(', ')} to the group`;
    }

    // Create system message
    const systemMessage = await messageModel.create({
      thread: threadId,
      sender: requesterId,
      body: systemMessageBody,
      type: 'text',
      status: 'sent',
      sentAt: new Date(),
      readBy: [requesterId]
    });

    // Update thread's lastMessage
    await messageThreadModel.findByIdAndUpdate(threadId, {
      lastMessage: systemMessage._id,
      updatedAt: new Date()
    });

    // Fetch and return updated thread
    const updatedThread: any = await messageThreadModel
      .findById(threadId)
      .populate({
        path: 'createdBy',
        select: 'name role',
        populate: { path: 'profileImage', select: 'url' }
      })
      .populate({
        path: 'lastMessage',
        select: 'body sender createdAt',
        populate: { path: 'sender', select: 'name' }
      })
      .populate({
        path: 'participants',
        select: 'name role lastSeen availabilityStatus',
        populate: { path: 'profileImage', select: 'url' }
      })
      .lean();

    return {
      ...updatedThread,
      unreadCount: updatedThread.unreadCount?.[requesterId] || 0,
      addedParticipants: participantsToAdd,
      reAddedParticipants: reAddedUsers,
      newParticipants: newUsers
    };
  },

  /**
   * Leave a group thread
   */
  leaveGroup: async (threadId: string, userId: string) => {
    const thread: any = await messageThreadModel.findById(threadId).lean();

    if (!thread) {
      throw new Error('Thread not found');
    }

    if (thread.threadType !== 'GROUP') {
      throw new Error('Cannot leave a direct message thread');
    }

    const isParticipant = thread.participants.some((p: any) => p.toString() === userId.toString());

    if (!isParticipant) {
      throw new Error('You are not a member of this group');
    }

    const user = await User.findById(userId).select('name');
    const leftAt = new Date();

    // Create a system message before leaving
    const systemMessage = await messageModel.create({
      thread: threadId,
      sender: userId,
      body: `${user?.name} left the group`,
      type: 'text',
      status: 'sent',
      sentAt: leftAt,
      readBy: [userId]
    });

    // Update thread: remove from participants, add to formerParticipants
    const updateObj: any = {
      $pull: { participants: userId },
      $push: {
        formerParticipants: {
          userId: userId,
          leftAt: leftAt
        }
      },
      lastMessage: systemMessage._id,
      updatedAt: leftAt
    };

    // Remove user's unread count
    updateObj.$unset = { [`unreadCount.${userId}`]: '' };

    await messageThreadModel.findByIdAndUpdate(threadId, updateObj);

    return {
      success: true,
      message: 'Left group successfully',
      threadId,
      userId,
      leftAt
    };
  }
};

export default messageService;
