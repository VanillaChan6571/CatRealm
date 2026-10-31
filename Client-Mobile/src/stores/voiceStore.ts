/**
 * Voice store — LiveKit-backed voice channel state for React Native.
 * Uses @livekit/react-native for RTC and socket.io for presence signalling.
 *
 * The LiveKit Room instance lives at module level (not in Zustand) to avoid
 * serialisation issues — same pattern as the desktop activeVoicePipeline.
 */

import '@/lib/livekit-init';
import { ensureLiveKitGlobals, getLiveKitInitError } from '@/lib/livekit-init';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { createApi } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from './authStore';
import { useServerStore } from './serverStore';
import { useSettingsStore } from './settingsStore';
import { playNotificationSound, setVoiceSessionActive } from '@/lib/notificationSounds';
import { acquireAudioSession, releaseAudioSession } from '@/lib/audioSession';
import { captureAccountSession } from '@/lib/accountSession';
import { useBlockedUsersStore } from './blockedUsersStore';
import type { AccountType } from '@/types';

// ── Module-level Room (outside Zustand) ────────────────────────────────────
type LiveKitRuntime = {
  Room: new () => any;
  RoomEvent: Record<string, string>;
};

let activeRoom: any | null = null;
/** Stops re-announcing the current call when its realm socket reconnects. */
let detachVoicePresence: (() => void) | null = null;
let releaseVoiceAudio: (() => void) | null = null;
let voiceJoinGeneration = 0;
let liveKitRuntime: LiveKitRuntime | null = null;
const LIVEKIT_SCREEN_WATCH_TOPIC = 'catrealm:screen-share-watch';
const LIVEKIT_SCREEN_VIDEO_TRACK_NAME_PREFIX = 'catrealm:screen-share-video:';

/**
 * Apply volume to a livekit-client RemoteAudioTrack in React Native.
 *
 * In RN, setVolume(0) routes through _mediaStreamTrack._setVolume(0) via a
 * native module call. Depending on the underlying implementation this can put
 * the native audio track into a disabled state that setVolume(>0) alone cannot
 * recover from. Toggling mediaStreamTrack.enabled is the reliable escape hatch:
 * disabled → silence, enabled → gain controlled by setVolume.
 */
function applyScreenShareAudioVolume(track: any, volume: number) {
  if (!track) return;
  const clamped = Math.max(0, Math.min(1, volume));
  try {
    const msTrack: any = track.mediaStreamTrack;
    if (msTrack) {
      msTrack.enabled = clamped > 0;
    }
    if (clamped > 0) {
      track.setVolume?.(clamped);
    }
  } catch { /* ignore */ }
}

function getLiveKitRuntime(): LiveKitRuntime {
  if (liveKitRuntime) return liveKitRuntime;
  const mod = require('livekit-client') as LiveKitRuntime;
  liveKitRuntime = mod;
  return mod;
}

function getActiveRoom(): any | null {
  return activeRoom;
}

export function getActiveVoiceRoom(): any | null {
  return activeRoom;
}

function getLocalMicrophonePublication(room: any | null): any | null {
  const publication =
    room?.localParticipant?.getTrackPublication?.('microphone') ??
    Array.from(room?.localParticipant?.audioTrackPublications?.values?.() ?? []).find(
      (pub: any) => pub?.source === 'microphone',
    );
  return publication ?? null;
}

function keepLocalMicrophoneCaptureActive(room: any | null): boolean {
  const mediaStreamTrack = getLocalMicrophonePublication(room)?.track?.mediaStreamTrack;
  if (!mediaStreamTrack) return false;

  try {
    // Keep the capture track enabled so iOS does not tear down the voice I/O unit.
    // Muting/deafening uses LiveKit pauseUpstream(), which stops outbound RTP
    // without disabling this native capture track.
    mediaStreamTrack.enabled = true;
    return true;
  } catch {
    return false;
  }
}

async function setLocalMicrophoneSendingEnabled(room: any | null, enabled: boolean): Promise<boolean> {
  const publication = getLocalMicrophonePublication(room);
  const track = publication?.track;
  const mediaStreamTrack = track?.mediaStreamTrack;
  if (!track || !mediaStreamTrack) return false;

  try {
    keepLocalMicrophoneCaptureActive(room);
    mediaStreamTrack._setVolume?.(enabled ? 1 : 0.0001);
    keepLocalMicrophoneCaptureActive(room);

    const sid = publication.trackSid ?? track.sid;
    const engine = room?.engine;
    if (sid && engine?.updateMuteStatus) {
      engine.updateMuteStatus(sid, !enabled);
    }
    return true;
  } catch {
    return false;
  }
}

function muteBlockedParticipant(userId: string) {
  if (!activeRoom || !useBlockedUsersStore.getState().isBlocked(userId)) return;
  try {
    const participant = activeRoom.getParticipantByIdentity?.(userId);
    if (participant) {
      participant.audioTrackPublications?.forEach((pub: any) => {
        pub.track?.setVolume?.(0);
      });
    }
  } catch {
    // ignore
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface VoiceParticipant {
  userId: string;
  username: string;
  avatar?: string | null;
  accountType?: AccountType | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
}

export interface RawVoiceUser {
  id: string;
  username: string;
  avatar?: string | null;
  accountType?: AccountType | null;
  muted?: boolean;
  deafened?: boolean;
}

interface MediaCapability {
  enabled: boolean;
  liveKitFallbackContexts?: Array<'voice' | 'theater'>;
  publicWsUrl?: string | null;
  publicUrl?: string | null;
}

// ── Store ────────────────────────────────────────────────────────────────────

const EMPTY_PARTICIPANTS: VoiceParticipant[] = [];
const EMPTY_ROOM_USERS: Record<string, VoiceParticipant[]> = {};
const EMPTY_AUDIO_MAP: Map<string, any> = new Map();
type ScreenShareVideoTarget = { height: number; fps: number };
const EMPTY_SCREEN_TRACKS: Array<{ id: string; track: any; participantId: string; videoTarget?: ScreenShareVideoTarget }> = [];
const EMPTY_VIEWERS: Record<string, string[]> = {};

function parseScreenShareVideoTarget(publication: any): ScreenShareVideoTarget | undefined {
  if (publication?.source !== 'screen_share') return undefined;
  const trackName = typeof publication?.trackName === 'string' ? publication.trackName : '';
  if (!trackName.startsWith(LIVEKIT_SCREEN_VIDEO_TRACK_NAME_PREFIX)) return undefined;
  const match = trackName.slice(LIVEKIT_SCREEN_VIDEO_TRACK_NAME_PREFIX.length).match(/^(\d+)p(\d+)$/);
  if (!match) return undefined;
  return { height: Number(match[1]), fps: Number(match[2]) };
}

function updateScreenShareViewerMap(
  current: Record<string, string[]>,
  targetUserId: string,
  viewerUserId: string,
  watching: boolean,
) {
  if (!targetUserId || !viewerUserId || targetUserId === viewerUserId) return current;
  const currentViewers = Array.isArray(current[targetUserId]) ? current[targetUserId] : [];
  if (watching) {
    if (currentViewers.includes(viewerUserId)) return current;
    return { ...current, [targetUserId]: [...currentViewers, viewerUserId] };
  }
  if (!currentViewers.includes(viewerUserId)) return current;
  const nextViewers = currentViewers.filter((id) => id !== viewerUserId);
  const next = { ...current };
  if (nextViewers.length > 0) next[targetUserId] = nextViewers;
  else delete next[targetUserId];
  return next;
}

function removeScreenShareViewer(current: Record<string, string[]>, viewerUserId: string) {
  let changed = false;
  const next: Record<string, string[]> = {};
  Object.entries(current).forEach(([targetUserId, viewers]) => {
    const filtered = Array.isArray(viewers) ? viewers.filter((id) => id !== viewerUserId) : [];
    if (!Array.isArray(viewers) || filtered.length !== viewers.length || targetUserId === viewerUserId) changed = true;
    if (targetUserId !== viewerUserId && filtered.length > 0) next[targetUserId] = filtered;
  });
  return changed ? next : current;
}

function replaceScreenShareViewerMap(
  current: Record<string, string[]>,
  targetUserId: string,
  viewerIds: string[],
) {
  if (!targetUserId) return current;
  const filtered = Array.from(new Set(viewerIds.filter((id) => id && id !== targetUserId)));
  const next = { ...current };
  if (filtered.length > 0) next[targetUserId] = filtered;
  else delete next[targetUserId];
  return next;
}

type ScreenShareWatcherProfile = { id: string; username: string; avatar?: string | null; accountType?: AccountType | null };

type ScreenShareWatchMessage =
  | { type: 'screen-share-watch'; targetUserId: string; watching: boolean }
  | {
    type: 'screen-share-watchers-snapshot';
    targetUserId: string;
    viewers: ScreenShareWatcherProfile[];
  };

function parseScreenShareWatchPayload(payload: Uint8Array): ScreenShareWatchMessage | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload));
    if (parsed?.type === 'screen-share-watch') {
      if (typeof parsed.targetUserId !== 'string' || typeof parsed.watching !== 'boolean') return null;
      return { type: 'screen-share-watch', targetUserId: parsed.targetUserId, watching: parsed.watching };
    }
    if (parsed?.type === 'screen-share-watchers-snapshot') {
      if (typeof parsed.targetUserId !== 'string' || !Array.isArray(parsed.viewers)) return null;
      const viewers = parsed.viewers
        .map((viewer: unknown) => {
          if (!viewer || typeof viewer !== 'object') return null;
          const record = viewer as Record<string, unknown>;
          if (typeof record.id !== 'string' || typeof record.username !== 'string') return null;
          return {
            id: record.id,
            username: record.username,
            avatar: typeof record.avatar === 'string' || record.avatar === null ? record.avatar : null,
            accountType: record.accountType === 'central' || record.accountType === 'local' ? record.accountType : null,
          };
        })
        .filter((viewer: ScreenShareWatcherProfile | null): viewer is ScreenShareWatcherProfile => Boolean(viewer));
      return { type: 'screen-share-watchers-snapshot', targetUserId: parsed.targetUserId, viewers };
    }
    return null;
  } catch {
    return null;
  }
}

function rawToParticipant(u: RawVoiceUser): VoiceParticipant {
  return {
    userId: u.id,
    username: u.username,
    avatar: u.avatar ?? null,
    accountType: u.accountType ?? null,
    micEnabled: !(u.muted ?? false),
    cameraEnabled: false,
    speaking: false,
    muted: u.muted ?? false,
    deafened: u.deafened ?? false,
  };
}

/** URL of the realm a voice session belongs to (not whichever realm is focused). */
function sessionServerUrl(serverId: string | null): string | null {
  const auth = useAuthStore.getState();
  if (auth.user?.accountType === 'central') {
    return serverId ? (useServerStore.getState().byId(serverId)?.url ?? null) : null;
  }
  return auth.serverUrl ?? null;
}

// LiveKit DisconnectReason values that mean "you were removed or left", not a
// network drop: CLIENT_INITIATED, DUPLICATE_IDENTITY, PARTICIPANT_REMOVED,
// ROOM_DELETED, ROOM_CLOSED, USER_REJECTED.
const FINAL_DISCONNECT_REASONS = new Set([1, 2, 4, 5, 10, 12]);
// A call that drops sooner than this after connecting is failing, not
// suspended; rejoining it would loop.
const MIN_CONNECTED_MS_FOR_REJOIN = 10_000;

/**
 * Rejoin a call LiveKit dropped (typically iOS suspending the app). Token
 * requests fail in the background, so wait for the foreground first.
 */
function scheduleVoiceRejoin(target: { serverId: string; channelId: string; channelName: string | null }) {
  const session = captureAccountSession();
  const rejoin = () => {
    // Skip if the user has since joined something else or switched accounts.
    if (!session.isCurrent() || useVoiceStore.getState().channelId) return;
    void useVoiceStore.getState().joinChannel({ ...target, channelName: target.channelName ?? undefined });
  };
  if (AppState.currentState === 'active') {
    setTimeout(rejoin, 1000);
    return;
  }
  const sub = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    sub.remove();
    rejoin();
  });
}

function getCurrentServerUrl(): string | null {
  const auth = useAuthStore.getState();
  if (auth.user?.accountType === 'central') {
    const ss = useServerStore.getState();
    return ss.activeServerId ? (ss.byId(ss.activeServerId)?.url ?? null) : null;
  }
  return auth.serverUrl ?? null;
}

interface VoiceState {
  channelId: string | null;
  serverId: string | null;
  channelName: string | null;
  participants: VoiceParticipant[];
  selfMicEnabled: boolean;
  selfCameraEnabled: boolean;
  selfDeafened: boolean;
  selfSpeaking: boolean;
  connecting: boolean;
  error: string | null;
  voiceRoomUsers: Record<string, VoiceParticipant[]>;
  voiceRoomStartedAt: Record<string, number>;
  screenSharingUserIds: string[];
  remoteScreenTracks: Array<{ id: string; track: any; publication?: any; participantId: string; videoTarget?: ScreenShareVideoTarget }>;
  remoteScreenAudioTracks: Map<string, any>;
  screenShareViewersByUser: Record<string, string[]>;
  screenShareViewerProfilesByUser: Record<string, { username: string; avatar?: string | null; accountType?: AccountType | null }>;
  roomRevision: number;

  joinChannel: (args: { serverId: string; channelId: string; channelName?: string }) => Promise<void>;
  leaveChannel: () => void;
  toggleMute: () => Promise<void>;
  toggleDeafen: () => void;
  watchScreenShare: (participantId: string) => void;
  stopWatchingScreenShare: (participantId: string) => void;
  setScreenShareVolume: (participantId: string, volume: number) => void;

  // Socket event handlers (wired in useSocket)
  handleVoiceUsers: (payload: { channelId: string; users: RawVoiceUser[]; startedAt?: number | null }) => void;
  handleUserJoined: (payload: { channelId: string; user: RawVoiceUser }) => void;
  handleUserLeft: (payload: { channelId: string; userId: string }) => void;
  handleUserState: (payload: { channelId: string; userId: string; muted: boolean; deafened: boolean }) => void;
  handleRoomCount: (payload: { channelId: string; count: number; startedAt?: number | null }) => void;
  handleRoomSync: (payload: { channelId: string; users: RawVoiceUser[]; startedAt?: number | null }) => void;
  handleRoomsSnapshot: (payload: { rooms: Array<{ channelId: string; count: number; users?: RawVoiceUser[]; startedAt?: number | null }> }) => void;
  handleForceDisconnect: () => void;
  /** Re-announce the call after its realm socket reconnects; the server drops it after a short grace. */
  restorePresence: () => void;
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  channelId: null,
  serverId: null,
  channelName: null,
  participants: EMPTY_PARTICIPANTS,
  selfMicEnabled: true,
  selfCameraEnabled: false,
  selfDeafened: false,
  selfSpeaking: false,
  connecting: false,
  error: null,
  voiceRoomUsers: EMPTY_ROOM_USERS,
  voiceRoomStartedAt: {},
  screenSharingUserIds: [],
  remoteScreenTracks: EMPTY_SCREEN_TRACKS,
  remoteScreenAudioTracks: EMPTY_AUDIO_MAP,
  screenShareViewersByUser: EMPTY_VIEWERS,
  screenShareViewerProfilesByUser: {},
  roomRevision: 0,

  joinChannel: async ({ serverId, channelId, channelName }) => {
    const serverUrl = getCurrentServerUrl();
    if (!serverUrl) {
      set({ error: 'No server URL available' });
      return;
    }

    // Leave any existing voice session first
    const current = get();
    if (current.channelId) {
      get().leaveChannel();
    }

    set({ connecting: true, error: null, channelId, serverId, channelName: channelName ?? null });

    let audioSessionAcquired = false;
    const generation = ++voiceJoinGeneration;
    const session = captureAccountSession();
    const isCurrent = () => generation === voiceJoinGeneration && session.isCurrent();
    let joiningRoom: any = null;
    let connectedAt = 0;
    const releaseAudio = () => {
      if (!audioSessionAcquired) return;
      audioSessionAcquired = false;
      void releaseAudioSession();
    };

    try {
      if (!ensureLiveKitGlobals()) {
        throw new Error(
          `WebRTC globals not initialized. ${getLiveKitInitError() ?? 'registerGlobals failed.'} ` +
          'Use a custom dev build (Expo Go does not support LiveKit WebRTC native modules).',
        );
      }

      const apiClient = createApi(serverUrl);
      const socket = getSocket(serverUrl);

      // 1) Resolve media capability (HTTP first, socket fallback)
      let capability: MediaCapability | null = null;
      try {
        const capResp = await apiClient.get<{ ok?: boolean; capability?: MediaCapability } | MediaCapability>(
          '/api/media/capabilities',
          { timeout: 5000 },
        );
        capability =
          'capability' in (capResp.data as { capability?: MediaCapability })
            ? ((capResp.data as { capability?: MediaCapability }).capability ?? null)
            : (capResp.data as MediaCapability);
      } catch {
        capability = null;
      }

      if (!capability && socket) {
        capability = await new Promise<MediaCapability | null>((resolve) => {
          socket.emit('media:v1:capabilities', (resp?: { ok?: boolean; capability?: MediaCapability }) => {
            if (!resp?.ok || !resp.capability) resolve(null);
            else resolve(resp.capability);
          });
          setTimeout(() => resolve(null), 3000);
        });
      }

      const capabilityUrl = capability?.publicUrl ?? capability?.publicWsUrl ?? null;
      const hasVoiceLiveKitPath = !!capability?.enabled || !!capability?.liveKitFallbackContexts?.includes('voice');
      if (!hasVoiceLiveKitPath) {
        setVoiceSessionActive(false);
        set({ connecting: false, channelId: null, error: 'Voice not supported on this server' });
        return;
      }

      // 2) Fetch LiveKit token (HTTP first, socket fallback)
      type TokenResponse = { token: string; url?: string | null };
      let tokenPayload: TokenResponse | null = null;
      try {
        const tokenResp = await apiClient.post<TokenResponse>(
          '/api/media/token',
          { context: 'voice', channelId },
          { timeout: 5000 },
        );
        tokenPayload = tokenResp.data ?? null;
      } catch {
        tokenPayload = null;
      }

      if (!tokenPayload && socket) {
        tokenPayload = await new Promise<TokenResponse | null>((resolve) => {
          socket.emit(
            'media:v1:token',
            { context: 'voice', channelId },
            (resp?: { ok?: boolean; token?: string; url?: string | null }) => {
              if (!resp?.ok || !resp.token) resolve(null);
              else resolve({ token: resp.token, url: resp.url ?? null });
            },
          );
          setTimeout(() => resolve(null), 3000);
        });
      }

      const token = tokenPayload?.token;
      if (!token) throw new Error('No token received');
      const wsUrl = tokenPayload?.url ?? capabilityUrl;
      if (!wsUrl) throw new Error('No LiveKit URL received');

      // 3. Create and connect LiveKit Room
      if (!isCurrent()) return;
      const { Room, RoomEvent } = getLiveKitRuntime();
      const room = new Room();
      joiningRoom = room;
      activeRoom = room;
      set((s) => ({ roomRevision: s.roomRevision + 1 }));

      room.on(RoomEvent.Disconnected, (reason?: number) => {
        releaseAudio();
        const s = useVoiceStore.getState();
        if (isCurrent() && activeRoom === room) {
          detachVoicePresence?.();
          detachVoicePresence = null;
          const target = s.serverId && s.channelId
            ? { serverId: s.serverId, channelId: s.channelId, channelName: s.channelName }
            : null;
          if (target && connectedAt > 0 && Date.now() - connectedAt >= MIN_CONNECTED_MS_FOR_REJOIN
            && !FINAL_DISCONNECT_REASONS.has(reason ?? 0)) {
            scheduleVoiceRejoin(target);
          }
          activeRoom = null;
          setVoiceSessionActive(false);
          set({
            channelId: null,
            serverId: null,
            channelName: null,
            participants: EMPTY_PARTICIPANTS,
            selfSpeaking: false,
            connecting: false,
            screenSharingUserIds: [],
            remoteScreenTracks: EMPTY_SCREEN_TRACKS,
            remoteScreenAudioTracks: EMPTY_AUDIO_MAP,
            screenShareViewersByUser: EMPTY_VIEWERS,
            screenShareViewerProfilesByUser: {},
            roomRevision: s.roomRevision + 1,
          });
        }
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers: any[]) => {
        const speakingIds = new Set<string>(speakers.map((p) => p.identity));
        const localIdentity = room.localParticipant?.identity ?? '';
        set((s) => ({
          selfSpeaking:
            s.selfMicEnabled &&
            !s.selfDeafened &&
            localIdentity.length > 0 &&
            speakingIds.has(localIdentity),
          participants: s.participants.map((p) => ({
            ...p,
            speaking:
              (p.userId !== localIdentity || (s.selfMicEnabled && !s.selfDeafened)) &&
              (speakingIds.has(p.userId) || speakingIds.has(p.username)),
          })),
        }));
      });

      room.on(RoomEvent.ParticipantConnected, (_participant: any) => {
        // Participant list is driven by socket voice:users events;
        // LiveKit events supplement speaking state only.
      });

      room.on(RoomEvent.ParticipantDisconnected, (participant: any) => {
        set((s) => ({
          participants: s.participants.filter((p) => p.userId !== participant.identity),
          screenSharingUserIds: s.screenSharingUserIds.filter((id) => id !== participant.identity),
          screenShareViewersByUser: removeScreenShareViewer(s.screenShareViewersByUser, participant.identity),
        }));
      });

      room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant: any, _kind: unknown, topic?: string) => {
        if ((topic && topic !== LIVEKIT_SCREEN_WATCH_TOPIC) || !participant?.identity) return;
        const message = parseScreenShareWatchPayload(payload);
        if (!message) return;
        if (message.type === 'screen-share-watchers-snapshot') {
          if (participant.identity !== message.targetUserId) return;
          const nextProfiles = message.viewers.reduce<Record<string, ScreenShareWatcherProfile>>((acc, viewer) => {
            acc[viewer.id] = viewer;
            return acc;
          }, {});
          set((s) => ({
            screenShareViewersByUser: replaceScreenShareViewerMap(
              s.screenShareViewersByUser,
              message.targetUserId,
              message.viewers.map((viewer) => viewer.id),
            ),
            screenShareViewerProfilesByUser: {
              ...s.screenShareViewerProfilesByUser,
              ...nextProfiles,
            },
          }));
          return;
        }
        set((s) => ({
          screenShareViewersByUser: updateScreenShareViewerMap(
            s.screenShareViewersByUser,
            message.targetUserId,
            participant.identity,
            message.watching,
          ),
          screenShareViewerProfilesByUser: {
            ...s.screenShareViewerProfilesByUser,
            [participant.identity]: {
              username: participant.name || participant.identity,
              avatar: null,
              accountType: null,
            },
          },
        }));
      });

      room.on(RoomEvent.TrackSubscribed, (track: any, publication: any, participant: any) => {
        const source: string = publication.source ?? '';
        if (source === 'screen_share' && track.kind === 'video') {
          const id = `${participant.identity}:${publication.trackSid}`;
          const videoTarget = parseScreenShareVideoTarget(publication);
          set((s) => ({
            remoteScreenTracks: [
              ...s.remoteScreenTracks.filter((e) => e.id !== id),
              { id, track, publication, participantId: participant.identity, videoTarget },
            ],
            screenSharingUserIds: s.screenSharingUserIds.includes(participant.identity)
              ? s.screenSharingUserIds
              : [...s.screenSharingUserIds, participant.identity],
          }));
        }
        if (source === 'screen_share_audio') {
          // Start disabled — re-enabled only when user opens the viewer. But if
          // they're already watching this participant (e.g. the sharer restreamed
          // and republished the track), keep it audible so the rejoin isn't silent.
          const selfId = useAuthStore.getState().user?.id;
          const stillWatching = !!(selfId
            && get().screenShareViewersByUser[participant.identity]?.includes(selfId));
          applyScreenShareAudioVolume(track, stillWatching ? 1 : 0);
          set((s) => {
            const next = new Map(s.remoteScreenAudioTracks);
            next.set(participant.identity, track);
            return { remoteScreenAudioTracks: next };
          });
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (_track: any, publication: any, participant: any) => {
        const source: string = publication.source ?? '';
        if (source === 'screen_share') {
          set((s) => ({
            remoteScreenTracks: s.remoteScreenTracks.filter(
              (e) => e.id !== `${participant.identity}:${publication.trackSid}`,
            ),
            screenSharingUserIds: s.screenSharingUserIds.filter((id) => id !== participant.identity),
          }));
        }
        if (source === 'screen_share_audio') {
          set((s) => {
            const next = new Map(s.remoteScreenAudioTracks);
            next.delete(participant.identity);
            return { remoteScreenAudioTracks: next };
          });
        }
      });

      // Start the audio session before connecting so remote audio (voice +
      // screen-share audio) routes correctly. Category/echo-cancellation is
      // left to LiveKit; notification sounds are guarded from clobbering it.
      audioSessionAcquired = true;
      releaseVoiceAudio = releaseAudio;
      await acquireAudioSession();
      if (!isCurrent()) { releaseAudio(); void room.disconnect(); return; }

      await room.connect(wsUrl, token);
      if (!isCurrent()) { releaseAudio(); void room.disconnect(); return; }
      connectedAt = Date.now();

      // 4. Emit socket presence join
      if (socket) {
        socket.emit('voice:join', {
          channelId,
          muted: !get().selfMicEnabled,
          deafened: get().selfDeafened,
        });
        // A suspended app outlives the server's disconnect grace and is dropped
        // from the call while LiveKit keeps running — a ghost. Rejoin on reconnect.
        detachVoicePresence?.();
        const onReconnect = () => useVoiceStore.getState().restorePresence();
        socket.on('connect', onReconnect);
        detachVoicePresence = () => socket.off('connect', onReconnect);
      }

      // 5. Enable microphone
      if (get().selfMicEnabled) {
        await room.localParticipant.setMicrophoneEnabled(true);
        if (!isCurrent()) { releaseAudio(); void room.disconnect(); return; }
        keepLocalMicrophoneCaptureActive(room);
      }

      setVoiceSessionActive(true);
      set({ connecting: false });
    } catch (err) {
      releaseAudio();
      if (joiningRoom) void joiningRoom.disconnect();
      if (!isCurrent()) return;
      activeRoom = null;
      setVoiceSessionActive(false);
      set((s) => ({
        connecting: false,
        channelId: null,
        serverId: null,
        error: err instanceof Error ? err.message : 'Failed to join voice channel',
        roomRevision: s.roomRevision + 1,
      }));
    }
  },

  leaveChannel: () => {
    ++voiceJoinGeneration;
    detachVoicePresence?.();
    detachVoicePresence = null;
    const { channelId } = get();
    const serverUrl = getCurrentServerUrl();

    // Disconnect LiveKit Room
    if (activeRoom) {
      try { activeRoom.disconnect(); } catch { /* ignore */ }
      activeRoom = null;
    }
    releaseVoiceAudio?.();
    releaseVoiceAudio = null;

    // Emit socket presence leave
    if (serverUrl && channelId) {
      const socket = getSocket(serverUrl);
      if (socket) {
        socket.emit('voice:leave', { channelId });
      }
    }

    setVoiceSessionActive(false);
    set((s) => ({
      channelId: null,
      serverId: null,
      channelName: null,
      participants: EMPTY_PARTICIPANTS,
      selfMicEnabled: true,
      selfCameraEnabled: false,
      selfDeafened: false,
      selfSpeaking: false,
      connecting: false,
      error: null,
      screenSharingUserIds: [],
      remoteScreenTracks: EMPTY_SCREEN_TRACKS,
      remoteScreenAudioTracks: EMPTY_AUDIO_MAP,
      screenShareViewersByUser: EMPTY_VIEWERS,
      screenShareViewerProfilesByUser: {},
      roomRevision: s.roomRevision + 1,
    }));
  },

  toggleMute: async () => {
    const { channelId, selfMicEnabled, selfDeafened } = get();
    const newMuted = selfMicEnabled; // toggling: if currently enabled, we're muting
    const newMicEnabled = !selfMicEnabled;

    const room = getActiveRoom();
    try {
      if (newMicEnabled) {
        await room?.localParticipant.setMicrophoneEnabled(true);
        await setLocalMicrophoneSendingEnabled(room, true);
        keepLocalMicrophoneCaptureActive(room);
      } else if (room) {
        await room.localParticipant.setMicrophoneEnabled(true);
        keepLocalMicrophoneCaptureActive(room);
        await setLocalMicrophoneSendingEnabled(room, false);
      }
    } catch { /* ignore permission errors */ }

    set((s) => ({
      selfMicEnabled: newMicEnabled,
      selfSpeaking: newMicEnabled && !s.selfDeafened ? s.selfSpeaking : false,
      participants: s.participants.map((p) => (
        p.userId === activeRoom?.localParticipant?.identity ? { ...p, speaking: false } : p
      )),
    }));

    const muteSettings = useSettingsStore.getState();
    const soundKey = newMicEnabled ? 'soundVoiceUnmute' : 'soundVoiceMute';
    const soundType = newMicEnabled ? 'voice-unmute' : 'voice-mute';
    if (muteSettings[soundKey]) {
      void playNotificationSound(soundType, muteSettings.soundVolumes?.[soundKey] ?? 100);
    }

    if (channelId) {
      const serverUrl = getCurrentServerUrl();
      const socket = serverUrl ? getSocket(serverUrl) : null;
      socket?.emit('voice:state', { channelId, muted: newMuted, deafened: selfDeafened });
    }
  },

  toggleDeafen: () => {
    const { channelId, selfMicEnabled, selfDeafened } = get();
    const newDeafened = !selfDeafened;

    // When deafening, also mute microphone; when undeafening, restore mic
    const room = getActiveRoom();
    if (room) {
      if (newDeafened) {
        void room.localParticipant.setMicrophoneEnabled(true)
          .then(() => {
            keepLocalMicrophoneCaptureActive(room);
            return setLocalMicrophoneSendingEnabled(room, false);
          })
          .catch(() => {});
      } else if (selfMicEnabled) {
        void room.localParticipant.setMicrophoneEnabled(true)
          .then(() => setLocalMicrophoneSendingEnabled(room, true))
          .then(() => keepLocalMicrophoneCaptureActive(room))
          .catch(() => {});
      }
    }

    set((s) => ({
      selfDeafened: newDeafened,
      selfSpeaking: newDeafened ? false : s.selfSpeaking,
      participants: s.participants.map((p) => (
        p.userId === activeRoom?.localParticipant?.identity ? { ...p, speaking: false } : p
      )),
    }));

    const deafenSettings = useSettingsStore.getState();
    const soundKey = newDeafened ? 'soundVoiceDeafen' : 'soundVoiceUndeafen';
    const soundType = newDeafened ? 'voice-deafen' : 'voice-undeafen';
    if (deafenSettings[soundKey]) {
      void playNotificationSound(soundType, deafenSettings.soundVolumes?.[soundKey] ?? 100);
    }

    if (channelId) {
      const serverUrl = getCurrentServerUrl();
      const socket = serverUrl ? getSocket(serverUrl) : null;
      socket?.emit('voice:state', {
        channelId,
        muted: newDeafened ? true : !selfMicEnabled,
        deafened: newDeafened,
      });
    }
  },

  watchScreenShare: (participantId) => {
    const audioTrack = get().remoteScreenAudioTracks.get(participantId);
    applyScreenShareAudioVolume(audioTrack, 1);
    const selfId = useAuthStore.getState().user?.id;
    if (selfId) {
      set((s) => ({
        screenShareViewersByUser: updateScreenShareViewerMap(
          s.screenShareViewersByUser,
          participantId,
          selfId,
          true,
        ),
      }));
    }
    if (selfId && participantId !== selfId && activeRoom) {
      const payload = new TextEncoder().encode(JSON.stringify({
        type: 'screen-share-watch', targetUserId: participantId, watching: true,
      }));
      void activeRoom.localParticipant.publishData(payload, {
        reliable: true, topic: LIVEKIT_SCREEN_WATCH_TOPIC,
      }).catch(() => {});
    }
  },

  stopWatchingScreenShare: (participantId) => {
    const audioTrack = get().remoteScreenAudioTracks.get(participantId);
    applyScreenShareAudioVolume(audioTrack, 0);
    const selfId = useAuthStore.getState().user?.id;
    if (selfId) {
      set((s) => ({
        screenShareViewersByUser: updateScreenShareViewerMap(
          s.screenShareViewersByUser,
          participantId,
          selfId,
          false,
        ),
      }));
    }
    if (selfId && participantId !== selfId && activeRoom) {
      const payload = new TextEncoder().encode(JSON.stringify({
        type: 'screen-share-watch', targetUserId: participantId, watching: false,
      }));
      void activeRoom.localParticipant.publishData(payload, {
        reliable: true, topic: LIVEKIT_SCREEN_WATCH_TOPIC,
      }).catch(() => {});
    }
  },

  setScreenShareVolume: (participantId, volume) => {
    applyScreenShareAudioVolume(get().remoteScreenAudioTracks.get(participantId), volume);
  },

  handleVoiceUsers: ({ channelId, users, startedAt }) => {
    if (get().channelId !== channelId) return;
    set((s) => {
      const nextStartedAt = { ...s.voiceRoomStartedAt };
      if (users.length > 0 && typeof startedAt === 'number') nextStartedAt[channelId] = startedAt;
      else if (users.length === 0 || startedAt === null) delete nextStartedAt[channelId];
      return {
        participants: users.map(rawToParticipant),
        voiceRoomUsers: {
          ...s.voiceRoomUsers,
          [channelId]: users.map(rawToParticipant),
        },
        voiceRoomStartedAt: nextStartedAt,
      };
    });
    users.forEach((u) => muteBlockedParticipant(u.id));
  },

  handleUserJoined: ({ channelId, user }) => {
    if (get().channelId !== channelId) return;
    set((s) => {
      if (s.participants.some((p) => p.userId === user.id)) return {};
      return { participants: [...s.participants, rawToParticipant(user)] };
    });
    muteBlockedParticipant(user.id);
  },

  handleUserLeft: ({ channelId, userId }) => {
    if (get().channelId !== channelId) return;
    set((s) => ({ participants: s.participants.filter((p) => p.userId !== userId) }));
  },

  handleUserState: ({ channelId, userId, muted, deafened }) => {
    if (get().channelId !== channelId) return;
    set((s) => ({
      participants: s.participants.map((p) =>
        p.userId === userId ? { ...p, muted, deafened, micEnabled: !muted } : p,
      ),
    }));
  },

  handleRoomCount: ({ channelId, count, startedAt }) => {
    set((s) => {
      const nextStartedAt = { ...s.voiceRoomStartedAt };
      if ((count || 0) > 0 && typeof startedAt === 'number') nextStartedAt[channelId] = startedAt;
      else if ((count || 0) === 0 || startedAt === null) delete nextStartedAt[channelId];
      return { voiceRoomStartedAt: nextStartedAt };
    });
  },

  handleRoomSync: ({ channelId, users, startedAt }) => {
    set((s) => {
      const nextStartedAt = { ...s.voiceRoomStartedAt };
      if (users.length > 0 && typeof startedAt === 'number') nextStartedAt[channelId] = startedAt;
      else if (users.length === 0 || startedAt === null) delete nextStartedAt[channelId];
      return {
        voiceRoomUsers: {
          ...s.voiceRoomUsers,
          [channelId]: users.map(rawToParticipant),
        },
        voiceRoomStartedAt: nextStartedAt,
      };
    });
  },

  handleRoomsSnapshot: ({ rooms }) => {
    set((s) => {
      const nextUsers: Record<string, VoiceParticipant[]> = {};
      const nextStartedAt: Record<string, number> = {};
      for (const room of rooms) {
        if (room.users) nextUsers[room.channelId] = room.users.map(rawToParticipant);
        if ((room.count || room.users?.length || 0) > 0 && typeof room.startedAt === 'number') {
          nextStartedAt[room.channelId] = room.startedAt;
        }
      }
      return {
        voiceRoomUsers: { ...s.voiceRoomUsers, ...nextUsers },
        voiceRoomStartedAt: nextStartedAt,
      };
    });
  },

  handleForceDisconnect: () => {
    get().leaveChannel();
  },

  restorePresence: () => {
    const { channelId, serverId, connecting, selfMicEnabled, selfDeafened } = get();
    const serverUrl = sessionServerUrl(serverId);
    if (!channelId || connecting || !activeRoom || !serverUrl) return;
    getSocket(serverUrl)?.emit('voice:join', { channelId, muted: !selfMicEnabled, deafened: selfDeafened });
  },
}));
