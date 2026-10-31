/**
 * Clears all user-specific store state on account switch.
 * Each store is reset to its empty initial values so the incoming
 * account starts with a clean slate.
 */

import { useMessageStore } from '@/stores/messageStore';
import { useDMStore } from '@/stores/dmStore';
import { useFriendStore } from '@/stores/friendStore';
import { useGroupChatStore } from '@/stores/groupChatStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { resetNotificationCache, useNotificationStore } from '@/stores/notificationStore';
import { usePushSettingsStore } from '@/stores/pushSettingsStore';
import { useServerStore, cancelPendingServerSync } from '@/stores/serverStore';
import { useChannelStore } from '@/stores/channelStore';
import { useBlockedUsersStore } from '@/stores/blockedUsersStore';
import { useDmPinStore } from '@/stores/dmPinStore';
import { invalidateAccountSession } from './accountSession';
import { usePersonalNotesStore } from '@/stores/personalNotesStore';
import { useTheaterStore } from '@/stores/theaterStore';
import { useTheaterChatPreviewStore } from '@/stores/theaterChatPreviewStore';
import { useCallStore } from '@/stores/callStore';
import { useVoiceStore } from '@/stores/voiceStore';

export function resetAllStores() {
  invalidateAccountSession();
  resetNotificationCache();
  cancelPendingServerSync();
  useTheaterStore.getState().leaveTheater();
  useTheaterChatPreviewStore.getState().clear();
  useVoiceStore.getState().leaveChannel();
  useCallStore.getState().endCall();
  usePersonalNotesStore.getState().reset();
  useMessageStore.getState().reset();
  useDmPinStore.getState().reset();

  useDMStore.setState({
    conversations: [],
    messages: {},
    loading: {},
    hasMore: {},
    oldestCursor: {},
    activeConversationId: null,
    typingByConversation: {},
  });

  useFriendStore.setState({
    friends: [],
    incoming: [],
    outgoing: [],
    nicknames: [],
    personalRoles: [],
    roleAssignments: {},
    loading: false,
    error: null,
  });

  useGroupChatStore.setState({
    groups: [],
    messagesByGroup: {},
    keysByGroup: {},
  });

  usePresenceStore.setState({
    byUserId: {},
    centralByUserId: {},
    onlineUsers: [],
    allMembers: [],
  });

  useNotificationStore.setState({
    items: [],
    summary: null,
    loaded: false,
  });
  usePushSettingsStore.getState().reset();

  useServerStore.setState({
    servers: [],
    serverLayout: [],
    serverFolders: [],
    rawSyncedServers: [],
    serverSyncStatus: 'idle',
    serverSyncMessage: null,
    activeServerId: null,
    channels: {},
    categories: {},
    roles: {},
    onlineUsers: {},
  });

  useChannelStore.setState({
    drafts: {},
    scrollOffsets: {},
    lastChannelByServer: {},
    activeChannelId: null,
    unreadByChannel: {},
    mentionByChannel: {},
  });

  useBlockedUsersStore.setState({ blockedUsers: new Set<string>() });
}
