import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFriendStore } from '../../stores/friendStore';
import { useDMStore } from '../../stores/dmStore';
import { useGroupChatStore } from '../../stores/groupChatStore';
import { useCallStore } from '../../stores/callStore';
import { useAuthStore } from '../../stores/authStore';
import { useNotificationStore } from '../../messaging/notifications/notificationStore';
import { AvatarImage } from '../ui/AvatarImage';
import { AUTH_BASE } from '../../lib/authApi';
import { defaultAvatarUrl, resolveAvatarUrl } from '../../utils/avatar';
import { formatPresenceStatusLabel } from '../../lib/expressions';
import { groupChatFallbackBackground } from '../../utils/groupChatAvatar';
import { HOME_PRESENCE_REFRESH_MS, OPEN_GROUP_CHAT_CREATOR_EVENT } from './constants';
import {
  ArrowsPointingOutIcon,
  BellIcon,
  DocumentTextIcon,
  PlusIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/outline';
import { AudioDeafenedIcon, MicrophoneMutedIcon } from '../voice/VoiceStateIcons';
import { Crown, Pin, Users } from 'lucide-react';
import { usePinnedStore, pinKey, type PinnedItem } from '../../stores/pinnedStore';

export type Tab = 'notifications' | 'dms' | 'groupChats' | 'friends' | 'pending' | 'add' | 'discover' | 'notes' | 'messageRequests';

function getStatusDotClass(status?: 'online' | 'away' | 'sleeping' | 'invisible') {
  if (!status || status === 'invisible') return 'bg-text-muted';
  if (status === 'away') return 'bg-yellow-500';
  if (status === 'sleeping') return 'bg-indigo-400';
  return 'bg-green-500';
}

interface HomeNavProps {
  tab: Tab;
  setTab: (tab: Tab) => void;
}

export function HomeNav({ tab, setTab }: HomeNavProps) {
  const { t, i18n } = useTranslation();
  const userId = useAuthStore((s) => s.user?.id);
  const friends = useFriendStore((s) => s.friends);
  const incoming = useFriendStore((s) => s.incoming);
  const conversations = useDMStore((s) => s.conversations);
  const activeConversationId = useDMStore((s) => s.activeConversationId);
  const loadConversations = useDMStore((s) => s.loadConversations);
  const openConversation = useDMStore((s) => s.openConversation);
  const groupChats = useGroupChatStore((s) => s.groups);
  const activeGroupChatId = useGroupChatStore((s) => s.activeGroupId);
  const loadGroupChats = useGroupChatStore((s) => s.loadGroups);
  const selectGroupChat = useGroupChatStore((s) => s.selectGroup);
  const incomingGroupCalls = useCallStore((s) => s.incomingGroupCalls);
  const joinGroupCall = useCallStore((s) => s.joinGroupCall);
  const activeDMCall = useCallStore((s) => s.activeDMCall);
  const activeGroupCall = useCallStore((s) => s.activeGroupCall);
  const notificationSummary = useNotificationStore((s) => s.summary);
  const pinnedItems = usePinnedStore((s) => s.pinnedItems);
  const requestTogglePin = usePinnedStore((s) => s.requestTogglePin);
  const [pinMenu, setPinMenu] = useState<{ item: PinnedItem; x: number; y: number } | null>(null);
  const isItemPinned = (item: PinnedItem) => pinnedItems.some((p) => pinKey(p) === pinKey(item));

  useEffect(() => {
    if (!userId) return;

    const refreshConversations = () => {
      void loadConversations();
    };

    refreshConversations();
    const intervalId = window.setInterval(refreshConversations, HOME_PRESENCE_REFRESH_MS);
    const onFocus = () => refreshConversations();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshConversations();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [userId, loadConversations]);

  useEffect(() => {
    void loadGroupChats();
  }, [loadGroupChats]);

  // Count total unread DMs
  const totalUnread = conversations.filter(c => !c.requestState || c.requestState === 'accepted').reduce((sum, conv) => sum + conv.unreadCount, 0);
  const sortedConversations = useMemo(
    () => conversations.filter(c => !c.requestState || c.requestState === 'accepted').sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0)),
    [conversations]
  );
  const sortedGroupChats = useMemo(
    () => [...groupChats].sort((a, b) => (b.lastMessageAt || b.updatedAt || 0) - (a.lastMessageAt || a.updatedAt || 0)),
    [groupChats]
  );
  const groupById = useMemo(
    () => new Map(groupChats.map((group) => [group.id, group])),
    [groupChats]
  );
  const ongoingGroupCalls = useMemo(
    () => Object.values(incomingGroupCalls).sort((a, b) => b.receivedAt - a.receivedAt),
    [incomingGroupCalls]
  );
  const friendStatusById = useMemo(() => {
    const map = new Map<string, 'online' | 'away' | 'sleeping' | 'invisible'>();
    for (const friend of friends) {
      if (friend.status) map.set(friend.id, friend.status);
    }
    return map;
  }, [friends]);
  const totalGroupUnread = groupChats.reduce((sum, gc) => sum + (gc.unreadCount || 0), 0);

  const formatLastMessageTime = (timestamp?: number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="w-full md:w-64 bg-bg-sidebar flex flex-col border-r border-border shrink-0">
      <div className="px-4 h-12 flex items-center border-b border-border">
        <h2 className="text-sm font-semibold text-text-primary truncate">{t('nav.home')}</h2>
      </div>
      <div className="flex-1 min-h-0 flex flex-col p-2">
        <div className="space-y-0.5" data-tour="home-nav">
        <button
          onClick={() => setTab('notifications')}
          className={`w-full text-left px-3 py-2 rounded text-sm font-medium transition-colors flex items-center gap-2 ${
            tab === 'notifications' ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:bg-bg-hover/50 hover:text-text-primary'
          }`}
        >
          <BellIcon className="w-4 h-4 shrink-0" />
          <span>{t('nav.notifications')}</span>
          {(notificationSummary?.totalUnread ?? 0) > 0 && (
            <span className="bg-danger text-white text-xs rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center font-semibold">
              {notificationSummary!.totalUnread}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('friends')}
          className={`w-full text-left px-3 py-2 rounded text-sm font-medium transition-colors ${
            tab === 'friends' ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:bg-bg-hover/50 hover:text-text-primary'
          }`}
        >
          {t('nav.friendsList')}{friends.length > 0 ? ` (${friends.length})` : ''}
        </button>
        <button onClick={() => setTab('messageRequests')} className={`w-full text-left px-3 py-2 rounded text-sm ${tab === 'messageRequests' ? 'bg-bg-hover text-text-primary' : 'text-text-secondary'}`}>
          Message requests ({conversations.filter(c => c.requestState === 'pending').length})
        </button>
        <button
          onClick={() => setTab('pending')}
          className={`w-full text-left px-3 py-2 rounded text-sm font-medium transition-colors flex items-center gap-2 ${
            tab === 'pending' ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:bg-bg-hover/50 hover:text-text-primary'
          }`}
        >
          {t('nav.pending')}
          {incoming.length > 0 && (
            <span className="bg-danger text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-semibold">
              {incoming.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('add')}
          className={`w-full text-left px-3 py-2 rounded text-sm font-medium transition-colors ${
            tab === 'add' ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:bg-bg-hover/50 hover:text-text-primary'
          }`}
        >
          {t('nav.addFriend')}
        </button>
        <button
          data-tour="discover"
          onClick={() => setTab('discover')}
          className={`discover-nav-button w-full text-left px-3 py-2 rounded text-sm font-medium transition-colors ${
            tab === 'discover' ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:bg-bg-hover/50 hover:text-text-primary'
          }`}
        >
          {t('nav.discoverServers')}
        </button>
        <button
          onClick={() => setTab('notes')}
          className={`w-full text-left px-3 py-2 rounded text-sm font-medium transition-colors flex items-center gap-2 ${
            tab === 'notes' ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:bg-bg-hover/50 hover:text-text-primary'
          }`}
        >
          <DocumentTextIcon className="w-4 h-4 shrink-0" />
          {t('nav.myNotes')}
        </button>
        </div>

        <div className="mt-4 pt-3 border-t border-border/70 min-h-0 flex flex-col" data-tour="chats">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-bg-input/70 border border-border/70">
            <button
              type="button"
              onClick={() => setTab('dms')}
              className={`px-2 py-1.5 rounded text-left flex items-center justify-between text-xs font-semibold transition-colors ${
                tab === 'dms' ? 'text-text-primary bg-bg-hover/60' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover/30'
              }`}
            >
              <span className="truncate">{t('nav.directChats')}</span>
              {totalUnread > 0 && (
                <span className="bg-danger text-white text-[10px] rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center font-semibold shrink-0">
                  {totalUnread}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setTab('groupChats')}
              className={`px-2 py-1.5 rounded text-left text-xs font-semibold transition-colors ${
                tab === 'groupChats' ? 'text-text-primary bg-bg-hover/60' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover/30'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate">{t('nav.groupChats')}</span>
                {totalGroupUnread > 0 && (
                  <span className="bg-danger text-white text-[10px] rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center font-semibold shrink-0">
                    {totalGroupUnread}
                  </span>
                )}
              </span>
            </button>
          </div>

          <div className="mt-2 min-h-0 overflow-y-auto space-y-0.5">
            {tab === 'groupChats' ? (
              <>
                {/* Create button pinned at the top of the list (it replaced the
                    Group Chats view's top row). */}
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new Event(OPEN_GROUP_CHAT_CREATOR_EVENT))}
                  className="group-chat-create-button mb-2 w-full rounded-lg px-3 py-2 flex items-center gap-2 text-sm font-semibold text-white"
                >
                  <PlusIcon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{t('nav.newGroupChat')}</span>
                </button>
                {ongoingGroupCalls.length > 0 && (
                  <div className="mb-2 rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-2">
                    <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                      {t('nav.ongoingVoiceCalls')}
                    </div>
                    <div className="space-y-1">
                      {ongoingGroupCalls.map((call) => {
                        const group = groupById.get(call.groupChatId);
                        const groupName = group?.name || 'Group Chat';
                        const groupAvatarUrl = resolveAvatarUrl(group?.avatar ?? undefined, AUTH_BASE, 'central');
                        const groupAvatarBg = groupChatFallbackBackground(call.groupChatId || groupName || 'group-chat');
                        const inThisCall = activeGroupCall?.status === 'active' && activeGroupCall.callId === call.callId;
                        const blockedByAnotherCall = !!(
                          activeDMCall?.status === 'active'
                          || (activeGroupCall?.status === 'active' && activeGroupCall.callId !== call.callId)
                        );

                        return (
                          <button
                            key={call.callId}
                            type="button"
                            onClick={() => {
                              setTab('groupChats');
                              selectGroupChat(call.groupChatId);
                              if (!inThisCall) {
                                void joinGroupCall({
                                  callId: call.callId,
                                  groupChatId: call.groupChatId,
                                  groupName,
                                  groupAvatar: group?.avatar ?? null,
                                  mediaType: call.mediaType,
                                });
                              }
                            }}
                            className={`w-full px-2 py-1.5 rounded text-left transition-colors ${
                              inThisCall
                                ? 'bg-emerald-900/30 text-emerald-100 border border-emerald-700/60'
                                : 'text-emerald-100 hover:bg-emerald-900/25 border border-transparent'
                            } ${blockedByAnotherCall && !inThisCall ? 'opacity-70' : ''}`}
                            title={inThisCall ? `In call: ${groupName}` : `Join call: ${groupName}`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <AvatarImage
                                src={groupAvatarUrl}
                                alt={groupName}
                                size={24}
                                className="w-6 h-6 rounded-full object-cover shrink-0"
                                fallback={(
                                  <span
                                    className="w-full h-full rounded-full overflow-hidden flex items-center justify-center text-[18px] leading-none"
                                    style={{ backgroundColor: groupAvatarBg }}
                                  >
                                    <Users className="h-4 w-4" />
                                  </span>
                                )}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-semibold">{groupName}</div>
                                <div className="truncate text-[10px] text-emerald-300/90">
                                  {call.initiatorName} • {call.mediaType} call
                                </div>
                              </div>
                              {inThisCall ? (
                                <span className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 bg-emerald-900/30 border border-emerald-700/60">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                                  In Call
                                </span>
                              ) : (
                                <span className="shrink-0 text-[10px] font-semibold text-emerald-300">
                                  Join
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {sortedGroupChats.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-text-muted">
                    No group chats yet.
                  </div>
                ) : (
                  sortedGroupChats.map((group) => {
                    const isActive = activeGroupChatId === group.id;
                    const groupAvatarUrl = resolveAvatarUrl(group.avatar ?? undefined, AUTH_BASE, 'central');
                    const groupAvatarBg = groupChatFallbackBackground(group.id || group.name || 'group-chat');
                    const groupPin: PinnedItem = { type: 'group', groupId: group.id, name: group.name, avatar: group.avatar ?? null };
                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => {
                          setTab('groupChats');
                          selectGroupChat(group.id);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setPinMenu({ item: groupPin, x: e.clientX, y: e.clientY });
                        }}
                        className={`group w-full px-2 py-2 rounded text-left transition-colors ${
                          isActive
                            ? 'bg-bg-hover text-text-primary'
                            : 'text-text-secondary hover:bg-bg-hover/50 hover:text-text-primary'
                        }`}
                        title={group.name}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <AvatarImage
                            src={groupAvatarUrl}
                            alt={group.name}
                            size={28}
                            className="w-7 h-7 rounded-full object-cover shrink-0"
                            fallback={(
                              <span
                                className="w-full h-full rounded-full overflow-hidden flex items-center justify-center text-[24px] leading-none"
                                style={{ backgroundColor: groupAvatarBg }}
                              >
                                <Users className="h-4 w-4" />
                              </span>
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">
                              {group.isOwner && <Crown className="mr-1 inline h-3.5 w-3.5" />}
                              {group.name}
                            </div>
                            <div className="truncate text-[11px] text-text-muted">
                              {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
                            </div>
                          </div>
                          {activeGroupCall?.status === 'active' && activeGroupCall.groupChatId === group.id && (
                            <span className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 bg-emerald-900/30 border border-emerald-700/60">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                              Call
                            </span>
                          )}
                          {group.unreadCount > 0 && (
                            <span className="shrink-0 bg-accent text-white text-[10px] rounded-full min-w-4 h-4 px-1 flex items-center justify-center font-semibold">
                              {group.unreadCount}
                            </span>
                          )}
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); requestTogglePin(groupPin, e.shiftKey); }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); requestTogglePin(groupPin, e.shiftKey); } }}
                            className={`shrink-0 transition-opacity hover:text-text-primary ${
                              isItemPinned(groupPin) ? 'text-accent opacity-100' : 'text-text-muted opacity-0 group-hover:opacity-100'
                            }`}
                            title={isItemPinned(groupPin) ? 'Unpin from taskbar (Shift to skip confirmation)' : 'Pin to taskbar (Shift to skip confirmation)'}
                          >
                            <Pin className="h-3.5 w-3.5" />
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </>
            ) : sortedConversations.length === 0 ? (
              <div className="px-3 py-2 text-xs text-text-muted">
                No DMs yet.
              </div>
            ) : (
              sortedConversations.map((conv) => {
                const isActive = tab === 'dms' && activeConversationId === conv.id;
                const displayName = conv.otherDisplayName || conv.otherUsername;
                const dmPin: PinnedItem = { type: 'dm', otherUserId: conv.otherUserId, username: conv.otherUsername, avatar: conv.otherAvatar };
                const effectiveStatus = friendStatusById.get(conv.otherUserId) ?? conv.otherStatus;
                const isOffline = !effectiveStatus || effectiveStatus === 'invisible';
                const callForConversation = activeDMCall?.status === 'active' && activeDMCall.otherUserId === conv.otherUserId
                  ? activeDMCall
                  : null;
                const callRingClass = callForConversation?.otherDeafened
                  ? 'ring-2 ring-warning/80'
                  : callForConversation?.otherMuted
                    ? 'ring-2 ring-danger/80'
                    : '';
                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => {
                      setTab('dms');
                      void openConversation(conv.otherUserId, conv.otherUsername, conv.otherAvatar);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setPinMenu({ item: dmPin, x: e.clientX, y: e.clientY });
                    }}
                    className={`group w-full px-2 py-2 rounded text-left transition-colors ${
                      isActive
                        ? 'bg-bg-hover text-text-primary'
                        : 'text-text-secondary hover:bg-bg-hover/50 hover:text-text-primary'
                    }`}
                    title={displayName}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="relative shrink-0">
                        <img
                          src={resolveAvatarUrl(conv.otherAvatar ?? undefined, AUTH_BASE, 'central') ?? defaultAvatarUrl()}
                          alt={conv.otherUsername}
                          className={`w-7 h-7 rounded-full ${callRingClass} ${isOffline ? 'grayscale' : ''}`}
                          onError={(e) => { (e.currentTarget as HTMLImageElement).onerror = null; (e.currentTarget as HTMLImageElement).src = defaultAvatarUrl(); }}
                        />
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-bg-sidebar ${getStatusDotClass(effectiveStatus)}`}
                          title={formatPresenceStatusLabel(effectiveStatus)}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{displayName}</span>
                          {conv.unreadCount > 0 && (
                            <span className="shrink-0 bg-accent text-white text-[10px] rounded-full min-w-4 h-4 px-1 flex items-center justify-center font-semibold">
                              {conv.unreadCount}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-text-muted flex items-center justify-between gap-2">
                          <span className="truncate">@{conv.otherUsername}</span>
                          <span className="shrink-0 flex items-center gap-1">
                            {callForConversation?.otherMuted && (
                              <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-red-500/20 text-red-300" title="Muted">
                                <MicrophoneMutedIcon className="w-2.5 h-2.5" />
                              </span>
                            )}
                            {callForConversation?.otherDeafened && (
                              <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-amber-500/20 text-amber-300" title="Deafened">
                                <AudioDeafenedIcon className="w-2.5 h-2.5" />
                              </span>
                            )}
                            {callForConversation?.otherVideoEnabled && (
                              <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-sky-500/20 text-sky-300" title="Camera enabled">
                                <VideoCameraIcon className="w-2.5 h-2.5" />
                              </span>
                            )}
                            {callForConversation?.otherSharingScreen && (
                              <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-fuchsia-500/20 text-fuchsia-300" title="Sharing screen">
                                <ArrowsPointingOutIcon className="w-2.5 h-2.5" />
                              </span>
                            )}
                            <span>{formatLastMessageTime(conv.lastMessageAt)}</span>
                          </span>
                        </div>
                      </div>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); requestTogglePin(dmPin, e.shiftKey); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); requestTogglePin(dmPin, e.shiftKey); } }}
                        className={`shrink-0 transition-opacity hover:text-text-primary ${
                          isItemPinned(dmPin) ? 'text-accent opacity-100' : 'text-text-muted opacity-0 group-hover:opacity-100'
                        }`}
                        title={isItemPinned(dmPin) ? 'Unpin from taskbar (Shift to skip confirmation)' : 'Pin to taskbar (Shift to skip confirmation)'}
                      >
                        <Pin className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {pinMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setPinMenu(null)} onContextMenu={(e) => { e.preventDefault(); setPinMenu(null); }} />
          <div
            className="fixed z-[9999] bg-bg-elevated border border-border rounded shadow-lg text-sm py-1 w-44 max-w-[calc(100vw-2rem)]"
            style={{ left: pinMenu.x, top: pinMenu.y }}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
              onClick={(e) => { requestTogglePin(pinMenu.item, e.shiftKey); setPinMenu(null); }}
            >
              {isItemPinned(pinMenu.item) ? 'Unpin from Taskbar' : 'Pin to Taskbar'}
            </button>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
