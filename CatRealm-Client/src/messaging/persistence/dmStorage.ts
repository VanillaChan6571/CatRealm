/**
 * IndexedDB Storage for Direct Messages
 * Provides persistent local storage for DM history
 */

import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';

interface DMMessage {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  text: string; // Decrypted plaintext
  messageType?: 'user' | 'system';
  systemType?: string | null;
  systemData?: Record<string, unknown> | null;
  attachmentUrl?: string | null;
  attachmentType?: string | null;
  attachmentSize?: number | null;
  attachmentName?: string | null;
  nsfwTags?: string[];
  reactions?: Array<{
    emoji: string;
    count: number;
    users: string[];
    reacted: boolean;
  }>;
  createdAt: number;
  delivered: boolean;
  read: boolean;
}

interface DMConversation {
  id: string;
  otherUserId: string;
  otherUsername: string;
  otherAvatar: string | null;
  lastMessageAt: number;
  unreadCount: number;
}

interface DMDatabase extends DBSchema {
  messages: {
    key: string;
    value: DMMessage;
    indexes: {
      'by-conversation': string;
      'by-created': number;
    };
  };
  conversations: {
    key: string;
    value: DMConversation;
    indexes: {
      'by-last-message': number;
    };
  };
}

let dbInstance: IDBPDatabase<DMDatabase> | null = null;

/**
 * Initialize IndexedDB for DMs
 * Creates database: catrealm-dms-{userId}
 */
export async function initDMStorage(userId: string): Promise<void> {
  const dbName = `catrealm-dms-${userId}`;

  dbInstance = await openDB<DMDatabase>(dbName, 2, {
    upgrade(db, oldVersion) {
      // If upgrading from old version, delete old stores
      if (oldVersion < 2) {
        if (db.objectStoreNames.contains('messages')) {
          db.deleteObjectStore('messages');
        }
        if (db.objectStoreNames.contains('conversations')) {
          db.deleteObjectStore('conversations');
        }
      }

      // Messages store
      if (!db.objectStoreNames.contains('messages')) {
        const messageStore = db.createObjectStore('messages', { keyPath: 'id' });
        messageStore.createIndex('by-conversation', 'conversationId');
        messageStore.createIndex('by-created', 'createdAt');
      }

      // Conversations store
      if (!db.objectStoreNames.contains('conversations')) {
        const conversationStore = db.createObjectStore('conversations', { keyPath: 'id' });
        conversationStore.createIndex('by-last-message', 'lastMessageAt');
      }
    },
  });
}

/**
 * Get database instance (throws if not initialized)
 */
function getDB(): IDBPDatabase<DMDatabase> {
  if (!dbInstance) {
    throw new Error('DM storage not initialized. Call initDMStorage() first.');
  }
  return dbInstance;
}

/**
 * Save a message to local storage
 */
export async function saveMessage(message: DMMessage): Promise<void> {
  const db = getDB();
  await db.put('messages', message);
}

/**
 * Get messages for a conversation (paginated)
 */
export async function getMessagesByConversation(
  conversationId: string,
  limit: number = 50,
  before?: number
): Promise<DMMessage[]> {
  const db = getDB();
  const tx = db.transaction('messages', 'readonly');
  const index = tx.store.index('by-conversation');

  // Collect all messages for this conversation (the index only keys on conversationId,
  // not createdAt, so cursor direction does not give chronological order).
  const all: DMMessage[] = await index.getAll(IDBKeyRange.only(conversationId));

  // Sort ascending by createdAt so oldest-first order is always correct.
  all.sort((a, b) => a.createdAt - b.createdAt);

  // Apply the "before" cursor for pagination, then take the last `limit` entries.
  const filtered = before !== undefined ? all.filter((m) => m.createdAt < before) : all;
  return filtered.slice(-limit);
}

/**
 * Save a conversation to local storage
 */
export async function saveConversation(conversation: DMConversation): Promise<void> {
  const db = getDB();
  await db.put('conversations', conversation);
}

/**
 * Get all conversations sorted by last message time
 */
export async function getAllConversations(): Promise<DMConversation[]> {
  const db = getDB();
  const tx = db.transaction('conversations', 'readonly');
  const index = tx.store.index('by-last-message');

  const conversations: DMConversation[] = [];
  let cursor = await index.openCursor(null, 'prev');

  while (cursor) {
    conversations.push(cursor.value);
    cursor = await cursor.continue();
  }

  return conversations;
}

/**
 * Mark a message as read
 */
export async function markMessageAsRead(messageId: string): Promise<void> {
  const db = getDB();
  const message = await db.get('messages', messageId);

  if (message) {
    message.read = true;
    await db.put('messages', message);
  }
}

/**
 * Delete a message from local storage
 */
export async function deleteMessage(messageId: string): Promise<void> {
  const db = getDB();
  await db.delete('messages', messageId);
}

/**
 * Get unread count for a conversation
 */
export async function getUnreadCount(conversationId: string): Promise<number> {
  const db = getDB();
  const tx = db.transaction('messages', 'readonly');
  const index = tx.store.index('by-conversation');

  let count = 0;
  let cursor = await index.openCursor(IDBKeyRange.only(conversationId));

  while (cursor) {
    if (!cursor.value.read) {
      count++;
    }
    cursor = await cursor.continue();
  }

  return count;
}

/**
 * Mark all messages in a conversation as read
 */
export async function markConversationAsRead(conversationId: string): Promise<void> {
  const db = getDB();
  const tx = db.transaction('messages', 'readwrite');
  const index = tx.store.index('by-conversation');

  let cursor = await index.openCursor(IDBKeyRange.only(conversationId));

  while (cursor) {
    const message = cursor.value;
    if (!message.read) {
      message.read = true;
      await cursor.update(message);
    }
    cursor = await cursor.continue();
  }

  await tx.done;
}

/**
 * Clear all DM IndexedDB databases (useful for logout)
 */
export async function clearAllDMStorage(): Promise<void> {
  try {
    // Close current connection
    if (dbInstance) {
      dbInstance.close();
      dbInstance = null;
    }

    // Delete all DM databases
    const databases = await indexedDB.databases();
    for (const db of databases) {
      if (db.name?.startsWith('catrealm-dms-')) {
        indexedDB.deleteDatabase(db.name);
      }
    }
  } catch (err) {
    console.error('[DM Storage] Failed to clear all DM storage:', err);
  }
}
