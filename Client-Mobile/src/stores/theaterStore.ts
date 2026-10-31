/**
 * Theater store — synchronized watch-party state for React Native.
 * Video sync and queue management via socket.io + HTTP API.
 * LiveKit voice is optional; watching alone never acquires the call audio session.
 */

import { create } from 'zustand';
import { createApi } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from './authStore';
import { useServerStore } from './serverStore';
import { setTheaterSessionActive } from '@/lib/notificationSounds';
import { useBlockedUsersStore } from './blockedUsersStore';
import type { TheaterQueueItem, TheaterPlaybackState } from '@/types';
import { acquireAudioSession, releaseAudioSession } from '@/lib/audioSession';
import { ensureLiveKitGlobals, getLiveKitInitError } from '@/lib/livekit-init';
import { captureAccountSession } from '@/lib/accountSession';
import type { TheaterRealmUser } from '@/lib/theaterPermissions';

// ── LiveKit runtime (lazy require — same pattern as voiceStore) ───────────────
let activeTheaterRoom: any = null;
let disposeTheaterRoom: (() => void) | null = null;
let joinGeneration = 0;
let voiceGeneration = 0;
let voiceCleanup = Promise.resolve();
let theaterLiveKitRuntime: any = null;
function getTheaterLiveKitRuntime() {
  if (theaterLiveKitRuntime) return theaterLiveKitRuntime;
  theaterLiveKitRuntime = require('livekit-client');
  return theaterLiveKitRuntime;
}

function muteBlockedTheaterParticipant(userId: string) {
  if (!activeTheaterRoom) return;
  try {
    const participant = activeTheaterRoom.getParticipantByIdentity?.(userId);
    if (participant) {
      participant.audioTrackPublications?.forEach((pub: any) => {
        applyTheaterTrackAudio(pub.track, userId);
      });
    }
  } catch {
    // ignore
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

function applyTheaterTrackAudio(track: any, userId: string) {
  if (!track || track.kind !== 'audio') return;
  const audible = !useTheaterStore.getState().selfDeafened && !useBlockedUsersStore.getState().isBlocked(userId);
  if (track.mediaStreamTrack) track.mediaStreamTrack.enabled = audible;
  if (audible) track.setVolume?.(1);
}

function refreshTheaterAudio() {
  activeTheaterRoom?.remoteParticipants?.forEach((participant: any) => {
    participant.audioTrackPublications?.forEach((pub: any) => applyTheaterTrackAudio(pub.track, participant.identity));
  });
}

export interface TheaterParticipant {
  userId: string;
  username: string;
  avatar?: string | null;
  accountType: 'local' | 'central';
  clientType?: 'mobile' | 'desktop';
  voiceConnected?: boolean;
  roleColor?: string | null;
  cameraEnabled: boolean;
  micEnabled: boolean;
  deafened: boolean;
}

export type TheaterOverlayMode = 'hidden' | 'expanded' | 'floating';
export type TheaterOverlayFrame = { x: number; y: number; width: number; height: number };

export interface RawTheaterUser {
  id: string;
  username: string;
  avatar?: string | null;
  accountType?: 'local' | 'central';
  clientType?: 'mobile' | 'desktop';
  voiceConnected?: boolean;
  roleColor?: string | null;
  cameraEnabled?: boolean;
  micEnabled?: boolean;
  deafened?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const EMPTY_PARTICIPANTS: TheaterParticipant[] = [];
const EMPTY_QUEUE: TheaterQueueItem[] = [];
const EMPTY_ROOM_USERS: Record<string, TheaterParticipant[]> = {};
let joinInFlightChannelId: string | null = null;
/** Stops re-announcing the current theater when its realm socket reconnects. */
let detachTheaterPresence: (() => void) | null = null;

function rawToParticipant(u: RawTheaterUser): TheaterParticipant {
  return {
    userId: u.id,
    username: u.username,
    avatar: u.avatar ?? null,
    accountType: u.accountType ?? 'local',
    clientType: u.clientType,
    voiceConnected: u.voiceConnected,
    roleColor: u.roleColor ?? null,
    cameraEnabled: u.cameraEnabled ?? false,
    micEnabled: u.micEnabled ?? false,
    deafened: u.deafened ?? false,
  };
}

function getCurrentServerUrl(serverId?: string | null): string | null {
  const auth = useAuthStore.getState();
  if (auth.user?.accountType === 'central') {
    const ss = useServerStore.getState();
    const id = serverId ?? useTheaterStore.getState().serverId ?? ss.activeServerId;
    return id ? (ss.byId(id)?.url ?? null) : null;
  }
  return auth.serverUrl ?? null;
}

// ── Store interface ───────────────────────────────────────────────────────────

interface TheaterState {
  channelId: string | null;
  serverId: string | null;
  channelName: string | null;
  participants: TheaterParticipant[];
  queue: TheaterQueueItem[];
  playbackState: TheaterPlaybackState | null;
  hostUserId: string | null;
  selfTheaterUserId: string | null;
  realmUser: TheaterRealmUser | null;
  controlError: string | null;
  mySkipVote: boolean;
  overlayMode: TheaterOverlayMode;
  expandedFrame: TheaterOverlayFrame | null;
  focused: boolean;
  panelTab: 'queue' | 'chat' | 'participants';
  setPanelTab: (tab: 'queue' | 'chat' | 'participants') => void;
  focusControlsVisible: boolean;
  selfMicEnabled: boolean;
  selfDeafened: boolean;
  voiceStatus: 'disconnected' | 'connecting' | 'connected' | 'disconnecting';
  mediaAudioUpdating: boolean;
  mediaError: string | null;
  mediaVolume: number;
  mediaMuted: boolean;
  setMediaVolume: (volume: number) => void;
  setMediaMuted: (muted: boolean) => void;
  // Per-channel room users for sidebar (populated by theater:room-users)
  roomUsersByChannel: Record<string, TheaterParticipant[]>;
  roomStartedAtByChannel: Record<string, number | null>;

  // Actions
  joinTheater: (args: { serverId: string; channelId: string; channelName?: string }) => Promise<void>;
  leaveTheater: () => void;
  /** Re-announce the theater after its realm socket reconnects; the server drops it after a short grace. */
  restorePresence: () => void;
  joinVoice: () => Promise<void>;
  leaveVoice: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
  setOverlayMode: (mode: TheaterOverlayMode) => void;
  setExpandedFrame: (frame: TheaterOverlayFrame | null) => void;
  setFocused: (focused: boolean) => void;
  setFocusControlsVisible: (visible: boolean) => void;
  fetchQueue: (channelId: string) => Promise<void>;
  addToQueue: (channelId: string, url: string) => Promise<void>;
  removeFromQueue: (channelId: string, itemId: string) => Promise<void>;
  control: (channelId: string, patch: {
    playing?: boolean;
    positionMs?: number;
    currentItemId?: string | null;
    durationMs?: number;
  }) => void;
  castSkipVote: (channelId: string) => Promise<void>;
  voteQueue: (channelId: string, itemId: string, upvote: boolean) => Promise<void>;
  grantHost: (channelId: string, userId: string) => void;
  sendReaction: (channelId: string, emoji: string) => void;
  computeExpectedPositionMs: () => number;

  // Socket event handlers (wired in useSocket)
  handleTheaterUsers: (payload: { channelId: string; users: RawTheaterUser[]; you: string; startedAt?: number | null }) => void;
  handleUserJoined: (payload: { channelId: string; user: RawTheaterUser }) => void;
  handleUserLeft: (payload: { channelId: string; userId: string }) => void;
  handleSync: (payload: Partial<TheaterPlaybackState> & { channelId: string; updatedAt?: number; videoUrl?: string | null }) => void;
  handleQueueUpdated: (payload: { channelId: string }) => void;
  handleHostChanged: (payload: { channelId: string; hostUserId: string }) => void;
  handleRoomUsers: (payload: { channelId: string; users: RawTheaterUser[]; startedAt?: number | null }) => void;
  handleRoomsSnapshot: (payload: { rooms: Array<{ channelId: string; users: RawTheaterUser[]; startedAt: number | null }> }) => void;
  handleUserState: (payload: { channelId: string; userId: string; cameraEnabled?: boolean; micEnabled?: boolean; deafened?: boolean; voiceConnected?: boolean }) => void;
}

// ── Implementation ─────────────────────────────────────────────────────────

export const useTheaterStore = create<TheaterState>((set, get) => ({
  channelId: null,
  serverId: null,
  channelName: null,
  participants: EMPTY_PARTICIPANTS,
  queue: EMPTY_QUEUE,
  playbackState: null,
  hostUserId: null,
  selfTheaterUserId: null,
  realmUser: null,
  controlError: null,
  mySkipVote: false,
  overlayMode: 'hidden',
  expandedFrame: null,
  focused: false,
  panelTab: 'queue',
  setPanelTab: (panelTab) => set({ panelTab }),
  focusControlsVisible: true,
  selfMicEnabled: false,
  selfDeafened: false,
  voiceStatus: 'disconnected',
  mediaAudioUpdating: false,
  mediaError: null,
  mediaVolume: 1,
  mediaMuted: false,
  setMediaVolume: (volume) => set({ mediaVolume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1 }),
  setMediaMuted: (mediaMuted) => set({ mediaMuted }),
  roomUsersByChannel: EMPTY_ROOM_USERS,
  roomStartedAtByChannel: {},

  computeExpectedPositionMs: () => {
    const { playbackState } = get();
    if (!playbackState) return 0;
    const durationMs = playbackState.duration_ms && playbackState.duration_ms > 0 ? playbackState.duration_ms : null;
    if (!playbackState.playing) {
      return durationMs !== null ? Math.min(playbackState.position_ms, durationMs) : playbackState.position_ms;
    }
    const elapsed = Math.max(0, Date.now() - playbackState.updated_at);
    const expected = Math.max(0, playbackState.position_ms + elapsed);
    return durationMs !== null ? Math.min(expected, durationMs) : expected;
  },

  restorePresence: () => {
    const { channelId, serverId, voiceStatus, selfMicEnabled, selfDeafened } = get();
    const serverUrl = getCurrentServerUrl(serverId);
    if (!channelId || !serverId || joinInFlightChannelId || !serverUrl) return;
    const socket = getSocket(serverUrl);
    if (!socket) return;
    const generation = joinGeneration;
    const session = captureAccountSession();
    const voiceConnected = voiceStatus === 'connected';
    socket.emit('theater:join', { channelId, voiceConnected }, (ack: {
      ok: boolean;
      users?: RawTheaterUser[];
      queue?: TheaterQueueItem[];
      state?: TheaterPlaybackState | null;
      you?: string;
    }) => {
      if (generation !== joinGeneration || !session.isCurrent() || get().channelId !== channelId) return;
      if (!ack?.ok) { get().leaveTheater(); return; }
      // Refresh room state only: the player, overlay and voice call carry on.
      set({
        participants: (ack.users ?? []).map(rawToParticipant),
        queue: ack.queue ?? EMPTY_QUEUE,
        playbackState: ack.state ? { ...ack.state, playing: !!ack.state.playing, updated_at: Date.now() } : null,
        hostUserId: ack.state?.host_user_id ?? null,
        selfTheaterUserId: ack.you ?? get().selfTheaterUserId,
      });
      // The server rejoins everyone muted; restore what this client is publishing.
      if (voiceConnected && selfMicEnabled) socket.emit('theater:mic-state', { channelId, micEnabled: true });
      if (voiceConnected && selfDeafened) socket.emit('theater:deafen-state', { channelId, deafened: true });
    });
  },

  joinTheater: async ({ serverId, channelId, channelName }) => {
    if (joinInFlightChannelId === channelId) return;

    const serverUrl = getCurrentServerUrl(serverId);
    if (!serverUrl) return;

    const current = get();
    if (current.channelId === channelId) return;
    if (current.channelId && current.channelId !== channelId) {
      get().leaveTheater();
    }

    const socket = getSocket(serverUrl);
    if (!socket) return;
    joinInFlightChannelId = channelId;
    const generation = ++joinGeneration;
    const session = captureAccountSession();
    const isCurrent = () => generation === joinGeneration && session.isCurrent();

    socket.emit('theater:join', { channelId, voiceConnected: false }, (ack: {
      ok: boolean;
      users?: RawTheaterUser[];
      queue?: TheaterQueueItem[];
      state?: TheaterPlaybackState | null;
      you?: string;
      startedAt?: number | null;
      error?: string;
    }) => {
      if (!isCurrent()) return;
      joinInFlightChannelId = null;
      if (!ack?.ok) {
        setTheaterSessionActive(false);
        set({
          channelId: null,
          serverId: null,
          channelName: null,
          participants: EMPTY_PARTICIPANTS,
          queue: EMPTY_QUEUE,
          playbackState: null,
          hostUserId: null,
          selfTheaterUserId: null,
          realmUser: null,
          controlError: null,
          mySkipVote: false,
          overlayMode: 'hidden',
          expandedFrame: null,
          focused: false,
          focusControlsVisible: true,
          selfMicEnabled: false,
          selfDeafened: false,
          voiceStatus: 'disconnected',
          mediaAudioUpdating: false,
          mediaError: null,
        });
        return;
      }
      const hostFromState = ack.state?.host_user_id ?? null;
      // A suspended app outlives the server's disconnect grace and is dropped
      // from the room while the player keeps running — a ghost. Rejoin on reconnect.
      detachTheaterPresence?.();
      const onReconnect = () => useTheaterStore.getState().restorePresence();
      socket.on('connect', onReconnect);
      detachTheaterPresence = () => socket.off('connect', onReconnect);
      setTheaterSessionActive(true);
      set({
        channelId,
        serverId,
        channelName: channelName ?? null,
        participants: (ack.users ?? []).map(rawToParticipant),
        queue: ack.queue ?? EMPTY_QUEUE,
        playbackState: ack.state ? { ...ack.state, playing: !!ack.state.playing, updated_at: Date.now() } : null,
        hostUserId: hostFromState,
        selfTheaterUserId: ack.you ?? null,
        realmUser: null,
        controlError: null,
        // The server always joins theater muted. Never publish until an
        // explicit successful unmute, including after leaving another room.
        selfMicEnabled: false,
        selfDeafened: false,
        voiceStatus: 'disconnected',
        mediaError: null,
        mediaAudioUpdating: false,
        // Joining may finish after navigating away. Keep the player reachable;
        // a focused theater screen will expand it when it owns the layout.
        overlayMode: 'floating',
        expandedFrame: null,
        focused: false,
        focusControlsVisible: true,
      });

      // Permission lookup belongs to watching, not the optional voice call.
      const api = createApi(serverUrl, session.user?.accountType === 'central'
        ? useServerStore.getState().byId(serverId)?.token : session.token ?? undefined);
      // Central's account role is not a realm role. Resolve realm permissions
      // with this room's token and reject responses from a previous session.
      void api.get<{ user: TheaterRealmUser }>('/api/auth/me').then(({ data }) => {
        if (isCurrent() && data.user && (!ack.you || data.user.id === ack.you)) {
          set({ realmUser: data.user });
        }
      }).catch(() => { /* channel permissions and delegated host still work */ });
    });
  },

  joinVoice: async () => {
    const { serverId, channelId, voiceStatus } = get();
    if (!serverId || !channelId || voiceStatus !== 'disconnected') return;
    const serverUrl = getCurrentServerUrl(serverId);
    if (!serverUrl) return;
    const generation = ++voiceGeneration;
    const theaterGeneration = joinGeneration;
    const session = captureAccountSession();
    const isCurrent = () => generation === voiceGeneration && theaterGeneration === joinGeneration && session.isCurrent();
    const socket = getSocket(serverUrl);
    const api = createApi(serverUrl, session.user?.accountType === 'central'
      ? useServerStore.getState().byId(serverId)?.token : session.token ?? undefined);
    let dispose: (() => void) | null = null;
    set({ voiceStatus: 'connecting', mediaError: null, selfMicEnabled: false, selfDeafened: false });
    try {
      // A previous room must release native audio before a new one starts.
      await voiceCleanup;
      if (!isCurrent()) return;
      // 1. Capabilities
      let cap: any = null;
      try {
        const r = await api.get('/api/media/capabilities', { timeout: 5000 });
        cap = (r.data as any)?.capability ?? null;
      } catch { /* ignore */ }
      if (!isCurrent()) return;
      if (!cap?.enabled && socket) {
        cap = await new Promise<any>((res) => {
          socket.emit('media:v1:capabilities', (r: any) => res(r?.capability ?? null));
          setTimeout(() => res(null), 3000);
        });
      }
      const hasTheaterLiveKitPath = !!cap?.enabled || !!cap?.liveKitFallbackContexts?.includes('theater');
      if (!isCurrent()) return;
      if (!hasTheaterLiveKitPath) throw new Error('Voice is unavailable in this theater. You can keep watching.');

      // 2. Token
      let tok: { token: string; url?: string } | null = null;
      try {
        const r = await api.post<{ token: string; url?: string }>(
          '/api/media/token',
          { context: 'theater', channelId },
          { timeout: 5000 },
        );
        tok = r.data ?? null;
      } catch { /* ignore */ }
      if (!isCurrent()) return;
      if (!tok && socket) {
        tok = await new Promise<{ token: string; url?: string } | null>((res) => {
          socket.emit('media:v1:token', { context: 'theater', channelId }, (r: any) => {
            res(r?.ok && r.token ? { token: r.token, url: r.url } : null);
          });
          setTimeout(() => res(null), 3000);
        });
      }
      if (!isCurrent()) return;
      if (!tok?.token) throw new Error('Unable to join theater voice. Please try again.');

      // 3. Connect Room
      if (!ensureLiveKitGlobals()) throw new Error(getLiveKitInitError() ?? 'LiveKit unavailable');
      const { Room, RoomEvent } = getTheaterLiveKitRuntime();
      const room = new Room();
      activeTheaterRoom = room;
      let disposed = false;
      let connection: Promise<unknown> | null = null;
      const audioReady = acquireAudioSession();
      dispose = () => {
        if (disposed) return;
        disposed = true;
        if (activeTheaterRoom === room) activeTheaterRoom = null;
        if (disposeTheaterRoom === dispose) disposeTheaterRoom = null;
        // Restore playback audio only after the call has stopped. Keep this
        // promise independent of UI state so rapid room switches serialize.
        voiceCleanup = (async () => {
          try { await room.disconnect(); }
          finally {
            await connection?.catch(() => {});
            await audioReady;
            await releaseAudioSession();
          }
        })().catch((error) => { console.warn('[Theater] Voice cleanup failed', error); });
      };
      disposeTheaterRoom = dispose;
      room.on(RoomEvent.Disconnected, () => {
        if (!disposed && isCurrent()) {
          void get().leaveVoice();
          set({ mediaError: 'Theater voice disconnected. You can rejoin voice or keep watching.' });
        }
      });
      room.on(RoomEvent.TrackSubscribed, (track: any, _publication: any, participant: any) => {
        if (!disposed && isCurrent()) applyTheaterTrackAudio(track, participant.identity);
      });
      const mediaUrl = tok.url ?? cap.publicUrl;
      if (!mediaUrl) throw new Error('No LiveKit URL received');
      await audioReady;
      if (!isCurrent()) { dispose(); return; }
      connection = Promise.resolve(room.connect(mediaUrl, tok.token)).then(async () => {
        // Some transports finish connecting despite cancellation. Shut that
        // room down before releasing audio or admitting a replacement room.
        if (disposed) await room.disconnect();
      });
      await connection;
      if (!isCurrent() || disposed) { dispose(); return; }
      refreshTheaterAudio();

      // Joining never enables the microphone; toggleMic owns publication.
      if (!isCurrent()) { dispose(); return; }
      set((s) => ({ voiceStatus: 'connected', participants: s.participants.map((p) =>
        p.userId === s.selfTheaterUserId ? { ...p, voiceConnected: true } : p) }));
      socket?.emit('theater:voice-state', { channelId, voiceConnected: true });
    } catch (err) {
      dispose?.();
      if (!isCurrent()) return;
      const cleanup = get().leaveVoice();
      set({ mediaError: err instanceof Error ? err.message : 'Media connect failed' });
      await cleanup;
    }
  },

  leaveVoice: async () => {
    const { channelId, selfMicEnabled, selfDeafened, voiceStatus } = get();
    const generation = ++voiceGeneration;
    const serverUrl = getCurrentServerUrl();
    const socket = serverUrl ? getSocket(serverUrl) : null;
    if (channelId && selfMicEnabled) socket?.emit('theater:mic-state', { channelId, micEnabled: false });
    if (channelId && selfDeafened) socket?.emit('theater:deafen-state', { channelId, deafened: false });
    if (channelId && voiceStatus !== 'disconnected') socket?.emit('theater:voice-state', { channelId, voiceConnected: false });
    disposeTheaterRoom?.();
    disposeTheaterRoom = null;
    set((s) => ({
      voiceStatus: voiceStatus === 'disconnected' ? 'disconnected' : 'disconnecting',
      selfMicEnabled: false, selfDeafened: false, mediaAudioUpdating: false, mediaError: null,
      participants: s.participants.map((p) => p.userId === s.selfTheaterUserId
        ? { ...p, micEnabled: false, deafened: false, voiceConnected: false } : p),
    }));
    await voiceCleanup;
    if (generation === voiceGeneration) set({ voiceStatus: 'disconnected' });
  },

  leaveTheater: () => {
    const { channelId } = get();
    const serverUrl = getCurrentServerUrl();

    ++joinGeneration;
    detachTheaterPresence?.();
    detachTheaterPresence = null;
    const leavingChannelId = channelId ?? joinInFlightChannelId;
    joinInFlightChannelId = null;
    if (serverUrl && leavingChannelId) getSocket(serverUrl)?.emit('theater:leave', { channelId: leavingChannelId });
    void get().leaveVoice();
    setTheaterSessionActive(false);
    set({
      channelId: null,
      serverId: null,
      channelName: null,
      participants: EMPTY_PARTICIPANTS,
      queue: EMPTY_QUEUE,
      playbackState: null,
      hostUserId: null,
      selfTheaterUserId: null,
      realmUser: null,
      controlError: null,
      mySkipVote: false,
      overlayMode: 'hidden',
      panelTab: 'queue',
      expandedFrame: null,
      focused: false,
      focusControlsVisible: true,
      selfMicEnabled: false,
      selfDeafened: false,
      voiceStatus: 'disconnected',
      mediaAudioUpdating: false,
      mediaError: null,
    });
  },

  toggleMic: async () => {
    const { channelId, selfMicEnabled, selfDeafened, voiceStatus, mediaAudioUpdating } = get();
    const room = activeTheaterRoom;
    if (!channelId || voiceStatus !== 'connected' || mediaAudioUpdating) return;
    if (!room) { set({ mediaError: 'Theater voice is not connected.' }); return; }
    const generation = voiceGeneration;
    const next = !selfMicEnabled;
    set({ mediaAudioUpdating: true, mediaError: null });
    try {
      await room.localParticipant.setMicrophoneEnabled(next && !selfDeafened);
      if (generation !== voiceGeneration || activeTheaterRoom !== room) return;
      set((s) => ({ selfMicEnabled: next, participants: s.participants.map((p) =>
        p.userId === s.selfTheaterUserId ? { ...p, micEnabled: next } : p) }));
      const serverUrl = getCurrentServerUrl();
      if (serverUrl) getSocket(serverUrl)?.emit('theater:mic-state', { channelId, micEnabled: next });
    } catch (error) {
      if (generation === voiceGeneration && activeTheaterRoom === room) {
        set({ mediaError: error instanceof Error ? error.message : 'Unable to change microphone.' });
      }
    } finally {
      if (generation === voiceGeneration) set({ mediaAudioUpdating: false });
    }
  },

  toggleDeafen: async () => {
    const { channelId, selfMicEnabled, selfDeafened, voiceStatus, mediaAudioUpdating } = get();
    const room = activeTheaterRoom;
    if (!channelId || voiceStatus !== 'connected' || mediaAudioUpdating) return;
    if (!room) { set({ mediaError: 'Theater voice is not connected.' }); return; }
    const generation = voiceGeneration;
    const next = !selfDeafened;
    set({ mediaAudioUpdating: true, mediaError: null });
    try {
      await room.localParticipant.setMicrophoneEnabled(next ? false : selfMicEnabled);
      if (generation !== voiceGeneration || activeTheaterRoom !== room) return;
      set((s) => ({ selfDeafened: next, participants: s.participants.map((p) =>
        p.userId === s.selfTheaterUserId ? { ...p, deafened: next } : p) }));
      refreshTheaterAudio();
      const serverUrl = getCurrentServerUrl();
      if (serverUrl) getSocket(serverUrl)?.emit('theater:deafen-state', { channelId, deafened: next });
    } catch (error) {
      if (generation === voiceGeneration && activeTheaterRoom === room) {
        set({ mediaError: error instanceof Error ? error.message : 'Unable to change deafen state.' });
      }
    } finally {
      if (generation === voiceGeneration) set({ mediaAudioUpdating: false });
    }
  },

  setOverlayMode: (overlayMode) => {
    if (overlayMode !== 'hidden' && !get().channelId) return;
    set(overlayMode === 'expanded'
      ? { overlayMode }
      : { overlayMode, expandedFrame: null, focused: false, focusControlsVisible: true });
  },

  setExpandedFrame: (expandedFrame) => {
    if (expandedFrame && (get().overlayMode !== 'expanded' || !get().channelId)) return;
    set({ expandedFrame });
  },

  setFocused: (focused) => {
    if (focused && (get().overlayMode !== 'expanded' || !get().channelId)) return;
    if (get().focused === focused) return;
    set({ focused, expandedFrame: null, focusControlsVisible: true });
  },

  setFocusControlsVisible: (focusControlsVisible) => set({ focusControlsVisible }),

  fetchQueue: async (channelId) => {
    try {
      const resp = await createApi().get<{ items: TheaterQueueItem[]; state: TheaterPlaybackState | null; mySkipVote: boolean }>(
        `/api/theater/${channelId}/queue`,
      );
      set({
        queue: resp.data.items ?? EMPTY_QUEUE,
        mySkipVote: resp.data.mySkipVote ?? false,
      });
      if (resp.data.state) {
        set({ playbackState: { ...resp.data.state, updated_at: Date.now() } });
      }
    } catch { /* ignore */ }
  },

  addToQueue: async (channelId, url) => {
    await createApi().post(`/api/theater/${channelId}/queue`, { url });
  },

  removeFromQueue: async (channelId, itemId) => {
    await createApi().delete(`/api/theater/${channelId}/queue/${itemId}`);
  },

  control: (channelId, patch) => {
    if (get().channelId !== channelId) return;
    const generation = joinGeneration;
    const serverUrl = getCurrentServerUrl();
    const socket = serverUrl ? getSocket(serverUrl) : null;
    if (!socket || !socket.connected) { set({ controlError: 'Disconnected from the realm. Reconnect to control playback.' }); return; }
    set({ controlError: null });
    socket.timeout(5000).emit('theater:state', { channelId, ...patch }, (error: Error | null, ack?: { ok: boolean; error?: string }) => {
      if (generation !== joinGeneration) return;
      if (error || !ack?.ok) set({ controlError: ack?.error ?? 'The realm did not confirm the playback change. Try again.' });
    });
  },

  castSkipVote: async (channelId) => {
    await createApi().post(`/api/theater/${channelId}/skip-vote`);
    set({ mySkipVote: true });
  },

  voteQueue: async (channelId, itemId, upvote) => {
    if (upvote) {
      await createApi().post(`/api/theater/${channelId}/queue/${itemId}/vote`);
    } else {
      await createApi().delete(`/api/theater/${channelId}/queue/${itemId}/vote`);
    }
    await get().fetchQueue(channelId);
  },

  grantHost: (channelId, userId) => {
    const serverUrl = getCurrentServerUrl();
    const socket = serverUrl ? getSocket(serverUrl) : null;
    socket?.emit('theater:host:grant', { channelId, userId });
  },

  sendReaction: (channelId, emoji) => {
    const serverUrl = getCurrentServerUrl();
    const socket = serverUrl ? getSocket(serverUrl) : null;
    socket?.emit('theater:reaction', { channelId, emoji });
  },

  handleTheaterUsers: ({ channelId, users, you, startedAt }) => {
    if (get().channelId !== channelId) return;
    set({ participants: users.map(rawToParticipant), selfTheaterUserId: you ?? get().selfTheaterUserId });
    if (startedAt !== undefined) {
      set((s) => ({
        roomStartedAtByChannel: { ...s.roomStartedAtByChannel, [channelId]: startedAt ?? null },
      }));
    }
    users.forEach((u) => muteBlockedTheaterParticipant(u.id));
  },

  handleUserJoined: ({ channelId, user }) => {
    if (get().channelId !== channelId) return;
    set((s) => {
      if (s.participants.some((p) => p.userId === user.id)) return {};
      return { participants: [...s.participants, rawToParticipant(user)] };
    });
    muteBlockedTheaterParticipant(user.id);
  },

  handleUserLeft: ({ channelId, userId }) => {
    if (get().channelId !== channelId) return;
    set((s) => ({ participants: s.participants.filter((p) => p.userId !== userId) }));
  },

  handleSync: (payload: Partial<TheaterPlaybackState> & { channelId: string; updatedAt?: number; videoUrl?: string | null }) => {
    const { channelId, updatedAt, videoUrl } = payload;
    if (get().channelId !== channelId) return;
    // Server sends camelCase; normalize both forms so either works.
    const p = payload as any;
    const positionMs   = p.positionMs   ?? p.position_ms;
    const durationMs   = p.durationMs   ?? p.duration_ms;
    const currentItemId = p.currentItemId ?? p.current_item_id;
    const hostUserId   = p.hostUserId   ?? p.host_user_id;
    const playing      = p.playing;
    set((s) => ({
      hostUserId: hostUserId ?? s.hostUserId,
      playbackState: {
        ...(s.playbackState ?? {}),
        channel_id: channelId,
        position_ms: positionMs    ?? s.playbackState?.position_ms    ?? 0,
        duration_ms: durationMs    ?? s.playbackState?.duration_ms,
        playing:     playing !== undefined ? !!playing : (s.playbackState?.playing ?? false),
        updated_at:  updatedAt     ?? Date.now(),
        current_item_id: currentItemId ?? s.playbackState?.current_item_id ?? null,
        host_user_id:    hostUserId    ?? s.playbackState?.host_user_id    ?? null,
        videoUrl:    videoUrl      ?? s.playbackState?.videoUrl        ?? null,
      } as TheaterPlaybackState,
    }));
  },

  handleQueueUpdated: ({ channelId }) => {
    if (get().channelId !== channelId) return;
    void get().fetchQueue(channelId);
  },

  handleHostChanged: ({ channelId, hostUserId }) => {
    set((s) => ({
      hostUserId: get().channelId === channelId ? hostUserId : s.hostUserId,
      roomUsersByChannel: s.roomUsersByChannel,
    }));
  },

  handleRoomUsers: ({ channelId, users, startedAt }) => {
    set((s) => ({
      roomUsersByChannel: {
        ...s.roomUsersByChannel,
        [channelId]: users.map(rawToParticipant),
      },
      roomStartedAtByChannel: {
        ...s.roomStartedAtByChannel,
        [channelId]: startedAt ?? null,
      },
    }));
  },

  handleRoomsSnapshot: ({ rooms }) => {
    set((s) => {
      const activeChannels = new Set(rooms.map((room) => room.channelId));
      const roomUsersByChannel = Object.fromEntries(
        Object.entries(s.roomUsersByChannel).filter(([channelId]) => activeChannels.has(channelId)),
      );
      const roomStartedAtByChannel = Object.fromEntries(
        Object.entries(s.roomStartedAtByChannel).filter(([channelId]) => activeChannels.has(channelId)),
      );
      for (const room of rooms) {
        roomUsersByChannel[room.channelId] = room.users.map(rawToParticipant);
        roomStartedAtByChannel[room.channelId] = room.startedAt;
      }
      return { roomUsersByChannel, roomStartedAtByChannel };
    });
  },

  handleUserState: ({ channelId, userId, ...stateFields }) => {
    if (get().channelId !== channelId) return;
    set((s) => ({
      participants: s.participants.map((p) =>
        p.userId === userId ? { ...p, ...stateFields } : p,
      ),
    }));
  },
}));

useBlockedUsersStore.subscribe(refreshTheaterAudio);
