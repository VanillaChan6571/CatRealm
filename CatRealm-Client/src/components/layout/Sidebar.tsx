import { AudioDeafenedIcon, AudioListeningIcon, MicrophoneLiveIcon, MicrophoneMutedIcon } from '../voice/VoiceStateIcons';
import { ReactiveAvatarBadge } from '../voice/ReactiveAvatarBadge';
import { TheaterPresenceBadge } from '../theater/TheaterPresenceBadge';
import { isTheaterVoiceDisconnected } from '../../lib/theaterPresence';
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { Cog6ToothIcon } from '@heroicons/react/24/outline';
import { MicrophoneIcon } from '@heroicons/react/24/solid';
import { BellOff, Bot as BotIcon, Clapperboard, Crown, Hash, Image as ImageIcon, Megaphone, MessageSquare, Pin, Shield, ShieldCheck } from 'lucide-react';
import { useBotStore } from '../../stores/botStore';
import { useAuthStore } from '../../stores/authStore';
import { useChannelStore } from '../../stores/channelStore';
import { useUIStore } from '../../stores/uiStore';
import { useFriendStore } from '../../stores/friendStore';
import { PERMISSIONS, hasPermission } from '../../utils/permissions';
import type { Channel, Category } from '../../types';
import { useThreadStore } from '../../stores/threadStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useTheaterStore } from '../../stores/theaterStore';
import { AvatarImage } from '../ui/AvatarImage';
import { AUTH_BASE } from '../../lib/authApi';
import { resolveAvatarUrl } from '../../utils/avatar';
import { resolveDisplayName } from '../../utils/displayName';
import { VoiceStatusPanel } from './VoiceStatusPanel';
import { TheaterStatusPanel } from './TheaterStatusPanel';
import { useServerStore } from '../../stores/serverStore';
import { getSocket } from '../../lib/socket';
import { writeClipboardText } from '../../lib/clipboard';
import { useCallStore } from '../../stores/callStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useBlockedUsersStore } from '../../stores/blockedUsersStore';
import { useViewedChannels } from '../../hooks/useViewedChannels';
import { useViewedPermissions } from '../../hooks/useViewedPermissions';
import { usePinnedStore, pinKey, type PinnedItem } from '../../stores/pinnedStore';
import { DesktopUpdateBanner } from '../ui/DesktopUpdateBanner';

function arrayFromRecord<T>(record: Record<string, T[]>, key: string): T[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

// Context menus open at the cursor; pull them back inside the window once measured.
const MENU_VIEWPORT_PAD = 8;
function clampMenuToViewport(el: HTMLDivElement | null) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const left = Math.max(MENU_VIEWPORT_PAD, Math.min(rect.left, window.innerWidth - rect.width - MENU_VIEWPORT_PAD));
  const top = Math.max(MENU_VIEWPORT_PAD, Math.min(rect.top, window.innerHeight - rect.height - MENU_VIEWPORT_PAD));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function isServerRulesChannel(channel: Channel | null | undefined) {
  return channel?.type === 'rules';
}

export function Sidebar({ showFooter = true }: { showFooter?: boolean }) {
  const { t } = useTranslation();
  const serverInfo = useAuthStore((s) => s.serverInfo);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const user = useAuthStore((s) => s.user);
  const activeServerUrl = useServerStore((s) => s.activeServerUrl);
  const channels = useViewedChannels();
  const viewed = useViewedPermissions();
  const { activeChannelId, setActiveChannel, prefsByChannel, setChannelPrefs, duplicateChannel, unreadByChannel, mentionByChannel, categories, refreshCategoriesIfStale, reorderChannels, reorderCategories, moveChannelCategory } = useChannelStore();
  const { threadsByChannel, fetchThreads, setActiveThread } = useThreadStore();
  const botDmConversations = useBotStore((s) => s.conversations);
  const botDmsOpen = useBotStore((s) => s.botDmsOpen);
  const openBotDms = useBotStore((s) => s.openBotDms);
  const botDmUnread = botDmConversations.reduce((sum, c) => sum + (c.unread || 0), 0);
  const theaterActiveChannelId = useTheaterStore((s) => s.activeChannelId);
  const theaterRoomUsersByChannel = useTheaterStore((s) => s.roomUsersByChannel);
  const theaterRoomStartedAtByChannel = useTheaterStore((s) => s.roomStartedAtByChannel);
  const theaterHostUserIdByChannel = useTheaterStore((s) => s.hostUserIdByChannel);
  const theaterJoinedAt = useTheaterStore((s) => s.theaterJoinedAt);
  const theaterMicEnabled = useTheaterStore((s) => s.micEnabled);
  const theaterSelfDeafened = useTheaterStore((s) => s.selfDeafened);
  const theaterSpeaking = useTheaterStore((s) => s.speakingByUser);
  const toggleTheaterMic = useTheaterStore((s) => s.toggleMic);
  const toggleTheaterDeafen = useTheaterStore((s) => s.toggleDeafen);
  const leaveTheater = useTheaterStore((s) => s.leaveTheater);
  const theaterSelfUserId = useTheaterStore((s) => s.selfUserId);
  const grantHost = useTheaterStore((s) => s.grantHost);
  const kickUser = useTheaterStore((s) => s.kickUser);
  const voiceRoomUsers = useVoiceStore((s) => s.voiceRoomUsers);
  const voiceRoomStartedAt = useVoiceStore((s) => s.voiceRoomStartedAt);
  const liveUserIdsByChannel = useVoiceStore((s) => s.liveUserIdsByChannel);
  const selfVoiceUserId = useVoiceStore((s) => s.selfVoiceUserId);
  const peerVolumeByUser = useVoiceStore((s) => s.peerVolumeByUser);
  const voiceSpeaking = useVoiceStore((s) => s.speakingByUser);
  const activeVoiceChannelId = useVoiceStore((s) => s.activeChannelId);
  const selfVoiceMuted = useVoiceStore((s) => s.selfMuted);
  const selfVoiceDeafened = useVoiceStore((s) => s.selfDeafened);
  const toggleVoiceMute = useVoiceStore((s) => s.toggleMute);
  const toggleVoiceDeafen = useVoiceStore((s) => s.toggleDeafen);
  const leaveVoice = useVoiceStore((s) => s.leaveVoice);
  const pushToTalkPressed = useVoiceStore((s) => s.pushToTalkPressed);
  const pressPushToTalk = useVoiceStore((s) => s.pressPushToTalk);
  const releasePushToTalk = useVoiceStore((s) => s.releasePushToTalk);
  const getChannelDisplayName = (channel: Channel) => {
    const normalizedName = channel.name.trim().toLowerCase();
    if (channel.type === 'voice' && normalizedName === 'voice chat channel') return t('channels.voiceChatChannel');
    if (channel.type === 'theater' && normalizedName === 'theater') return t('channels.theater');
    return channel.name;
  };
  const pinnedItems = usePinnedStore((s) => s.pinnedItems);
  const requestTogglePin = usePinnedStore((s) => s.requestTogglePin);
  // Build a taskbar pin payload for a channel, snapshotting its server's name/icon so
  // the chip renders even when the user is on another server or home.
  const buildChannelPinItem = (channel: Channel): PinnedItem | null => {
    const srv = useServerStore.getState();
    const targetUrl = srv.activeServerUrl ?? serverUrl;
    if (!targetUrl) return null;
    const entry = srv.servers.find((s) => s.url === targetUrl);
    const icon = entry?.icon
      ?? (serverInfo?.serverIcon
        ? (/^https?:\/\//i.test(serverInfo.serverIcon) ? serverInfo.serverIcon : `${targetUrl}${serverInfo.serverIcon}`)
        : null);
    return {
      type: 'channel',
      serverUrl: targetUrl,
      channelId: channel.id,
      name: getChannelDisplayName(channel),
      channelType: channel.type,
      serverIcon: icon,
      serverName: entry?.name ?? serverInfo?.name ?? 'Server',
    };
  };
  const channelPinKey = (channel: Channel): string =>
    pinKey({ type: 'channel', serverUrl: activeServerUrl ?? serverUrl ?? '', channelId: channel.id } as PinnedItem);
  const setPeerVolume = useVoiceStore((s) => s.setPeerVolume);
  const blockedUsers = useBlockedUsersStore((s) => s.blockedUsers);
  const activeDMCall = useCallStore((s) => s.activeDMCall);
  const activeGroupCall = useCallStore((s) => s.activeGroupCall);
  const [threadCollapse, setThreadCollapse] = useState<Record<string, boolean>>({});
  const openModal = useUIStore((s) => s.openModal);
  const openDrawer = useUIStore((s) => s.openDrawer);
  const voiceChatOpen = useUIStore((s) => s.voiceChatOpen);
  const incomingRequests = useFriendStore((s) => s.incoming);
  const canManageServerSettings = !viewed.isRoleView && hasPermission(viewed.permissions, PERMISSIONS.MANAGE_SERVER);
  const canManageChannels = !viewed.isRoleView && hasPermission(viewed.permissions, PERMISSIONS.MANAGE_CHANNELS);
  const avatarBase = user?.accountType === 'central' ? AUTH_BASE : serverUrl;
  const serverBanner = serverInfo?.serverBanner
    ? (/^https?:\/\//i.test(serverInfo.serverBanner) ? serverInfo.serverBanner : `${serverUrl || ''}${serverInfo.serverBanner}`)
    : null;
  const hasActiveCall = !!(
    (activeDMCall && activeDMCall.status === 'active')
    || (activeGroupCall && activeGroupCall.status === 'active')
  );
  const hasActiveVoice = !!activeVoiceChannelId;
  const voiceInputMode = useSettingsStore((s) => s.voiceInputMode);
  const showPushToTalk = hasActiveVoice && !hasActiveCall && voiceInputMode === 'push_to_talk';

  const [contextMenu, setContextMenu] = useState<{ channel: Channel | null; x: number; y: number } | null>(null);
  const [categoryMenu, setCategoryMenu] = useState<{ category: Category; x: number; y: number } | null>(null);
  const [voiceMemberMenu, setVoiceMemberMenu] = useState<{
    channel: Channel;
    member: (typeof voiceRoomUsers)[string][number];
    x: number;
    y: number;
  } | null>(null);
  const [theaterMemberMenu, setTheaterMemberMenu] = useState<{
    channelId: string;
    member: (typeof theaterRoomUsersByChannel)[string][number];
    x: number;
    y: number;
  } | null>(null);
  const [drag, setDrag] = useState<
    | { type: 'channel' | 'category'; id: string }
    | { type: 'voice-member'; userId: string; fromChannelId: string }
    | null
  >(null);
  const [dragOverCategoryId, setDragOverCategoryId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<{ categoryKey: string; index: number } | null>(null);
  const [dragOverVoiceChannelId, setDragOverVoiceChannelId] = useState<string | null>(null);
  const [voiceNow, setVoiceNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!contextMenu && !categoryMenu && !voiceMemberMenu && !theaterMemberMenu) return;
    const handleClick = () => {
      setContextMenu(null);
      setCategoryMenu(null);
      setVoiceMemberMenu(null);
      setTheaterMemberMenu(null);
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setCategoryMenu(null);
        setVoiceMemberMenu(null);
        setTheaterMemberMenu(null);
      }
    };
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [contextMenu, categoryMenu, voiceMemberMenu, theaterMemberMenu]);

  useEffect(() => {
    refreshCategoriesIfStale().catch(() => {});
  }, [refreshCategoriesIfStale]);

  const hasAnyTheaterRoom = Object.values(theaterRoomStartedAtByChannel).some((t) => t !== null);
  useEffect(() => {
    if (Object.keys(voiceRoomStartedAt).length === 0 && !theaterJoinedAt && !hasAnyTheaterRoom) return;
    const timer = window.setInterval(() => setVoiceNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [voiceRoomStartedAt, theaterJoinedAt, hasAnyTheaterRoom]);

  const voiceSocketUrl = user?.accountType === 'central' ? activeServerUrl : serverUrl;
  const voiceActionSocket = voiceSocketUrl ? getSocket(voiceSocketUrl) : null;

  const runVoiceModState = (payload: { channelId: string; userId: string; muted?: boolean; deafened?: boolean }) => {
    if (!voiceActionSocket?.connected) return;
    voiceActionSocket.emit('voice:mod:state', payload, (resp: { ok?: boolean; error?: string }) => {
      if (!resp?.ok) {
        console.warn('[Voice Moderation] state failed:', resp?.error || 'Unknown error');
      }
    });
  };

  const runVoiceMove = (payload: { fromChannelId: string; toChannelId: string; userId: string }) => {
    if (!voiceActionSocket?.connected) return;
    voiceActionSocket.emit('voice:mod:move', payload, (resp: { ok?: boolean; error?: string }) => {
      if (!resp?.ok) {
        console.warn('[Voice Moderation] move failed:', resp?.error || 'Unknown error');
      }
    });
  };

  const runVoiceDisconnect = (payload: { channelId: string; userId: string }) => {
    if (!voiceActionSocket?.connected) return;
    voiceActionSocket.emit('voice:mod:disconnect', payload, (resp: { ok?: boolean; error?: string }) => {
      if (!resp?.ok) {
        console.warn('[Voice Moderation] disconnect failed:', resp?.error || 'Unknown error');
      }
    });
  };

  const handlePushToTalkPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pressPushToTalk();
  };

  return (
    <div
      className="w-full md:w-60 bg-bg-sidebar flex flex-col h-full shrink-0"
      data-debug-name="Sidebar"
      data-debug-file="src/components/layout/Sidebar.tsx"
    >
      {/* Server header */}
      <div
        className="px-4 py-3 border-b border-border shadow-sm relative overflow-hidden min-h-[104px] flex items-end"
        data-debug-name="Sidebar Server Header"
        data-debug-file="src/components/layout/Sidebar.tsx"
      >
        {serverBanner && (
          <>
            <img
              src={serverBanner}
              alt="Server banner"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/45" />
          </>
        )}
        {canManageServerSettings ? (
          <button
            type="button"
            onClick={() => openModal('adminSettings')}
            className="font-semibold text-text-primary truncate text-left w-full hover:text-text-secondary transition-colors relative z-10"
            title="Realm Settings"
          >
            {serverInfo?.name || 'CatRealm'}
          </button>
        ) : (
          <h2 className="font-semibold text-text-primary truncate relative z-10">
            {serverInfo?.name || 'CatRealm'}
          </h2>
        )}
      </div>

      {/* Channels */}
      <div
        className="flex-1 overflow-y-auto px-2 py-2"
        data-debug-name="Sidebar Channel List"
        data-debug-file="src/components/layout/Sidebar.tsx"
        onContextMenu={(e) => {
          if (!canManageChannels) return;
          if ((e.target as HTMLElement).closest('button')) return;
          e.preventDefault();
          setContextMenu({ channel: null, x: e.clientX, y: e.clientY });
        }}
      >
        {channels.some((c) => isServerRulesChannel(c)) && (
          renderCategoryGroup(null, 'System', channels.filter((c) => isServerRulesChannel(c)), 'rules')
        )}

        {/* Bot DMs — pinned pseudo-channel; visible once any bot has messaged the user */}
        {botDmConversations.length > 0 && (
          <button
            type="button"
            onClick={() => openBotDms(botDmConversations[0]?.botId ?? null)}
            className={`w-full flex items-center gap-1.5 px-2 py-1 mb-2 rounded text-left transition-colors ${
              botDmsOpen ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary'
            }`}
          >
            <BotIcon className="w-4 h-4 shrink-0 text-indigo-400" />
            <span className="flex-1 truncate text-sm">Bot DMs</span>
            {botDmUnread > 0 && (
              <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[11px] font-bold flex items-center justify-center">
                {botDmUnread > 99 ? '99+' : botDmUnread}
              </span>
            )}
          </button>
        )}

        <div className="flex items-center justify-between px-2 mb-1">
          <span className="text-xs font-semibold uppercase text-text-muted">
            Channels
          </span>
          {canManageChannels && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => openModal('createCategory')}
                className="text-text-muted hover:text-text-secondary transition-colors text-lg leading-none"
                title="Create Category"
              >
                ▤
              </button>
              <button
                onClick={() => openModal('createChannel')}
                className="text-text-muted hover:text-text-secondary transition-colors text-lg leading-none"
                title="Create Channel"
              >
                +
              </button>
            </div>
          )}
        </div>

        {renderCategoryGroup(null, 'Uncategorized', channels.filter((c) => !c.category_id && !isServerRulesChannel(c)))}
        {categories.map((cat) => (
          renderCategoryGroup(cat, cat.name, channels.filter((c) => c.category_id === cat.id && !isServerRulesChannel(c)))
        ))}
      </div>

      {/* User footer */}
      {showFooter && (
        <div
          className="px-2 py-2 border-t border-border bg-bg-elevated"
          data-debug-name="Sidebar Footer"
          data-debug-file="src/components/layout/Sidebar.tsx"
        >
          <VoiceStatusPanel />
          <TheaterStatusPanel />
          {theaterActiveChannelId && (
            <div className="mb-2 flex items-center gap-1 px-2">
              <button
                type="button"
                onClick={() => { void toggleTheaterMic(); }}
                className={`h-8 px-2.5 rounded-lg flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
                  !theaterMicEnabled || theaterSelfDeafened ? 'bg-danger text-white' : 'bg-bg-hover text-text-primary hover:bg-bg-input'
                }`}
                title={!theaterMicEnabled || theaterSelfDeafened ? 'Unmute' : 'Mute'}
              >
                {!theaterMicEnabled || theaterSelfDeafened ? <MicrophoneMutedIcon className="w-4 h-4" /> : <MicrophoneLiveIcon className="w-4 h-4" />}
                <span>{!theaterMicEnabled || theaterSelfDeafened ? 'Muted' : 'Mute'}</span>
              </button>
              <button
                type="button"
                onClick={toggleTheaterDeafen}
                className={`h-8 px-2.5 rounded-lg flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
                  theaterSelfDeafened ? 'bg-warning text-black' : 'bg-bg-hover text-text-primary hover:bg-bg-input'
                }`}
                title={theaterSelfDeafened ? 'Undeafen' : 'Deafen'}
              >
                {theaterSelfDeafened ? <AudioDeafenedIcon className="w-4 h-4" /> : <AudioListeningIcon className="w-4 h-4" />}
                <span>{theaterSelfDeafened ? 'Deafened' : 'Deafen'}</span>
              </button>
              <button
                type="button"
                onClick={() => openModal('profileSettings', { initialTab: 'voice' })}
                className="w-8 h-8 rounded-lg flex items-center justify-center bg-bg-hover text-text-primary hover:bg-bg-input transition-colors"
                title="Voice settings"
                aria-label="Open voice settings"
              >
                <Cog6ToothIcon className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={leaveTheater}
                className="ml-auto h-8 px-2.5 rounded-lg text-xs font-medium bg-danger text-white hover:bg-danger/90 transition-colors"
                title="Leave theater"
              >
                Leave
              </button>
            </div>
          )}
          {hasActiveVoice && (
            <div className="mb-2 flex items-center gap-1 px-2">
              {hasActiveCall ? (
                <>
                  <button
                    type="button"
                    onClick={toggleVoiceMute}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                      selfVoiceMuted ? 'bg-danger text-white' : 'bg-bg-hover text-text-primary hover:bg-bg-input'
                    }`}
                    title={selfVoiceMuted ? 'Unmute' : 'Mute'}
                    aria-label={selfVoiceMuted ? t('voice.unmuteMic') : t('voice.muteMic')}
                  >
                    {selfVoiceMuted ? <MicrophoneMutedIcon className="w-4 h-4" /> : <MicrophoneLiveIcon className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={toggleVoiceDeafen}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                      selfVoiceDeafened ? 'bg-warning text-black' : 'bg-bg-hover text-text-primary hover:bg-bg-input'
                    }`}
                    title={selfVoiceDeafened ? 'Undeafen' : 'Deafen'}
                    aria-label={selfVoiceDeafened ? t('voice.undeafenAudio') : t('voice.deafenAudio')}
                  >
                    {selfVoiceDeafened ? <AudioDeafenedIcon className="w-4 h-4" /> : <AudioListeningIcon className="w-4 h-4" />}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={toggleVoiceMute}
                    className={`h-8 px-2.5 rounded-lg flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
                      selfVoiceMuted ? 'bg-danger text-white' : 'bg-bg-hover text-text-primary hover:bg-bg-input'
                    }`}
                    title={selfVoiceMuted ? 'Unmute' : 'Mute'}
                  >
                    {selfVoiceMuted ? <MicrophoneMutedIcon className="w-4 h-4" /> : <MicrophoneLiveIcon className="w-4 h-4" />}
                    <span>{selfVoiceMuted ? 'Muted' : 'Mute'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={toggleVoiceDeafen}
                    className={`h-8 px-2.5 rounded-lg flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
                      selfVoiceDeafened ? 'bg-warning text-black' : 'bg-bg-hover text-text-primary hover:bg-bg-input'
                    }`}
                    title={selfVoiceDeafened ? 'Undeafen' : 'Deafen'}
                  >
                    {selfVoiceDeafened ? <AudioDeafenedIcon className="w-4 h-4" /> : <AudioListeningIcon className="w-4 h-4" />}
                    <span>{selfVoiceDeafened ? 'Deafened' : 'Deafen'}</span>
                  </button>
                  {showPushToTalk && (
                    <button
                      type="button"
                      onPointerDown={handlePushToTalkPointerDown}
                      onPointerUp={releasePushToTalk}
                      onPointerCancel={releasePushToTalk}
                      onLostPointerCapture={releasePushToTalk}
                      className={`h-8 px-2.5 rounded-lg flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
                        pushToTalkPressed ? 'bg-amber-400 text-black' : 'bg-fuchsia-500 text-white hover:bg-fuchsia-400'
                      }`}
                      title={selfVoiceMuted || selfVoiceDeafened ? 'Unmute and undeafen to use push to talk.' : 'Hold to talk'}
                    >
                      <MicrophoneIcon className="w-4 h-4" />
                      <span>{pushToTalkPressed ? 'Talking' : 'Hold to Talk'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openModal('profileSettings', { initialTab: 'voice' })}
                    className="w-8 h-8 rounded-lg flex items-center justify-center bg-bg-hover text-text-primary hover:bg-bg-input transition-colors"
                    title="Voice settings"
                    aria-label="Open voice settings"
                  >
                    <Cog6ToothIcon className="w-4 h-4" />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={leaveVoice}
                className="ml-auto h-8 px-2.5 rounded-lg text-xs font-medium bg-danger text-white hover:bg-danger/90 transition-colors"
                title="Leave voice"
              >
                Leave
              </button>
            </div>
          )}
          <DesktopUpdateBanner />
          <div className="flex items-center gap-2 px-2">
            <div className="relative w-8 h-8 rounded-full avatar-bg flex items-center justify-center text-white text-sm font-semibold shrink-0 overflow-hidden">
            <AvatarImage
              src={resolveAvatarUrl(user?.avatar, avatarBase)}
              alt={user?.username ?? 'avatar'}
              size={32}
                className={`w-8 h-8 object-cover ${user?.status === 'invisible' ? 'grayscale' : ''}`}
                fallback={<span>{user?.username?.charAt(0).toUpperCase()}</span>}
              />
            </div>
            <button
              type="button"
              onClick={() => openModal('profileSettings')}
              onContextMenu={(e) => {
                e.preventDefault();
                openDrawer('serverInfo');
              }}
              className="flex-1 min-w-0 text-left rounded px-1 -mx-1 hover:bg-bg-hover/60 transition-colors"
              title="Profile (right-click for server info)"
            >
              <p className="text-sm text-text-primary font-medium truncate">
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full mr-1 align-middle ${
                    user?.status === 'away'
                      ? 'bg-warning'
                      : user?.status === 'sleeping'
                      ? 'status-sleeping'
                      : user?.status === 'invisible'
                      ? 'bg-text-muted'
                      : 'bg-success'
                  }`}
                  title={user?.status ?? 'online'}
                />
                {(user?.isOwner || user?.role === 'owner') && <Crown className="mr-1 inline h-3.5 w-3.5" />}
                {user ? resolveDisplayName(user.id, user.username, user.displayName) : ''}
              </p>
              <p className="text-xs text-text-muted">{user?.accountType}</p>
            </button>
            {user?.accountType === 'central' && (
              <button
                onClick={() => openModal('friends')}
                className="text-text-muted hover:text-text-primary transition-colors shrink-0 relative"
                title="Friends"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                {incomingRequests.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-danger rounded-full" />
                )}
              </button>
            )}
            <button
              onClick={() => openModal('privacySummary')}
              className="text-text-muted hover:text-text-primary transition-colors text-xs shrink-0"
              title="Privacy Summary"
            >
              <Shield className="h-4 w-4" />
            </button>
            <button
              onClick={() => openModal('confirmLogout')}
              className="text-text-muted hover:text-danger transition-colors text-xs shrink-0"
              title="Log Out"
            >
              &#x2716;
            </button>
          </div>
        </div>
      )}

      {contextMenu && createPortal(
        <div
          key={`${contextMenu.x},${contextMenu.y}`}
          ref={clampMenuToViewport}
          className="fixed z-[9999] bg-bg-elevated border border-border rounded shadow-lg text-sm py-1 w-48 max-w-[calc(100vw-2rem)] max-h-[calc(100vh-1rem)] overflow-y-auto"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {!contextMenu.channel && (
            <>
              <button
                className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
                onClick={() => {
                  openModal('createChannel');
                  setContextMenu(null);
                }}
              >
                Create Channel
              </button>
              <button
                className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
                onClick={() => {
                  openModal('createCategory');
                  setContextMenu(null);
                }}
              >
                Create Category
              </button>
            </>
          )}
          {contextMenu.channel && !isServerRulesChannel(contextMenu.channel) && (
            <button
              className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
              onClick={() => {
                const ch = contextMenu.channel!;
                const prefs = prefsByChannel[ch.id];
                setChannelPrefs(ch.id, { muted: !(prefs?.muted ?? false) });
                setContextMenu(null);
              }}
            >
              {(prefsByChannel[contextMenu.channel.id]?.muted) ? 'Unmute Channel' : 'Mute Channel'}
            </button>
          )}
          {contextMenu.channel && !isServerRulesChannel(contextMenu.channel) && (
            <button
              className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
              onClick={() => {
                setChannelPrefs(contextMenu.channel!.id, { lastReadAt: Math.floor(Date.now() / 1000) });
                setContextMenu(null);
              }}
            >
              Mark As Read
            </button>
          )}
          {contextMenu.channel && (
            <button
              className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
              onClick={() => {
                void writeClipboardText(contextMenu.channel!.id);
                setContextMenu(null);
              }}
            >
              Copy Channel ID
            </button>
          )}
          {contextMenu.channel && (
            <button
              className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
              onClick={(e) => {
                const item = buildChannelPinItem(contextMenu.channel!);
                if (item) requestTogglePin(item, e.shiftKey);
                setContextMenu(null);
              }}
            >
              {pinnedItems.some((p) => pinKey(p) === channelPinKey(contextMenu.channel!))
                ? 'Unpin from Taskbar'
                : 'Pin to Taskbar'}
            </button>
          )}
          {contextMenu.channel && canManageChannels && (
            <>
              <div className="border-t border-border my-1" />
              <button
                className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
                onClick={() => {
                  openModal('editChannel', contextMenu.channel!);
                  setContextMenu(null);
                }}
              >
                {isServerRulesChannel(contextMenu.channel) ? 'Rename Channel' : 'Edit Channel'}
              </button>
              {!isServerRulesChannel(contextMenu.channel) && (
                <>
                  <button
                    className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
                    onClick={async () => {
                      await duplicateChannel(contextMenu.channel!.id);
                      setContextMenu(null);
                    }}
                  >
                    Duplicate Channel
                  </button>
                  <button
                    className="w-full text-left px-3 py-1.5 text-danger hover:bg-bg-hover/50"
                    onClick={() => {
                      openModal('deleteChannel', contextMenu.channel!);
                      setContextMenu(null);
                    }}
                  >
                    Delete Channel
                  </button>
                </>
              )}
            </>
          )}
        </div>,
        document.body
      )}

      {categoryMenu && createPortal(
        <div
          key={`${categoryMenu.x},${categoryMenu.y}`}
          ref={clampMenuToViewport}
          className="fixed z-[9999] bg-bg-elevated border border-border rounded shadow-lg text-sm py-1 w-44 max-w-[calc(100vw-2rem)] max-h-[calc(100vh-1rem)] overflow-y-auto"
          style={{ left: categoryMenu.x, top: categoryMenu.y }}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
            onClick={() => {
              openModal('editCategory', categoryMenu.category);
              setCategoryMenu(null);
            }}
          >
            Edit Category
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-danger hover:bg-bg-hover/50"
            onClick={() => {
              openModal('deleteCategory', categoryMenu.category);
              setCategoryMenu(null);
            }}
          >
            Delete Category
          </button>
        </div>,
        document.body
      )}

      {voiceMemberMenu && createPortal(
        <div
          key={`${voiceMemberMenu.x},${voiceMemberMenu.y}`}
          ref={clampMenuToViewport}
          className="fixed z-[9999] bg-bg-elevated border border-border rounded shadow-lg text-sm py-1 w-64 max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto"
          style={{ left: voiceMemberMenu.x, top: voiceMemberMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-border">
            <div className="text-xs text-text-muted">Voice Member</div>
            <div className="text-sm text-text-primary truncate">{voiceMemberMenu.member.username}</div>
          </div>
          {voiceMemberMenu.member.id !== selfVoiceUserId && (
            <div className="px-3 py-2 border-b border-border">
              <div className="flex items-center justify-between gap-2 text-xs text-text-muted mb-1">
                <span>User Volume</span>
                {blockedUsers.has(voiceMemberMenu.member.id)
                  ? <span className="text-text-muted italic">Blocked</span>
                  : <span>{peerVolumeByUser[voiceMemberMenu.member.id] ?? 50}%</span>
                }
              </div>
              {blockedUsers.has(voiceMemberMenu.member.id) ? (
                <div className="text-xs text-text-muted italic">Volume unavailable for blocked users</div>
              ) : (
                <input
                  type="range"
                  min={0}
                  max={300}
                  step={5}
                  value={peerVolumeByUser[voiceMemberMenu.member.id] ?? 50}
                  onChange={(e) => setPeerVolume(voiceMemberMenu.member.id, Number(e.target.value) || 0)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full accent-emerald-400"
                  aria-label={`Volume for ${voiceMemberMenu.member.username}`}
                />
              )}
            </div>
          )}
          <button
            className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
            onClick={() => {
              openModal('profileView', { userId: voiceMemberMenu.member.id });
              setVoiceMemberMenu(null);
            }}
          >
            {t('profile.viewProfile')}
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
            onClick={() => {
              void writeClipboardText(voiceMemberMenu.member.id);
              setVoiceMemberMenu(null);
            }}
          >
            {t('profile.copyUserId')}
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
            onClick={() => {
              void writeClipboardText(voiceMemberMenu.member.username);
              setVoiceMemberMenu(null);
            }}
          >
            {t('profile.copyName')}
          </button>
          {(() => {
            const menuChannel = voiceMemberMenu.channel;
            const effectivePerms = typeof menuChannel.effective_permissions === 'number'
              ? menuChannel.effective_permissions
              : user?.permissions;
            const canServerMute = hasPermission(effectivePerms, PERMISSIONS.SERVER_MUTE_MEMBERS);
            const canServerDeafen = hasPermission(effectivePerms, PERMISSIONS.SERVER_DEAFEN_MEMBERS);
            const canMoveMembers = hasPermission(effectivePerms, PERMISSIONS.MOVE_VOICE_MEMBERS);
            const moveTargets = channels.filter((ch) => ch.type === 'voice' && ch.id !== menuChannel.id);
            if (!canServerMute && !canServerDeafen && !canMoveMembers) return null;
            const isSelf = voiceMemberMenu.member.id === (selfVoiceUserId ?? user?.id);
            const canDisconnect = isSelf || canMoveMembers;
            return (
              <>
                <div className="border-t border-border my-1" />
                {canServerMute && (
                  <button
                    className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
                    onClick={() => {
                      runVoiceModState({
                        channelId: menuChannel.id,
                        userId: voiceMemberMenu.member.id,
                        muted: !voiceMemberMenu.member.muted,
                      });
                      setVoiceMemberMenu(null);
                    }}
                  >
                    {voiceMemberMenu.member.muted ? 'Server Unmute' : 'Server Mute'}
                  </button>
                )}
                {canServerDeafen && (
                  <button
                    className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
                    onClick={() => {
                      runVoiceModState({
                        channelId: menuChannel.id,
                        userId: voiceMemberMenu.member.id,
                        deafened: !voiceMemberMenu.member.deafened,
                      });
                      setVoiceMemberMenu(null);
                    }}
                  >
                    {voiceMemberMenu.member.deafened ? 'Server Undeafen' : 'Server Deafen'}
                  </button>
                )}
                {canMoveMembers && moveTargets.length > 0 && (
                  <>
                    <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-text-muted">Move To Voice</div>
                    {moveTargets.map((target) => (
                      <button
                        key={`move-voice-${voiceMemberMenu.member.id}-${target.id}`}
                        className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50 truncate"
                        onClick={() => {
                          runVoiceMove({
                            fromChannelId: menuChannel.id,
                            toChannelId: target.id,
                            userId: voiceMemberMenu.member.id,
                          });
                          setVoiceMemberMenu(null);
                        }}
                        title={target.name}
                      >
                        Move to {target.name}
                      </button>
                    ))}
                  </>
                )}
                {canDisconnect && (
                  <button
                    className="w-full text-left px-3 py-1.5 text-danger hover:bg-bg-hover/50"
                    onClick={() => {
                      if (isSelf) {
                        leaveVoice();
                      } else {
                        runVoiceDisconnect({
                          channelId: menuChannel.id,
                          userId: voiceMemberMenu.member.id,
                        });
                      }
                      setVoiceMemberMenu(null);
                    }}
                  >
                    {isSelf ? 'Leave Voice' : 'Disconnect from Voice'}
                  </button>
                )}
              </>
            );
          })()}
        </div>,
        document.body
      )}
      {theaterMemberMenu && createPortal(
        <div
          key={`${theaterMemberMenu.x},${theaterMemberMenu.y}`}
          ref={clampMenuToViewport}
          className="fixed z-[9999] bg-bg-elevated border border-border rounded shadow-lg text-sm py-1 w-64 max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto"
          style={{ left: theaterMemberMenu.x, top: theaterMemberMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-border">
            <div className="text-xs text-text-muted">Theater Member</div>
            <div className="text-sm text-text-primary truncate">{theaterMemberMenu.member.username}</div>
          </div>
          {theaterMemberMenu.member.id !== theaterSelfUserId && (
            <div className="px-3 py-2 border-b border-border">
              <div className="flex items-center justify-between gap-2 text-xs text-text-muted mb-1">
                <span>User Volume</span>
                {blockedUsers.has(theaterMemberMenu.member.id)
                  ? <span className="text-text-muted italic">Blocked</span>
                  : <span>{peerVolumeByUser[theaterMemberMenu.member.id] ?? 50}%</span>
                }
              </div>
              {blockedUsers.has(theaterMemberMenu.member.id) ? (
                <div className="text-xs text-text-muted italic">Volume unavailable for blocked users</div>
              ) : (
                <input
                  type="range"
                  min={0}
                  max={300}
                  step={5}
                  value={peerVolumeByUser[theaterMemberMenu.member.id] ?? 50}
                  onChange={(e) => setPeerVolume(theaterMemberMenu.member.id, Number(e.target.value) || 0)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full accent-emerald-400"
                  aria-label={`Volume for ${theaterMemberMenu.member.username}`}
                />
              )}
            </div>
          )}
          <button
            className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
            onClick={() => {
              openModal('profileView', { userId: theaterMemberMenu.member.id });
              setTheaterMemberMenu(null);
            }}
          >
            {t('profile.viewProfile')}
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
            onClick={() => {
              void writeClipboardText(theaterMemberMenu.member.id);
              setTheaterMemberMenu(null);
            }}
          >
            {t('profile.copyUserId')}
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
            onClick={() => {
              void writeClipboardText(theaterMemberMenu.member.username);
              setTheaterMemberMenu(null);
            }}
          >
            Copy Name
          </button>
          {canManageChannels && (
            <>
              <div className="border-t border-border my-1" />
              {theaterHostUserIdByChannel[theaterMemberMenu.channelId] !== theaterMemberMenu.member.id && (
                <button
                  className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
                  onClick={() => {
                    grantHost(theaterMemberMenu.channelId, theaterMemberMenu.member.id);
                    setTheaterMemberMenu(null);
                  }}
                >
                  Grant Host
                </button>
              )}
              {theaterMemberMenu.member.id !== theaterSelfUserId && (
                <button
                  className="w-full text-left px-3 py-1.5 text-danger hover:bg-bg-hover/50"
                  onClick={() => {
                    kickUser(theaterMemberMenu.channelId, theaterMemberMenu.member.id);
                    setTheaterMemberMenu(null);
                  }}
                >
                  Kick from Theater
                </button>
              )}
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );

  function renderCategoryGroup(category: Category | null, label: string, catChannels: Channel[], groupKey?: string) {
    const categoryKey = groupKey ?? category?.id ?? 'uncat';
    return (
      <div
        key={categoryKey}
        className="mb-2"
        data-debug-name={`Sidebar Category Group: ${label}`}
        data-debug-file="src/components/layout/Sidebar.tsx"
        onDragOver={(e) => {
          if (!canManageChannels) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
          onDrop={() => {
          if (!canManageChannels) return;
          if (!drag || drag.type !== 'channel') return;
          const targetIndex = dragOverTarget?.categoryKey === categoryKey ? dragOverTarget.index : catChannels.length;
          const ids = catChannels.map((c) => c.id);
          const isSameCategory = ids.includes(drag.id);
          let nextIds = [...ids];
          if (!isSameCategory) {
            nextIds.splice(targetIndex, 0, drag.id);
            moveChannelCategory(drag.id, category ? category.id : null).catch(() => {});
          } else {
            const from = nextIds.indexOf(drag.id);
            if (from !== -1) {
              nextIds.splice(targetIndex, 0, nextIds.splice(from, 1)[0]);
            }
          }
          reorderChannels(nextIds).catch(() => {});
          setDrag(null);
          setDragOverTarget(null);
        }}
      >
        <div
          className={`text-xs font-semibold uppercase px-2 mb-1 cursor-grab ${
            dragOverCategoryId === categoryKey ? 'text-accent' : 'text-text-muted'
          }`}
          draggable={canManageChannels && !!category}
          onDragStart={() => {
            if (!canManageChannels) return;
            if (category) setDrag({ type: 'category', id: category.id });
          }}
          onDragOver={(e) => {
            if (!canManageChannels) return;
            e.preventDefault();
          }}
          onDrop={() => {
            if (!canManageChannels) return;
            if (!drag) return;
            if (drag.type === 'category' && category) {
              const ids = categories.map((c) => c.id);
              const from = ids.indexOf(drag.id);
              const to = ids.indexOf(category.id);
              if (from === -1 || to === -1 || from === to) return;
              ids.splice(to, 0, ids.splice(from, 1)[0]);
              reorderCategories(ids).catch(() => {});
              setDrag(null);
            }
            if (drag.type === 'channel') {
              moveChannelCategory(drag.id, category ? category.id : null).catch(() => {});
              setDrag(null);
            }
          }}
          onDragEnter={() => setDragOverCategoryId(categoryKey)}
          onDragLeave={() => setDragOverCategoryId(null)}
          onContextMenu={(e) => {
            if (!canManageChannels) return;
            if (!category) return;
            e.preventDefault();
            setCategoryMenu({ category, x: e.clientX, y: e.clientY });
          }}
          title={category ? 'Drag to reorder category' : undefined}
        >
          {label}
          {dragOverCategoryId === categoryKey && (
            <span className="ml-2 text-[10px] text-accent">Drop to move</span>
          )}
        </div>
        {catChannels.length === 0 && (
          <>
            {dragOverTarget && dragOverTarget.categoryKey === categoryKey && dragOverTarget.index === 0 && (
              <div className="drop-line" />
            )}
            <div className="px-4 py-1 text-xs text-text-muted italic">
              No channels
            </div>
          </>
        )}
        {catChannels.map((channel, index) => (
          <div key={channel.id}>
            {dragOverTarget && dragOverTarget.categoryKey === categoryKey && dragOverTarget.index === index && (
              <div className="drop-line" />
            )}
            <button
              data-debug-name={`Sidebar Channel Row: ${channel.name}`}
              data-debug-file="src/components/layout/Sidebar.tsx"
              onClick={() => {
                setActiveChannel(channel.id);
                fetchThreads(channel.id).catch(() => {});
              }}
              draggable={canManageChannels && !isServerRulesChannel(channel)}
              onDragStart={(e) => {
                if (!canManageChannels || isServerRulesChannel(channel)) return;
                setDrag({ type: 'channel', id: channel.id });
                e.dataTransfer.effectAllowed = 'move';
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ channel, x: e.clientX, y: e.clientY });
              }}
              onDragOver={(e) => {
                if (drag?.type === 'voice-member' && channel.type === 'voice') {
                  const effectivePerms = typeof channel.effective_permissions === 'number'
                    ? channel.effective_permissions
                    : user?.permissions;
                  const canMoveMembers = hasPermission(effectivePerms, PERMISSIONS.MOVE_VOICE_MEMBERS);
                  if (!canMoveMembers || drag.fromChannelId === channel.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDragOverVoiceChannelId(channel.id);
                  return;
                }
                if (!canManageChannels) return;
                e.preventDefault();
                const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                const before = e.clientY < rect.top + rect.height / 2;
                const lineIndex = before ? index : index + 1;
                setDragOverTarget({ categoryKey, index: lineIndex });
              }}
              onDragLeave={() => {
                if (dragOverVoiceChannelId === channel.id) {
                  setDragOverVoiceChannelId(null);
                }
              }}
              onDrop={() => {
                if (drag?.type === 'voice-member' && channel.type === 'voice') {
                  const effectivePerms = typeof channel.effective_permissions === 'number'
                    ? channel.effective_permissions
                    : user?.permissions;
                  const canMoveMembers = hasPermission(effectivePerms, PERMISSIONS.MOVE_VOICE_MEMBERS);
                  if (canMoveMembers && drag.fromChannelId !== channel.id) {
                    runVoiceMove({
                      fromChannelId: drag.fromChannelId,
                      toChannelId: channel.id,
                      userId: drag.userId,
                    });
                  }
                  setDrag(null);
                  setDragOverVoiceChannelId(null);
                  return;
                }
                if (!canManageChannels) return;
                if (!drag || drag.type !== 'channel') return;
                const targetIds = catChannels.map((c) => c.id);
                const isSameCategory = targetIds.includes(drag.id);
                const without = targetIds.filter((id) => id !== drag.id);
                let insertIndex = dragOverTarget?.categoryKey === categoryKey ? dragOverTarget.index : without.length;
                if (insertIndex < 0) insertIndex = 0;
                if (insertIndex > without.length) insertIndex = without.length;
                if (isSameCategory) {
                  const fromIndex = targetIds.indexOf(drag.id);
                  if (fromIndex !== -1 && fromIndex < insertIndex) {
                    insertIndex -= 1;
                  }
                }
                const nextIds = [...without];
                nextIds.splice(insertIndex, 0, drag.id);
                if (!isSameCategory) {
                  moveChannelCategory(drag.id, category ? category.id : null).catch(() => {});
                }
                const sameOrder =
                  nextIds.length === targetIds.length &&
                  nextIds.every((id, i) => id === targetIds[i]);
                if (!sameOrder) {
                  reorderChannels(nextIds).catch(() => {});
                }
                setDrag(null);
                setDragOverTarget(null);
              }}
              className={`group w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-1.5 transition-colors ${
                activeChannelId === channel.id
                  ? 'bg-bg-hover text-text-primary'
                  : dragOverVoiceChannelId === channel.id
                    ? 'bg-emerald-500/10 text-text-primary ring-1 ring-emerald-400/50'
                    : 'text-text-secondary hover:bg-bg-hover/50 hover:text-text-primary'
              }`}
            >
              <span className="text-text-muted">
                {channel.type === 'voice'
                  ? <AudioListeningIcon className="h-4 w-4" />
                  : channel.type === 'media'
                    ? <ImageIcon className="h-4 w-4" />
                    : channel.type === 'announcement'
                      ? <Megaphone className="h-4 w-4" />
                      : channel.type === 'forum'
                        ? <MessageSquare className="h-4 w-4" />
                        : channel.type === 'theater'
                          ? <Clapperboard className="h-4 w-4" />
                          : isServerRulesChannel(channel)
                            ? <ShieldCheck className="h-4 w-4" />
                            : <Hash className="h-4 w-4" />}
              </span>
              <span className="truncate">{getChannelDisplayName(channel)}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  const item = buildChannelPinItem(channel);
                  if (item) requestTogglePin(item, e.shiftKey);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    const item = buildChannelPinItem(channel);
                    if (item) requestTogglePin(item, e.shiftKey);
                  }
                }}
                className={`shrink-0 transition-opacity hover:text-text-primary ${
                  pinnedItems.some((p) => pinKey(p) === channelPinKey(channel))
                    ? 'text-accent opacity-100'
                    : 'text-text-muted opacity-0 group-hover:opacity-100'
                }`}
                title={pinnedItems.some((p) => pinKey(p) === channelPinKey(channel)) ? 'Unpin from taskbar (Shift to skip confirmation)' : 'Pin to taskbar (Shift to skip confirmation)'}
              >
                <Pin className="h-3.5 w-3.5" />
              </span>
              {channel.type === 'voice' && (liveUserIdsByChannel[channel.id]?.length ?? 0) > 0 && (
                <span
                  className="shrink-0 rounded-full bg-pink-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-pink-200"
                  title={`${liveUserIdsByChannel[channel.id]?.length ?? 0} live stream${(liveUserIdsByChannel[channel.id]?.length ?? 0) === 1 ? '' : 's'} in this voice channel`}
                >
                  Live
                </span>
              )}
              {channel.type === 'voice' && voiceRoomStartedAt[channel.id] && (
                <span className="text-[10px] text-emerald-300 shrink-0" title="Call elapsed">
                  {formatVoiceElapsed(Math.max(0, voiceNow - voiceRoomStartedAt[channel.id]))}
                </span>
              )}
              {channel.type === 'theater' && theaterRoomStartedAtByChannel[channel.id] != null && (
                <span className="text-[10px] text-emerald-300 shrink-0" title="Theater elapsed">
                  {formatVoiceElapsed(Math.max(0, voiceNow - (theaterRoomStartedAtByChannel[channel.id] as number)))}
                </span>
              )}
              {!!channel.nsfw && <span className="rounded bg-danger/20 px-1 text-[10px] font-semibold text-danger">18+</span>}
              {channel.type === 'voice' && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveChannel(channel.id);
                    fetchThreads(channel.id).catch(() => {});
                    useUIStore.setState({ voiceChatOpen: !voiceChatOpen });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      setActiveChannel(channel.id);
                      fetchThreads(channel.id).catch(() => {});
                      useUIStore.setState({ voiceChatOpen: !voiceChatOpen });
                    }
                  }}
                  className="ml-auto text-text-muted hover:text-text-primary text-xs"
                  title={voiceChatOpen ? 'Hide voice text chat' : 'Open voice text chat'}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                </span>
              )}
              {channel.type !== 'forum' && (threadsByChannel[channel.id]?.length ?? 0) > 0 && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setThreadCollapse((s) => ({ ...s, [channel.id]: !s[channel.id] }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      setThreadCollapse((s) => ({ ...s, [channel.id]: !s[channel.id] }));
                    }
                  }}
                  className="ml-2 text-text-muted hover:text-text-primary cursor-pointer"
                  title={threadCollapse[channel.id] ? 'Show threads' : 'Hide threads'}
                >
                  {threadCollapse[channel.id] ? '>' : 'v'}
                </span>
              )}
              {prefsByChannel[channel.id]?.muted && (
                <span title="Muted">
                  <BellOff className="h-3.5 w-3.5 text-text-muted" />
                </span>
              )}
              {mentionByChannel[channel.id] > 0 ? (
                <span className="ml-2 bg-danger text-white text-[10px] px-1.5 py-0.5 rounded-full">
                  {mentionByChannel[channel.id]}
                </span>
              ) : unreadByChannel[channel.id] > 0 ? (
                <span className="ml-2 bg-white text-black text-[10px] px-1.5 py-0.5 rounded-full">
                  {unreadByChannel[channel.id]}
                </span>
              ) : null}
            </button>
            {channel.type === 'voice' && arrayFromRecord(voiceRoomUsers, channel.id).length > 0 && (
              <div className="pl-7 pr-2 py-1.5 space-y-1.5">
                {arrayFromRecord(voiceRoomUsers, channel.id).map((member) => {
                  const isLive = arrayFromRecord(liveUserIdsByChannel, channel.id).includes(member.id);
                  return (
                  <button
                    key={`${channel.id}:${member.id}`}
                    type="button"
                    data-debug-name={`Sidebar Voice Member: ${member.username}`}
                    data-debug-file="src/components/layout/Sidebar.tsx"
                    draggable={hasPermission(
                      typeof channel.effective_permissions === 'number' ? channel.effective_permissions : user?.permissions,
                      PERMISSIONS.MOVE_VOICE_MEMBERS
                    )}
                    className="w-full flex items-center gap-2 text-sm text-text-muted hover:text-text-primary hover:bg-bg-hover/30 rounded px-1 py-1 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      openModal('profileView', { userId: member.id });
                    }}
                    onDragStart={(e) => {
                      const effectivePerms = typeof channel.effective_permissions === 'number'
                        ? channel.effective_permissions
                        : user?.permissions;
                      const canMoveMembers = hasPermission(effectivePerms, PERMISSIONS.MOVE_VOICE_MEMBERS);
                      if (!canMoveMembers) {
                        e.preventDefault();
                        return;
                      }
                      e.stopPropagation();
                      e.dataTransfer.effectAllowed = 'move';
                      setDrag({ type: 'voice-member', userId: member.id, fromChannelId: channel.id });
                    }}
                    onDragEnd={() => {
                      setDrag(null);
                      setDragOverVoiceChannelId(null);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu(null);
                      setCategoryMenu(null);
                      setVoiceMemberMenu({ channel, member, x: e.clientX, y: e.clientY });
                    }}
                    title={member.username}
                  >
                    <div className={`w-5 h-5 rounded-full shrink-0 ${getSidebarVoiceRingClass(member, voiceSpeaking[member.id])}`}>
                      <div className="w-5 h-5 rounded-full overflow-hidden avatar-bg">
                        <AvatarImage
                          src={resolveAvatarUrl(member.avatar, serverUrl, member.accountType)}
                          alt={member.username}
                          size={20}
                          className="w-5 h-5 rounded-full object-cover shrink-0"
                          fallback={<span>{member.username.charAt(0).toUpperCase()}</span>}
                        />
                      </div>
                    </div>
                    <ReactiveAvatarBadge identity={member.id} name={member.username} />
                    <span className="truncate">{member.username}</span>
                    {isLive && (
                      <span
                        className="rounded-full bg-pink-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-pink-200"
                        title={`${member.username} is live`}
                      >
                        Live
                      </span>
                    )}
                    {member.muted && <MicrophoneMutedIcon className="ml-auto h-3 w-3 text-danger" />}
                    {member.deafened && <AudioDeafenedIcon className="h-3 w-3 text-warning" />}
                  </button>
                  );
                })}
              </div>
            )}
            {channel.type === 'theater' && arrayFromRecord(theaterRoomUsersByChannel, channel.id).length > 0 && (
              <div className="pl-7 pr-2 py-1.5 space-y-1.5">
                {arrayFromRecord(theaterRoomUsersByChannel, channel.id).map((member) => (
                  <button
                    key={`theater:${channel.id}:${member.id}`}
                    type="button"
                    data-debug-name={`Sidebar Theater Member: ${member.username}`}
                    data-debug-file="src/components/layout/Sidebar.tsx"
                    className="w-full flex items-center gap-2 text-sm text-text-muted hover:text-text-primary hover:bg-bg-hover/30 rounded px-1 py-1 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      openModal('profileView', { userId: member.id });
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu(null);
                      setCategoryMenu(null);
                      setVoiceMemberMenu(null);
                      setTheaterMemberMenu({ channelId: channel.id, member, x: e.clientX, y: e.clientY });
                    }}
                    title={member.username}
                  >
                    <div className={`w-5 h-5 rounded-full shrink-0 ${getSidebarTheaterRingClass(member, theaterSpeaking[member.id])}`}>
                      <div className="w-5 h-5 rounded-full shrink-0 overflow-hidden avatar-bg">
                      <AvatarImage
                        src={resolveAvatarUrl(member.avatar, member.accountType === 'central' ? null : serverUrl, member.accountType)}
                        alt={member.username}
                        size={20}
                        className="w-5 h-5 rounded-full object-cover shrink-0"
                        fallback={<span>{member.username.charAt(0).toUpperCase()}</span>}
                      />
                      </div>
                    </div>
                    <span className="truncate">
                      {theaterHostUserIdByChannel[channel.id] === member.id && <MicrophoneLiveIcon className="mr-1 inline h-3 w-3" />}
                      {member.username}
                    </span>
                    <span className="ml-auto inline-flex items-center gap-1">
                      <TheaterPresenceBadge user={member} />
                      {!member.micEnabled && !isTheaterVoiceDisconnected(member) && <MicrophoneMutedIcon className="h-3 w-3 text-danger" />}
                    </span>
                    {member.deafened && <AudioDeafenedIcon className={`h-3 w-3 text-warning ${!member.micEnabled ? '' : 'ml-auto'}`} />}
                  </button>
                ))}
              </div>
            )}
            {channel.type !== 'forum' && !threadCollapse[channel.id] && arrayFromRecord(threadsByChannel, channel.id).map((thread) => (
              <button
                key={thread.id}
                onClick={() => setActiveThread(thread)}
                className="w-full text-left px-6 py-1 text-xs text-text-muted hover:text-text-primary hover:bg-bg-hover/40 transition-colors"
              >
                ↳ {thread.name}
              </button>
            ))}
          </div>
        ))}
        {dragOverTarget && dragOverTarget.categoryKey === categoryKey && dragOverTarget.index === catChannels.length && (
          <div className="drop-line" />
        )}
      </div>
    );
  }
}

function getSidebarVoiceRingClass(
  user: { muted: boolean; deafened: boolean },
  speaking?: boolean,
) {
  if (user.deafened) return 'ring-2 ring-warning/80';
  if (user.muted) return 'ring-2 ring-danger/80';
  if (speaking) return 'ring-2 ring-success/90';
  return 'ring-2 ring-transparent';
}

function getSidebarTheaterRingClass(
  user: { muted: boolean; deafened: boolean; micEnabled: boolean; voiceConnected?: boolean },
  speaking?: boolean,
) {
  if (isTheaterVoiceDisconnected(user)) return 'ring-2 ring-orange-400/80';
  if (user.deafened) return 'ring-2 ring-warning/80';
  if (user.muted || !user.micEnabled) return 'ring-2 ring-danger/80';
  if (speaking) return 'ring-2 ring-success/90';
  return 'ring-2 ring-transparent';
}

function formatVoiceElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
