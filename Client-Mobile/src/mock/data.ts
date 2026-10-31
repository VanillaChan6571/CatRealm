/**
 * Mock data — keeps the dev UI populated until real socket/HTTP wiring lands.
 * Don't import this from production code paths; gate behind `__DEV__` or the
 * `useMockData` setting (TODO: add to settingsStore).
 *
 * Shapes here MUST match `src/types`. If TS complains, the type is the source
 * of truth — fix the mock, not the type.
 */

import type {
  MobileServer,
} from '@/stores/serverStore';
import type {
  Channel,
  Category,
  Message,
  OnlineUser,
  DMConversation,
  Friend,
} from '@/types';

const now = Date.now();

export const mockServers: MobileServer[] = [
  {
    id: 's1',
    name: 'Hearthside',
    url: 'https://hearthside.example.com',
    token: '',
    iconUrl: null,
    membersOnline: 312,
    unread: 4,
    mention: 1,
  },
  {
    id: 's2',
    name: 'Pixel Patrol',
    url: 'https://pixelpatrol.example.com',
    token: '',
    iconUrl: null,
    membersOnline: 88,
    unread: 0,
    mention: 0,
  },
  {
    id: 's3',
    name: 'Night Owls',
    url: 'https://nightowls.example.com',
    token: '',
    iconUrl: null,
    membersOnline: 1024,
    unread: 12,
    mention: 0,
  },
];

export const mockCategories: Record<string, Category[]> = {
  s1: [
    { id: 'c1', name: 'WELCOME', position: 0, created_at: now - 1e9 },
    { id: 'c2', name: 'COMMONS', position: 1, created_at: now - 1e9 },
    { id: 'c3', name: 'VOICE LOUNGES', position: 2, created_at: now - 1e9 },
  ],
};

export const mockChannels: Record<string, Channel[]> = {
  s1: [
    {
      id: 'ch1',
      name: 'rules',
      description: 'Read me first',
      type: 'announcement',
      position: 0,
      category_id: 'c1',
      created_at: now - 1e9,
    },
    {
      id: 'ch2',
      name: 'introductions',
      description: null,
      type: 'basic',
      position: 1,
      category_id: 'c1',
      created_at: now - 1e9,
    },
    {
      id: 'ch3',
      name: 'lounge',
      description: 'general hangout',
      type: 'basic',
      position: 0,
      category_id: 'c2',
      created_at: now - 1e9,
    },
    {
      id: 'ch4',
      name: 'memes',
      description: null,
      type: 'media',
      position: 1,
      category_id: 'c2',
      created_at: now - 1e9,
    },
    {
      id: 'ch5',
      name: 'movie-night',
      description: 'theater queue',
      type: 'theater',
      position: 0,
      category_id: 'c3',
      created_at: now - 1e9,
    },
    {
      id: 'ch6',
      name: 'fireside',
      description: null,
      type: 'voice',
      position: 1,
      category_id: 'c3',
      created_at: now - 1e9,
    },
  ],
};

export const mockMessages: Record<string, Message[]> = {
  ch3: [
    {
      id: 'm1',
      channel_id: 'ch3',
      user_id: 'u1',
      username: 'mochi',
      avatar: null,
      content: 'morning everyone ☕',
      edited: 0,
      created_at: now - 1000 * 60 * 32,
    },
    {
      id: 'm2',
      channel_id: 'ch3',
      user_id: 'u2',
      username: 'tabby',
      avatar: null,
      content: 'gm gm',
      edited: 0,
      created_at: now - 1000 * 60 * 30,
    },
    {
      id: 'm3',
      channel_id: 'ch3',
      user_id: 'u3',
      username: 'pepper',
      avatar: null,
      content: 'who is up for movie night tonight',
      edited: 0,
      created_at: now - 1000 * 60 * 5,
    },
  ],
};

export const mockOnlineUsers: Record<string, OnlineUser[]> = {
  s1: [
    { id: 'u1', username: 'mochi', role: 'member', status: 'online' },
    { id: 'u2', username: 'tabby', role: 'mod', status: 'online', isOwner: false, roleColor: '#E8945C' },
    { id: 'u3', username: 'pepper', role: 'member', status: 'away' },
    { id: 'u4', username: 'biscuit', role: 'member', status: 'sleeping' },
  ],
};

export const mockFriends: Friend[] = [
  { id: 'u1', username: 'mochi', status: 'online', created_at: now - 1e9 },
  { id: 'u2', username: 'tabby', status: 'online', created_at: now - 1e9 },
  { id: 'u3', username: 'pepper', status: 'away', created_at: now - 1e9 },
];

export const mockDMs: DMConversation[] = [
  {
    id: 'd1',
    otherUserId: 'u1',
    otherUsername: 'mochi',
    otherAvatar: null,
    otherStatus: 'online',
    lastMessageAt: now - 1000 * 60 * 10,
    unreadCount: 2,
  },
  {
    id: 'd2',
    otherUserId: 'u3',
    otherUsername: 'pepper',
    otherAvatar: null,
    otherStatus: 'away',
    lastMessageAt: now - 1000 * 60 * 60 * 2,
    unreadCount: 0,
  },
];
