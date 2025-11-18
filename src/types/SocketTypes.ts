export interface threadOpenPayload {
  threadId: string;
  senderId: string;
}

export interface sendMessagePayload {
  thread: string;
  sender: string;
  body: string;
  sentAt: Date | string;
  type: 'text' | 'file' | 'image' | 'video' | 'audio';
  attachments?: string[];
}

export interface markAsReadPayload {
  threadId: string;
  userId: string;
}

export interface typingPayload {
  threadId: string;
  userId: string;
  userName: string;
  isTyping: boolean;
}

export interface closeThreadPayload {
  threadId: string;
  userId: string;
}

export interface userLoginPayload {
  userId: string;
}
