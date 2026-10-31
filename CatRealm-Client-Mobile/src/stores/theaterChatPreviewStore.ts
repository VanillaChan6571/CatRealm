import { AppState } from 'react-native';
import { create } from 'zustand';
import type { Message } from '@/types';
import { useAuthStore } from './authStore';
import { useBlockedUsersStore } from './blockedUsersStore';
import { useServerStore } from './serverStore';
import { useSettingsStore } from './settingsStore';
import { useTheaterStore } from './theaterStore';

export const THEATER_CHAT_PREVIEW_MS = 5000;

export interface TheaterChatPreview {
  id: string;
  userId: string;
  accountId: string;
  channelId: string;
  serverId: string;
  serverUrl: string;
  name: string;
  avatar: string | null;
  text: string;
  fallback: 'chatHiddenContent' | 'chatAttachment' | 'newChatMessage';
  receivedAt: number;
}

interface PreviewState {
  preview: TheaterChatPreview | null;
  receive: (serverUrl: string, message: Message) => void;
  invalidate: (serverUrl: string, channelId: string, messageId: string) => void;
  clear: () => void;
}

// One bounded, ephemeral preview — only text and an avatar URL, not image data/history.
// Only the live socket path calls receive; history fetches cannot replay bubbles.
export const useTheaterChatPreviewStore = create<PreviewState>((set, get) => ({
  preview: null,
  receive: (serverUrl, message) => {
    const theater = useTheaterStore.getState();
    const auth = useAuthStore.getState();
    if (!auth.user || !theater.serverId || !theater.channelId
      || !theater.focused || theater.overlayMode !== 'expanded'
      || !useSettingsStore.getState().theaterChatPreviews
      || AppState.currentState === 'background' || AppState.currentState === 'inactive') return;
    const theaterUrl = auth.user.accountType === 'central'
      ? useServerStore.getState().byId(theater.serverId)?.url : auth.serverUrl;
    if (!theaterUrl || serverUrl !== theaterUrl || message.channel_id !== theater.channelId
      || message.user_id === auth.user.id || message.user_id === theater.selfTheaterUserId
      || message.message_type === 'system' || message.thread_id || message.ephemeral
      || useBlockedUsersStore.getState().isBlocked(message.user_id)) return;
    const previous = get().preview;
    if (previous?.id === message.id && previous.serverUrl === serverUrl && previous.channelId === message.channel_id) return;
    const content = message.content ?? '';
    // Do not reveal spoilers, including unclosed spoiler markup, or NSFW content.
    const hidden = !!message.nsfw_tags?.length || content.includes('||');
    const text = hidden ? '' : content.slice(0, 240).replace(/\s+/g, ' ').trim();
    set({ preview: {
      id: message.id, userId: message.user_id, accountId: auth.user.id,
      channelId: theater.channelId, serverId: theater.serverId, serverUrl,
      name: (message.display_name || message.username || '').slice(0, 64),
      avatar: typeof message.avatar === 'string' && message.avatar.length <= 4096 ? message.avatar : null,
      text,
      fallback: hidden ? 'chatHiddenContent' : message.attachments?.length || message.attachment_url ? 'chatAttachment' : 'newChatMessage',
      receivedAt: Date.now(),
    } });
  },
  invalidate: (serverUrl, channelId, messageId) => {
    const preview = get().preview;
    if (preview?.serverUrl === serverUrl && preview.channelId === channelId && preview.id === messageId) set({ preview: null });
  },
  clear: () => set({ preview: null }),
}));
