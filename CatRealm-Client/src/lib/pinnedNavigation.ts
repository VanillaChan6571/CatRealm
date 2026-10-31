import type { PinnedItem } from '../stores/pinnedStore';
import type { Tab } from '../components/home/HomeNav';
import { useAuthStore } from '../stores/authStore';
import { useServerStore } from '../stores/serverStore';
import { useChannelStore } from '../stores/channelStore';
import { useDMStore } from '../stores/dmStore';
import { useGroupChatStore } from '../stores/groupChatStore';

// Jump to a pinned conversation using the same store APIs the rest of the UI uses.
// `onNavigateHomeTab` lets the caller (AppLayout) flip the home tab for DM/group
// targets, mirroring handleReturnToActiveCall in AppLayout.
export function navigateToPinned(item: PinnedItem, onNavigateHomeTab?: (tab: Tab) => void): void {
  const server = useServerStore.getState();
  const isCentral = useAuthStore.getState().user?.accountType === 'central';

  if (item.type === 'dm') {
    if (isCentral && server.activeServerUrl) server.goHome();
    onNavigateHomeTab?.('dms');
    void useDMStore.getState().openConversation(item.otherUserId, item.username, item.avatar);
    return;
  }

  if (item.type === 'group') {
    if (isCentral && server.activeServerUrl) server.goHome();
    onNavigateHomeTab?.('groupChats');
    useGroupChatStore.getState().selectGroup(item.groupId);
    return;
  }

  // Channel. Decentralized accounts have a single server — just select.
  if (!isCentral) {
    useChannelStore.getState().setActiveChannel(item.channelId);
    return;
  }

  // Central account: switch servers if needed, then select the channel.
  if (server.activeServerUrl !== item.serverUrl) {
    server.switchServer(item.serverUrl);
    // switchServer can refuse (realm-trust change / mixed-content block); bail if so.
    if (useServerStore.getState().activeServerUrl !== item.serverUrl) return;
  }

  const channels = useChannelStore.getState();
  if (channels.channels.some((c) => c.id === item.channelId)) {
    channels.setActiveChannel(item.channelId);
  } else {
    // Channels for this server aren't loaded yet — queue the selection and ensure
    // a fetch happens so applyChannelList can apply it on arrival.
    channels.setPendingActiveChannel(item.channelId);
    void channels.fetchChannels();
  }
}
