export const SOCKET_EVENTS = {
  // Connection events
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect',
  ERROR: 'error',

  // User events
  USER: {
    CONNECT: 'userConnect',
    CONNECTED: 'userConnected',
    DISCONNECT: 'userDisconnect',
    ONLINE: 'userOnline',
    OFFLINE: 'userOffline'
  },

  // Chat events
  CHAT: {
    // Emit from client
    THREAD_OPEN: 'threadOpen',
    SEND_MESSAGE: 'sendMessage',
    MARK_AS_READ: 'markAsRead',
    TYPING: 'typing',
    CLOSE_THREAD: 'closeThread',

    // Emit from server
    THREAD_MESSAGES: 'thread-messages',
    NEW_MESSAGE: 'newMessage',
    NEW_MESSAGE_NOTIFICATION: 'newMessageNotification', // 🔔 NEW: For users not in room
    MESSAGES_READ: 'messagesRead',
    USER_TYPING: 'userTyping',

    // Status
    USER_ONLINE: 'userOnline',
    USER_OFFLINE: 'userOffline'
  }
};
