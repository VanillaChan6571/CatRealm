import { AudioDeafenedIcon, MicrophoneMutedIcon } from '../voice/VoiceStateIcons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheaterStore } from '../../stores/theaterStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useAuthStore } from '../../stores/authStore';
import { useServerStore } from '../../stores/serverStore';
import { useChannelStore } from '../../stores/channelStore';
import { useUIStore } from '../../stores/uiStore';
import { useMediaStore } from '../../stores/mediaStore';
import { PERMISSIONS, hasPermission, hasChannelPermission } from '../../utils/permissions';
import { resolveAvatarUrl } from '../../utils/avatar';
import { resolveDisplayName } from '../../utils/displayName';
import { writeClipboardText } from '../../lib/clipboard';
import { setTheaterVideoSlot } from './TheaterVideoManager';
import { TheaterQueue } from './TheaterQueue';
import { TheaterPresenceBadge } from './TheaterPresenceBadge';
import { isTheaterVoiceDisconnected } from '../../lib/theaterPresence';
import { MessageList } from '../chat/MessageList';
import { MessageInput } from '../chat/MessageInput';
import { TypingIndicator } from '../chat/TypingIndicator';
import type { Channel, TheaterSettings, TheaterUser } from '../../types';
import { Clapperboard, Mic, SkipForward, Users } from 'lucide-react';
import { AudioTracksButton } from '../voice/AudioTracksButton';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAudioTapStore, isUserTappedIn, AUDIO_TAP_GLOW_CLASS } from '../../stores/audioTapStore';

function AvatarImg({ avatar, serverUrl, accountType, className }: {
  avatar: string | null;
  serverUrl: string | null | undefined;
  accountType?: 'local' | 'central';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const resolvedBase = accountType === 'central' ? null : (serverUrl ?? null);
  const src = !failed ? (resolveAvatarUrl(avatar, resolvedBase, accountType) ?? undefined) : undefined;
  if (!src || failed) return <span className="text-2xl">🐱</span>;
  return <img src={src} onError={() => setFailed(true)} alt="" className={className} />;
}

interface TheaterChannelProps {
  channel: Channel;
}

// Audio bridges and voice activity detection have been moved to TheaterAudioManager
// which is mounted persistently in AppLayout so they survive channel navigation.

function getTheaterRingClass(
  user: { muted: boolean; deafened: boolean; micEnabled?: boolean; voiceConnected?: boolean },
  speaking?: boolean,
  forceMuted?: boolean,
  forceDeafened?: boolean,
) {
  if (isTheaterVoiceDisconnected(user)) return 'border-orange-400 ring-4 ring-orange-400/70';
  const muted = forceMuted ?? (user.muted || user.micEnabled === false || user.deafened);
  const deafened = forceDeafened ?? user.deafened;
  if (deafened) return 'border-warning ring-4 ring-warning/70';
  if (muted) return 'border-danger ring-4 ring-danger/70';
  if (speaking) return 'border-success ring-4 ring-success/80';
  return 'border-border ring-4 ring-transparent';
}

function TheaterChatPanel() {
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-bg-secondary/60"
      data-debug-name="Theater Chat Panel"
      data-debug-file="src/components/theater/TheaterChannel.tsx"
    >
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-text-primary">Theater Chat</h3>
        <p className="mt-0.5 text-[11px] text-text-muted">Silent by default. Unread stays badge-only here.</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <MessageList />
        <TypingIndicator />
        <MessageInput threadId={null} allowText forceMediaButton />
      </div>
    </div>
  );
}

export function TheaterChannel({ channel }: TheaterChannelProps) {
  const user = useAuthStore((s) => s.user);
  const authServerUrl = useAuthStore((s) => s.serverUrl);
  const activeServerUrl = useServerStore((s) => s.activeServerUrl);
  const serverUrl = user?.accountType === 'central' ? activeServerUrl : authServerUrl;

  const [settings, setSettings] = useState<TheaterSettings | null>(null);
  const [sidePanelTab, setSidePanelTab] = useState<'queue' | 'chat'>('queue');
  const [reactionPanelOpen, setReactionPanelOpen] = useState(false);
  const joinedRef = useRef(false);
  const videoSlotRef = useCallback((el: HTMLDivElement | null) => {
    setTheaterVideoSlot(el);
  }, []);

  const activeChannelId = useTheaterStore((s) => s.activeChannelId);
  const theaterSidePanelRetracted = useUIStore((s) => s.theaterSidePanelRetracted);
  const setTheaterSidePanelRetracted = useUIStore((s) => s.setTheaterSidePanelRetracted);
  const openModal = useUIStore((s) => s.openModal);
  const hasJoined = activeChannelId === channel.id;

  useEffect(() => {
    joinedRef.current = hasJoined;
  }, [hasJoined]);

  const users = useTheaterStore((s) => s.users);
  const state = useTheaterStore((s) => s.state);
  const queue = useTheaterStore((s) => s.queue);
  const remoteTracks = useMediaStore((s) => s.remoteTracks);
  const localCameraStream = useMediaStore((s) => s.localCameraStream);
  const cameraEnabled = useTheaterStore((s) => s.cameraEnabled);
  const micEnabled = useTheaterStore((s) => s.micEnabled);
  const selfDeafened = useTheaterStore((s) => s.selfDeafened);
  const speakingByUser = useTheaterStore((s) => s.speakingByUser);
  const catLabAudioTracks = useSettingsStore((s) => s.catLabAudioTracks);
  const audioTapTracks = useAudioTapStore((s) => s.tracks);
  const isUserTapped = (userId: string) => catLabAudioTracks && isUserTappedIn(audioTapTracks, userId);
  const hostUserId = useTheaterStore((s) => s.hostUserId);
  const selfUserId = useTheaterStore((s) => s.selfUserId);
  const channelPrefs = useChannelStore((s) => s.prefsByChannel[channel.id]);
  const chatUnreadCount = useChannelStore((s) => s.unreadByChannel[channel.id] ?? 0);
  const joinTheater = useTheaterStore((s) => s.joinTheater);
  const sendReaction = useTheaterStore((s) => s.sendReaction);
  const grantHost = useTheaterStore((s) => s.grantHost);
  const kickUser = useTheaterStore((s) => s.kickUser);
  const skipCurrent = useTheaterStore((s) => s.skipCurrent);
  const peerVolumeByUser = useVoiceStore((s) => s.peerVolumeByUser);
  const setPeerVolume = useVoiceStore((s) => s.setPeerVolume);

  const [tileMenu, setTileMenu] = useState<{ userId: string; username: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!tileMenu) return;
    const close = () => setTileMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [tileMenu]);

  const channelPerms = channel.effective_permissions ?? 0;
  const canManage = hasPermission(user?.permissions, PERMISSIONS.MANAGE_CHANNELS);
  const canPlayInTheater = hasChannelPermission(user?.permissions, channelPerms, PERMISSIONS.PLAY_IN_THEATER);
  const canControl = canManage || canPlayInTheater || hostUserId === selfUserId;
  const chatBadgeVisible = !channelPrefs?.muted && chatUnreadCount > 0;
  const sidePanelVisible = !theaterSidePanelRetracted;
  const [sidePanelContentMounted, setSidePanelContentMounted] = useState(sidePanelVisible);
  const currentItem = state?.current_item_id
    ? (queue.find((item) => item.id === state.current_item_id) ?? null)
    : null;
  const currentTitle = currentItem?.title ?? (state?.videoUrl ? 'Playing video' : 'Nothing playing');

  useEffect(() => {
    if (sidePanelVisible) {
      setSidePanelContentMounted(true);
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setSidePanelContentMounted(false);
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [sidePanelVisible]);

  useEffect(() => {
    setSidePanelTab('queue');
  }, [channel.id]);

  useEffect(() => {
    async function fetchSettings() {
      try {
        const { createApi } = await import('../../lib/api');
        const url = serverUrl;
        if (!url) return;
        const api = createApi(url);
        const resp = await api.get<TheaterSettings>(`/api/theater/${channel.id}/settings`);
        setSettings(resp.data);
      } catch { /* ignore */ }
    }
    fetchSettings();
  }, [channel.id, serverUrl]);

  function handleJoin() {
    if (joinedRef.current) return;
    joinTheater(channel.id, channel.name);
  }

  const visibleParticipants: TheaterUser[] = users.length > 0
    ? users
    : (selfUserId && user
      ? [{
          id: selfUserId,
          username: user.username,
          avatar: user.avatar ?? null,
          accountType: user.accountType,
          roleColor: null,
          cameraEnabled,
          micEnabled,
          deafened: selfDeafened,
          muted: !micEnabled || selfDeafened,
        }]
      : []);

  const REACTION_EMOJIS = ['❤️', '😂', '😮', '👏', '🔥', '💀', '🎉', '😍', '👍', '🐱'];

  if (!hasJoined) {
    return (
      <div
        className="flex flex-col h-full bg-bg-chat text-text-primary"
        data-debug-name={`Theater Channel: ${channel.name}`}
        data-debug-file="src/components/theater/TheaterChannel.tsx"
      >
        <div
          className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-bg-secondary/60 shrink-0"
          data-debug-name="Theater Header"
          data-debug-file="src/components/theater/TheaterChannel.tsx"
        >
          <Clapperboard className="h-5 w-5 text-text-muted" />
          <h2 className="font-semibold text-sm text-text-primary flex-1">{channel.name}</h2>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-5 text-center px-6 max-w-sm">
            <Clapperboard className="h-16 w-16 text-text-muted" />
            <div>
              <h3 className="text-lg font-semibold text-text-primary">{channel.name}</h3>
              <p className="text-sm text-text-muted mt-1">Synchronized video watching with other members</p>
            </div>
            <button
              onClick={handleJoin}
              className="px-6 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent/90 transition-colors shadow-lg"
            >
              Join Theater
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full bg-bg-chat text-text-primary"
      data-debug-name={`Theater Channel: ${channel.name}`}
      data-debug-file="src/components/theater/TheaterChannel.tsx"
    >

      <div
        className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-bg-secondary/60 shrink-0"
        data-debug-name="Theater Header"
        data-debug-file="src/components/theater/TheaterChannel.tsx"
      >
        <Clapperboard className="h-5 w-5 text-text-muted" />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
          <h2 className="max-w-[180px] truncate font-semibold text-text-primary">{channel.name}</h2>
          <span className="shrink-0 text-text-muted">-</span>
          <span className="min-w-0 max-w-[min(32rem,45vw)] truncate text-text-secondary" title={currentTitle}>
            {currentTitle}
          </span>
          <span className="shrink-0 text-text-muted">-</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-text-muted">
            <Users className="h-3.5 w-3.5" />
            {visibleParticipants.length}
          </span>
        </div>
        <div className="h-5 w-px shrink-0 bg-border" />
        <AudioTracksButton className="rounded-full !w-8 !h-8 shrink-0" />
        {canControl && state?.current_item_id && (
          <button
            data-debug-name="Theater Header: Skip"
            data-debug-file="src/components/theater/TheaterChannel.tsx"
            onClick={() => { void skipCurrent(channel.id); }}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-bg-hover px-3 text-xs font-semibold text-text-primary transition-colors hover:bg-bg-input"
            title="Skip"
            aria-label="Skip current theater item"
          >
            <SkipForward className="h-3.5 w-3.5" />
            Skip
          </button>
        )}
        <button
          data-debug-name="Theater Header: Panel Toggle"
          data-debug-file="src/components/theater/TheaterChannel.tsx"
          onClick={() => setTheaterSidePanelRetracted(!theaterSidePanelRetracted)}
          className="relative h-8 shrink-0 rounded-full bg-bg-hover px-3 text-xs font-semibold text-text-primary transition-colors hover:bg-bg-input"
          title={theaterSidePanelRetracted ? 'Show Theater Side Panel' : 'Hide Theater Side Panel'}
          aria-label={theaterSidePanelRetracted ? 'Show Theater side panel' : 'Hide Theater side panel'}
        >
          {theaterSidePanelRetracted ? 'Show Panel' : 'Hide Panel'}
          {theaterSidePanelRetracted && chatBadgeVisible && (
            <span className="absolute -right-3 -top-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-white px-1 text-[10px] font-semibold leading-4 text-black">
              {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
            </span>
          )}
        </button>
      </div>

      <div className="flex flex-1 min-h-0 gap-0">
        <div
          className="flex flex-col flex-1 min-w-0 p-3 gap-3"
          data-debug-name="Theater Main Panel"
          data-debug-file="src/components/theater/TheaterChannel.tsx"
        >
          {/* Slot placeholder — TheaterVideoManager overlays SyncedVideoPlayer here via position:fixed */}
          <div
            ref={videoSlotRef}
            className="relative w-full shrink-0 bg-black rounded-xl overflow-hidden"
            style={{ aspectRatio: '16/9' }}
          />

          {visibleParticipants.length > 0 && (
            <div
              className="flex shrink-0 gap-3 overflow-x-auto pb-2 pt-1"
              data-debug-name="Theater Participant Strip"
              data-debug-file="src/components/theater/TheaterChannel.tsx"
            >
              {visibleParticipants.map((participant) => {
                const isSelf = participant.id === selfUserId;
                const remoteCameraStream = Object.values(remoteTracks).find((track) => (
                  track.participantId === participant.id
                  && track.source === 'camera'
                  && track.kind === 'video'
                ))?.mediaStream ?? null;
                const participantMuted = isSelf
                  ? (!micEnabled || selfDeafened)
                  : (!participant.micEnabled || participant.muted || participant.deafened);
                const participantDeafened = isSelf ? selfDeafened : participant.deafened;
                const participantLabel = isSelf
                  ? resolveDisplayName(user?.id ?? participant.id, user?.username ?? participant.username, user?.displayName ?? null)
                  : resolveDisplayName(participant.id, participant.username, null);

                return (
                  <div
                    key={participant.id}
                    onContextMenu={(e) => {
                      if (isSelf && !canManage) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const menuX = Math.max(8, Math.min(e.clientX, window.innerWidth - 260));
                      const menuY = Math.max(8, Math.min(e.clientY, window.innerHeight - 260));
                      setTileMenu({ userId: participant.id, username: participant.username, x: menuX, y: menuY });
                    }}
                    className={`relative shrink-0 h-28 w-44 overflow-hidden rounded-2xl border-2 bg-bg-hover md:h-32 md:w-48 ${(() => {
                      const ring = getTheaterRingClass(
                        participant,
                        speakingByUser[participant.id],
                        participantMuted,
                        participantDeafened,
                      );
                      if (!isUserTapped(participant.id)) return ring;
                      // Tap glow replaces only the neutral ring; state rings keep
                      // precedence with the glow shadow layered on top.
                      return ring.startsWith('border-border')
                        ? AUDIO_TAP_GLOW_CLASS
                        : `${ring} shadow-[0_0_14px_rgba(168,85,247,0.55)]`;
                    })()}`}
                    title={!isSelf ? 'Right-click for options' : undefined}
                  >
                    {isSelf && localCameraStream ? (
                      <video
                        ref={(el) => { if (el) el.srcObject = localCameraStream; }}
                        autoPlay
                        muted
                        playsInline
                        className="w-full h-full object-cover"
                      />
                    ) : remoteCameraStream && participant.cameraEnabled ? (
                      <video
                        ref={(el) => { if (el) el.srcObject = remoteCameraStream; }}
                        autoPlay
                        playsInline
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-3xl">
                        <AvatarImg
                          avatar={isSelf ? (user?.avatar ?? null) : participant.avatar}
                          serverUrl={serverUrl}
                          accountType={isSelf ? (user?.accountType as 'local' | 'central' | undefined) : participant.accountType}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <p className="absolute bottom-1.5 left-1.5 right-1.5 truncate rounded bg-black/45 px-2 py-1 text-xs font-medium text-white">
                      {participant.id === hostUserId && <Mic className="mr-1 inline h-3 w-3" />}
                      {participantLabel}
                    </p>
                    {(participant.clientType === 'mobile' || isTheaterVoiceDisconnected(participant)) && <span className="absolute top-1 left-1 rounded bg-black/60 px-1 text-white">
                      <TheaterPresenceBadge user={participant} />
                    </span>}
                    {participantMuted && !isTheaterVoiceDisconnected(participant) && (
                      <span className="absolute top-1 right-1 bg-danger rounded-full w-4 h-4 flex items-center justify-center text-white">
                        <MicrophoneMutedIcon className="w-2.5 h-2.5" />
                      </span>
                    )}
                    {participantDeafened && (
                      <span className="absolute top-6 right-1 bg-warning rounded-full w-4 h-4 flex items-center justify-center text-black">
                        <AudioDeafenedIcon className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tileMenu && createPortal(
            <div
              className="fixed z-[9999] w-60 rounded-xl border border-border bg-bg-elevated shadow-2xl overflow-hidden text-sm"
              style={{ left: tileMenu.x, top: tileMenu.y }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-2 border-b border-border">
                <div className="text-xs text-text-muted">Theater Member</div>
                <div className="text-text-primary font-medium truncate">{tileMenu.username}</div>
              </div>
              {tileMenu.userId !== selfUserId && (
                <div className="px-3 py-2 border-b border-border">
                  <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                    <span>User Volume</span>
                    <span>{peerVolumeByUser[tileMenu.userId] ?? 50}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={300}
                    step={5}
                    value={peerVolumeByUser[tileMenu.userId] ?? 50}
                    onChange={(e) => setPeerVolume(tileMenu.userId, Number(e.target.value) || 0)}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="w-full accent-emerald-400"
                    aria-label={`Volume for ${tileMenu.username}`}
                  />
                </div>
              )}
              <button
                className="w-full text-left px-3 py-2 text-text-secondary hover:bg-bg-hover transition-colors"
                onClick={() => { openModal('profileView', { userId: tileMenu.userId }); setTileMenu(null); }}
              >
                View Profile
              </button>
              <button
                className="w-full text-left px-3 py-2 text-text-secondary hover:bg-bg-hover transition-colors"
                onClick={() => { void writeClipboardText(tileMenu.userId); setTileMenu(null); }}
              >
                Copy User ID
              </button>
              <button
                className="w-full text-left px-3 py-2 text-text-secondary hover:bg-bg-hover transition-colors"
                onClick={() => { void writeClipboardText(tileMenu.username); setTileMenu(null); }}
              >
                Copy Username
              </button>
              {canManage && (
                <>
                  <div className="border-t border-border" />
                  {tileMenu.userId !== hostUserId && (
                    <button
                      className="w-full text-left px-3 py-2 text-text-secondary hover:bg-bg-hover transition-colors"
                      onClick={() => { grantHost(channel.id, tileMenu.userId); setTileMenu(null); }}
                    >
                      Grant Host
                    </button>
                  )}
                  {tileMenu.userId !== selfUserId && (
                    <button
                      className="w-full text-left px-3 py-2 text-danger hover:bg-bg-hover transition-colors"
                      onClick={() => { kickUser(channel.id, tileMenu.userId); setTileMenu(null); }}
                    >
                      Kick from Theater
                    </button>
                  )}
                </>
              )}
            </div>,
            document.body,
          )}

          <div
            className="mt-auto flex shrink-0 items-center gap-3 pt-1"
            data-debug-name="Theater Controls Row"
            data-debug-file="src/components/theater/TheaterChannel.tsx"
          >
            {settings?.theater_reactions_enabled ? (
              <div className="relative">
                <button
                  onClick={() => setReactionPanelOpen((v) => !v)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-bg-hover text-text-secondary hover:bg-bg-hover/80 transition-colors"
                >
                  😊 React
                </button>
                {reactionPanelOpen && (
                  <div className="absolute bottom-full left-0 mb-1 bg-bg-secondary border border-border rounded-xl p-2 flex gap-1 shadow-lg z-10">
                    {REACTION_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => {
                          sendReaction(channel.id, emoji);
                          setReactionPanelOpen(false);
                        }}
                        className="text-xl hover:scale-125 transition-transform"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div
          className={`shrink-0 overflow-hidden border-l transition-[width,padding,opacity,border-color] duration-200 ease-out ${
            sidePanelVisible
              ? 'w-80 border-border p-3 opacity-100 xl:w-96'
              : 'pointer-events-none w-0 border-transparent p-0 opacity-0 xl:w-0'
          }`}
          aria-hidden={!sidePanelVisible}
          data-debug-name="Theater Side Panel"
          data-debug-file="src/components/theater/TheaterChannel.tsx"
        >
          {sidePanelContentMounted && (
            <div className="h-full min-h-0 w-[calc(20rem-1.5rem)] xl:w-[calc(24rem-1.5rem)]">
            <div
              className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-bg-secondary/40 p-1"
              data-debug-name="Theater Side Tabs"
              data-debug-file="src/components/theater/TheaterChannel.tsx"
            >
              <button
                type="button"
                onClick={() => setSidePanelTab('queue')}
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  sidePanelTab === 'queue'
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                }`}
              >
                Queue
              </button>
              <button
                type="button"
                onClick={() => setSidePanelTab('chat')}
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  sidePanelTab === 'chat'
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                }`}
              >
                Theater Chat
                {chatBadgeVisible && (
                  <span className="ml-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-white px-1 text-[10px] font-semibold leading-4 text-black">
                    {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
                  </span>
                )}
              </button>
            </div>

            <div className="h-[calc(100%-3.25rem)] min-h-0">
              {sidePanelTab === 'queue' ? (
                <TheaterQueue
                  channelId={channel.id}
                  canControl={canControl}
                  selfUserId={selfUserId}
                  settings={settings}
                  currentItemId={state?.current_item_id ?? null}
                />
              ) : (
                <TheaterChatPanel />
              )}
            </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
