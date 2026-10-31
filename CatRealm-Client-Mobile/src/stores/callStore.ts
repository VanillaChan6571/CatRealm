import '@/lib/livekit-init';
import { ensureLiveKitGlobals, getLiveKitInitError } from '@/lib/livekit-init';
import { create } from 'zustand';
import type { Socket } from 'socket.io-client';
import { createAuthenticatedApi } from '@/lib/api';
import { useAuthStore } from './authStore';
import { useDMStore } from './dmStore';
import { useGroupChatStore } from './groupChatStore';
import { useSettingsStore } from './settingsStore';
import { startLoopingNotificationSound } from '@/lib/notificationSounds';
import { acquireAudioSession, releaseAudioSession } from '@/lib/audioSession';
import { captureAccountSession } from '@/lib/accountSession';
import type { NativeCallAction } from '@/native/types';

type MediaType = 'audio' | 'video';
type CallType = 'dm' | 'group';
type Participant = { userId: string; username: string; displayName: string | null; avatar: string | null; muted?: boolean; deafened?: boolean; videoEnabled?: boolean; connected?: boolean };
type IncomingDMCall = { callId: string; conversationId: string; callerId: string; callerName: string; callerAvatar: string | null; mediaType: MediaType };
type ActiveCall = {
  callId: string;
  callType: CallType;
  title: string;
  mediaType: MediaType;
  conversationId?: string;
  groupChatId?: string;
  status: 'ringing' | 'active';
  connectedAt?: number;
  participants: Participant[];
};
type MediaCapability = { enabled: boolean; contexts: CallType[] };
type MediaToken = { ok?: boolean; token?: string; url?: string | null };
type CallNotice = { title: string; detail: string; kind: 'info' | 'success' | 'warning' };

let noticeTimer: ReturnType<typeof setTimeout> | null = null;
function showNotice(set: (partial: Partial<CallState>) => void, notice: CallNotice) {
  if (noticeTimer) clearTimeout(noticeTimer);
  set({ notice });
  noticeTimer = setTimeout(() => {
    noticeTimer = null;
    useCallStore.setState({ notice: null });
  }, 3500);
}

let activeRoom: any = null;
let callRoomGeneration = 0;
let releaseCallAudio: (() => void) | null = null;
const pendingAcceptedCallIds = new Set<string>();
let callSocket: Socket | null = null;
let runtime: any = null;
let stopRingingSound: null | (() => Promise<void>) = null;
let ringingGeneration = 0;
const getRuntime = () => runtime ??= require('livekit-client');
function disconnectActiveRoom() {
  const room = activeRoom;
  activeRoom = null;
  const release = releaseCallAudio;
  releaseCallAudio = null;
  release?.();
  if (room) void Promise.resolve().then(() => room.disconnect()).catch(() => {});
}
function leaveCallMedia() {
  ++callRoomGeneration;
  disconnectActiveRoom();
}
async function stopRinging() {
  ++ringingGeneration;
  const stop = stopRingingSound;
  stopRingingSound = null;
  await stop?.();
}
async function startRinging(type: 'dm-incoming-call' | 'dm-outgoing-call') {
  await stopRinging();
  const generation = ringingGeneration;
  const settings = useSettingsStore.getState();
  const enabled = type === 'dm-incoming-call' ? settings.soundDMIncomingCall : settings.soundDMOutgoingCall;
  if (!settings.notificationsEnabled || !enabled) return;
  const key = type === 'dm-incoming-call' ? 'soundDMIncomingCall' : 'soundDMOutgoingCall';
  const stop = await startLoopingNotificationSound(type, settings.soundVolumes?.[key] ?? 100);
  if (generation !== ringingGeneration) { await stop(); return; }
  stopRingingSound = stop;
}

async function joinLiveKit(callId: string, callType: CallType, mediaType: MediaType, muted: boolean) {
  const generation = ++callRoomGeneration;
  if (!ensureLiveKitGlobals()) throw new Error(getLiveKitInitError() ?? 'LiveKit unavailable');
  const socket = callSocket;
  if (!socket) throw new Error('Call socket unavailable');
  const api = createAuthenticatedApi();
  let capability: MediaCapability | null = null;
  try { capability = (await api.get('/api/calls/media/capabilities')).data?.capability ?? null; } catch { /* socket fallback */ }
  if (!capability) capability = await new Promise((resolve) => {
    socket.emit('media:v1:capabilities', (r?: { ok?: boolean; capability?: MediaCapability }) => resolve(r?.ok ? r.capability ?? null : null));
    setTimeout(() => resolve(null), 3000);
  });
  if (!capability?.enabled || !capability.contexts?.includes(callType)) throw new Error('LiveKit calls unavailable');
  let session: MediaToken | null = null;
  try { session = (await api.post('/api/calls/media/token', { callId, socketId: socket.id })).data ?? null; } catch { /* socket fallback */ }
  if (!session?.token || !session.url) session = await new Promise((resolve) => {
    socket.emit('media:v1:token', { callId }, (r?: MediaToken) => resolve(r?.ok && r.token && r.url ? r : null));
    setTimeout(() => resolve(null), 3000);
  });
  if (!session?.token || !session.url) throw new Error('No call media token received');
  if (generation !== callRoomGeneration) return;
  disconnectActiveRoom();
  const { Room, RoomEvent } = getRuntime();
  const room = new Room();
  activeRoom = room;
  room.on(RoomEvent.Disconnected, () => {
    if (activeRoom !== room) return;
    activeRoom = null;
    const release = releaseCallAudio;
    releaseCallAudio = null;
    release?.();
    useCallStore.setState({ remoteVideoTracks: [], localVideoTrack: null });
  });
  room.on(RoomEvent.TrackSubscribed, (track: any, publication: any, participant: any) => {
    if (activeRoom !== room || track.kind !== 'video') return;
    const id = `${participant.identity}:${publication.trackSid}`;
    useCallStore.setState((s) => ({
      remoteVideoTracks: [...s.remoteVideoTracks.filter((entry) => entry.id !== id), { id, track }],
    }));
  });
  room.on(RoomEvent.TrackUnsubscribed, (_track: any, publication: any, participant: any) => {
    if (activeRoom !== room) return;
    const id = `${participant.identity}:${publication.trackSid}`;
    useCallStore.setState((s) => ({ remoteVideoTracks: s.remoteVideoTracks.filter((entry) => entry.id !== id) }));
  });
  let audioReleased = false;
  releaseCallAudio = () => {
    if (audioReleased) return;
    audioReleased = true;
    void releaseAudioSession();
  };
  const isCurrent = () => {
    if (generation !== callRoomGeneration) return false;
    if (activeRoom !== room) throw new Error('Call media disconnected');
    return true;
  };
  try {
    await acquireAudioSession();
    if (!isCurrent()) return;
    await room.connect(session.url, session.token);
    if (!isCurrent()) return;
    if (!muted) await room.localParticipant.setMicrophoneEnabled(true);
    if (!isCurrent()) return;
    if (mediaType === 'video') {
      await room.localParticipant.setCameraEnabled(true).catch(() => {});
      if (!isCurrent()) return;
      const publication = Array.from(room.localParticipant.videoTrackPublications.values())[0] as any;
      useCallStore.setState({ localVideoTrack: publication?.track ?? null });
    }
  } catch (error) {
    if (activeRoom === room) disconnectActiveRoom();
    if (generation === callRoomGeneration) throw error;
  }
}

interface CallState {
  incomingDMCalls: Record<string, IncomingDMCall>;
  activeCall: ActiveCall | null;
  muted: boolean;
  deafened: boolean;
  connecting: boolean;
  error: string | null;
  notice: CallNotice | null;
  remoteVideoTracks: Array<{ id: string; track: any }>;
  localVideoTrack: any | null;
  setSocket: (socket: Socket | null) => void;
  initiateDMCall: (conversationId: string, mediaType?: MediaType) => void;
  answerDMCall: (callId: string, accept: boolean) => Promise<void>;
  initiateGroupCall: (groupChatId: string, mediaType?: MediaType) => void;
  joinGroupCall: (callId: string, groupChatId: string, mediaType: MediaType) => void;
  recoverActiveCalls: () => Promise<void>;
  endCall: () => void;
  toggleMute: () => Promise<void>;
  toggleDeafen: () => void;
  handleIncomingDM: (call: IncomingDMCall) => void;
  handleDMInitiated: (p: { callId: string; conversationId: string; mediaType: MediaType }) => void;
  handleDMAccepted: (p: { callId: string }) => Promise<void>;
  handleDMEnded: (p: { callId: string; reason?: string; duration?: number }) => void;
  handleDMDeclined: (p: { callId: string; reason?: string }) => void;
  handleDMBusy: () => void;
  handleDMParticipantJoined: (p: { callId: string; userId: string }) => void;
  handleDMParticipantLeft: (p: { callId: string; userId: string; reason?: string }) => void;
  handleDMHandledElsewhere: (p: { callId: string; reason?: string }) => void;
  handleDMMovedDevice: (p: { callId: string }) => void;
  handleGroupStarted: (p: { callId: string; groupChatId: string; initiatorName: string; mediaType: MediaType }) => void;
  handleGroupInitiated: (p: { callId: string; groupChatId: string; mediaType: MediaType }) => void;
  handleGroupJoined: (p: { callId: string; participants: Participant[] }) => Promise<void>;
  handleGroupParticipantJoined: (p: Participant & { callId: string }) => void;
  handleGroupParticipantLeft: (p: { callId: string; userId: string }) => void;
  handleParticipantState: (p: { callId: string; fromUserId: string; state: Partial<Participant> }) => void;
  handleNativeCallAction: (action: NativeCallAction) => Promise<void>;
  handleError: (error: string) => void;
}

export const useCallStore = create<CallState>((set, get) => ({
  incomingDMCalls: {}, activeCall: null, muted: false, deafened: false, connecting: false, error: null, notice: null, remoteVideoTracks: [], localVideoTrack: null,
  setSocket: (socket) => { callSocket = socket; if (!socket) pendingAcceptedCallIds.clear(); },
  initiateDMCall: (conversationId, mediaType = 'audio') => callSocket?.emit('call:initiate', { conversationId, mediaType, privacyMode: false }),
  answerDMCall: async (callId, accept) => {
    const incoming = get().incomingDMCalls[callId];
    if (!incoming) return;
    if (!accept) { callSocket?.emit('call:answer', { callId, accept: false }); void stopRinging(); set((s) => { const n = { ...s.incomingDMCalls }; delete n[callId]; return { incomingDMCalls: n }; }); return; }
    if (!callSocket?.connected) { set({ error: 'Call connection unavailable. Please try again.' }); return; }
    // Accept promptly: waiting for LiveKit before signaling can leave the caller ringing until timeout.
    callSocket.emit('call:answer', { callId, accept: true });
    void stopRinging();
    set((s) => { const n = { ...s.incomingDMCalls }; delete n[callId]; return { incomingDMCalls: n, activeCall: { callId, callType: 'dm', title: incoming.callerName, mediaType: incoming.mediaType, conversationId: incoming.conversationId, status: 'active', connectedAt: Date.now(), participants: [{ userId: incoming.callerId, username: incoming.callerName, displayName: incoming.callerName, avatar: incoming.callerAvatar, connected: true }] }, connecting: true, error: null }; });
    try {
      await joinLiveKit(callId, 'dm', incoming.mediaType, get().muted);
      if (get().activeCall?.callId === callId) set({ connecting: false });
    } catch (e) { if (get().activeCall?.callId === callId) set({ connecting: false, error: e instanceof Error ? e.message : 'Failed to connect call audio' }); }
  },
  initiateGroupCall: (groupChatId, mediaType = 'audio') => callSocket?.emit('gc:call:initiate', { groupChatId, mediaType }),
  joinGroupCall: (callId, groupChatId, mediaType) => { const g = useGroupChatStore.getState().groups.find((x) => x.id === groupChatId); set({ activeCall: { callId, callType: 'group', title: g?.name ?? 'Group Call', mediaType, groupChatId, status: 'ringing', participants: [] } }); callSocket?.emit('gc:call:join', { callId }); },
  recoverActiveCalls: async () => {
    if (!callSocket) return;
    const session = captureAccountSession();
    const socket = callSocket;
    const initialCallId = get().activeCall?.callId ?? null;
    const calls = (await createAuthenticatedApi().get('/api/calls/active').catch(() => null))?.data?.activeCalls;
    if (!session.isCurrent() || callSocket !== socket || get().activeCall?.callId !== initialCallId || !Array.isArray(calls)) return;
    const current = get().activeCall;
    if (current) {
      const live = calls.find((c) => c?.callId === current.callId);
      if (!live) {
        get().handleDMEnded({ callId: current.callId, reason: 'ended' });
        return;
      }
      if (current.callType === 'dm' && live.status === 'active') {
        if (current.status === 'ringing') { void get().handleDMAccepted({ callId: current.callId }); return; }
        set((s) => s.activeCall?.callId !== current.callId ? s : ({ activeCall: { ...s.activeCall, participants: s.activeCall.participants.map((p) => ({ ...p, connected: live.otherJoined !== false })) } }));
        if (live.selfJoined === false && live.otherJoined === true) callSocket.emit('call:rejoin', { callId: current.callId });
        if (!activeRoom && !get().connecting) {
          set({ connecting: true, error: null });
          try { await joinLiveKit(current.callId, 'dm', current.mediaType, get().muted); if (get().activeCall?.callId === current.callId) set({ connecting: false }); }
          catch (e) { if (get().activeCall?.callId === current.callId) set({ connecting: false, error: e instanceof Error ? e.message : 'Failed to reconnect call audio' }); }
        }
      }
      return;
    }
    const ringingDm = calls.find((c) => c?.callType === 'dm' && c?.status === 'ringing' && c?.callId && c?.conversationId && c?.otherUser?.userId);
    if (ringingDm) {
      if (ringingDm.initiatorId === useAuthStore.getState().user?.id) {
        set({ activeCall: {
          callId: String(ringingDm.callId), callType: 'dm', conversationId: String(ringingDm.conversationId),
          title: String(ringingDm.otherUser.displayName || ringingDm.otherUser.username || 'DM Call'), mediaType: ringingDm.mediaType === 'video' ? 'video' : 'audio',
          status: 'ringing', participants: [{ userId: String(ringingDm.otherUser.userId), username: String(ringingDm.otherUser.username || 'Unknown'), displayName: ringingDm.otherUser.displayName ?? null, avatar: ringingDm.otherUser.avatar ?? null, connected: false }],
        } });
        void startRinging('dm-outgoing-call');
      } else {
        get().handleIncomingDM({
          callId: String(ringingDm.callId), conversationId: String(ringingDm.conversationId), callerId: String(ringingDm.otherUser.userId),
          callerName: String(ringingDm.otherUser.displayName || ringingDm.otherUser.username || 'Unknown'), callerAvatar: ringingDm.otherUser.avatar ?? null,
          mediaType: ringingDm.mediaType === 'video' ? 'video' : 'audio',
        });
      }
      return;
    }
    const group = calls.find((c) => c?.callType === 'group' && c?.status === 'active');
    if (group?.callId && group?.groupChatId) {
      get().joinGroupCall(String(group.callId), String(group.groupChatId), group.mediaType === 'video' ? 'video' : 'audio');
      return;
    }
    const dm = calls.find((c) => c?.callType === 'dm' && c?.status === 'active' && c?.selfJoined !== false);
    if (dm?.callId && dm?.conversationId && dm?.otherUser?.userId) {
      const active: ActiveCall = {
        callId: String(dm.callId), callType: 'dm', conversationId: String(dm.conversationId),
        title: String(dm.otherUser.displayName || dm.otherUser.username || 'DM Call'), mediaType: dm.mediaType === 'video' ? 'video' : 'audio',
        status: 'active', connectedAt: Number(dm.startedAt) ? Number(dm.startedAt) * 1000 : Date.now(), participants: [{ userId: String(dm.otherUser.userId), username: String(dm.otherUser.username || 'Unknown'), displayName: dm.otherUser.displayName ?? null, avatar: dm.otherUser.avatar ?? null, connected: dm.otherJoined !== false }],
      };
      set({ activeCall: active, connecting: true });
      try { await joinLiveKit(active.callId, 'dm', active.mediaType, get().muted); if (get().activeCall?.callId === active.callId) set({ connecting: false }); } catch (e) { if (get().activeCall?.callId === active.callId) set({ connecting: false, error: e instanceof Error ? e.message : 'Failed to recover call' }); }
    }
  },
  endCall: () => {
    const c = get().activeCall;
    const incomingIds = Object.keys(get().incomingDMCalls);
    pendingAcceptedCallIds.clear();
    if (callSocket?.connected) {
      if (c) callSocket.emit(c.callType === 'group' ? 'gc:call:leave' : 'call:end', { callId: c.callId });
      for (const callId of incomingIds) callSocket.emit('call:answer', { callId, accept: false });
    }
    void stopRinging();
    leaveCallMedia();
    set({ incomingDMCalls: {}, activeCall: null, connecting: false, error: null, notice: null, remoteVideoTracks: [], localVideoTrack: null });
  },
  toggleMute: async () => { const muted = !get().muted; await activeRoom?.localParticipant.setMicrophoneEnabled(!muted).catch(() => {}); set({ muted }); const c = get().activeCall; if (c) callSocket?.emit(c.callType === 'group' ? 'gc:call:state:update' : 'call:state:update', { callId: c.callId, state: { muted, deafened: get().deafened } }); },
  toggleDeafen: () => { const deafened = !get().deafened; set({ deafened }); const c = get().activeCall; if (c) callSocket?.emit(c.callType === 'group' ? 'gc:call:state:update' : 'call:state:update', { callId: c.callId, state: { muted: get().muted, deafened } }); },
  handleIncomingDM: (call) => { if (get().activeCall?.callId === call.callId || get().incomingDMCalls[call.callId]) return; void startRinging('dm-incoming-call'); set((s) => ({ incomingDMCalls: { ...s.incomingDMCalls, [call.callId]: call } })); },
  handleDMInitiated: (p) => {
    const dm = useDMStore.getState().conversations.find((x) => x.id === p.conversationId);
    void startRinging('dm-outgoing-call');
    set({ activeCall: {
      callId: p.callId, callType: 'dm', conversationId: p.conversationId,
      title: dm?.otherDisplayName ?? dm?.otherUsername ?? 'DM Call', mediaType: p.mediaType,
      status: 'ringing', participants: dm ? [{
        userId: dm.otherUserId, username: dm.otherUsername,
        displayName: dm.otherDisplayName ?? null, avatar: dm.otherAvatar, connected: false,
      }] : [],
    } });
    if (pendingAcceptedCallIds.delete(p.callId)) void get().handleDMAccepted({ callId: p.callId });
  },
  handleDMAccepted: async ({ callId }) => {
    const c = get().activeCall;
    if (!c) { pendingAcceptedCallIds.add(callId); return; }
    if (c.callId !== callId || (c.status === 'active' && (activeRoom || get().connecting))) return;
    void stopRinging();
    set({ activeCall: {
      ...c, status: 'active', connectedAt: Date.now(),
      participants: c.participants.map((p) => ({ ...p, connected: true })),
    }, connecting: true, error: null });
    try {
      await joinLiveKit(callId, 'dm', c.mediaType, get().muted);
      if (get().activeCall?.callId === callId) set({ connecting: false });
    } catch (e) {
      if (get().activeCall?.callId === callId) set({ connecting: false, error: e instanceof Error ? e.message : 'Failed to join call' });
    }
  },
  handleDMEnded: ({ callId, reason }) => {
    pendingAcceptedCallIds.delete(callId);
    const isActive = get().activeCall?.callId === callId;
    const isIncoming = !!get().incomingDMCalls[callId];
    if (!isActive && !isIncoming) return;
    void stopRinging();
    if (isActive) leaveCallMedia();
    const title = reason === 'cancelled' ? 'Call missed' : 'Call ended';
    const detail = reason === 'alone_timeout' ? 'The call ended after you were alone.'
      : reason === 'cancelled' && isIncoming ? 'You missed the incoming call.' : 'The call has ended.';
    set((s) => {
      const incomingDMCalls = { ...s.incomingDMCalls };
      delete incomingDMCalls[callId];
      return { incomingDMCalls, activeCall: isActive ? null : s.activeCall,
        connecting: isActive ? false : s.connecting, error: null,
        remoteVideoTracks: isActive ? [] : s.remoteVideoTracks,
        localVideoTrack: isActive ? null : s.localVideoTrack };
    });
    showNotice(set, { title, detail, kind: reason === 'cancelled' ? 'warning' : 'info' });
  },
  handleDMDeclined: ({ callId }) => { if (get().activeCall?.callId !== callId) return; void stopRinging(); leaveCallMedia(); set({ activeCall: null, connecting: false, error: null, remoteVideoTracks: [], localVideoTrack: null }); showNotice(set, { title: 'Call declined', detail: 'They declined the call.', kind: 'warning' }); },
  handleDMBusy: () => showNotice(set, { title: 'User busy', detail: 'They are already in another call.', kind: 'warning' }),
  handleDMParticipantJoined: ({ callId, userId }) => set((s) => s.activeCall?.callId !== callId ? s : ({ activeCall: { ...s.activeCall, participants: s.activeCall.participants.map((p) => p.userId === userId ? { ...p, connected: true } : p) } })),
  handleDMParticipantLeft: ({ callId, userId }) => set((s) => s.activeCall?.callId !== callId ? s : ({ activeCall: { ...s.activeCall, participants: s.activeCall.participants.map((p) => p.userId === userId ? { ...p, connected: false } : p) } })),
  handleDMHandledElsewhere: ({ callId }) => {
    if (!get().incomingDMCalls[callId]) return;
    void stopRinging();
    set((s) => { const n = { ...s.incomingDMCalls }; delete n[callId]; return { incomingDMCalls: n }; });
  },
  handleDMMovedDevice: ({ callId }) => {
    if (get().activeCall?.callId !== callId) return;
    void stopRinging(); activeRoom?.disconnect(); activeRoom = null;
    set({ activeCall: null, connecting: false, remoteVideoTracks: [], localVideoTrack: null });
    showNotice(set, { title: 'Call moved', detail: 'The call continues on another device.', kind: 'info' });
  },
  handleGroupStarted: (p) => { if (get().activeCall?.callId === p.callId) return; const g = useGroupChatStore.getState().groups.find((x) => x.id === p.groupChatId); set({ activeCall: { callId: p.callId, callType: 'group', groupChatId: p.groupChatId, title: g?.name ?? 'Group Call', mediaType: p.mediaType, status: 'ringing', participants: [] } }); },
  handleGroupInitiated: (p) => get().joinGroupCall(p.callId, p.groupChatId, p.mediaType),
  handleGroupJoined: async ({ callId, participants }) => { const c = get().activeCall; if (!c || c.callId !== callId) return; set({ connecting: true }); try { await joinLiveKit(callId, 'group', c.mediaType, get().muted); set({ activeCall: { ...c, status: 'active', connectedAt: Date.now(), participants: participants.map((p) => ({ ...p, connected: true })) }, connecting: false }); } catch (e) { set({ connecting: false, error: e instanceof Error ? e.message : 'Failed to join group call' }); } },
  handleGroupParticipantJoined: (p) => set((s) => s.activeCall?.callId !== p.callId ? s : ({ activeCall: { ...s.activeCall, participants: [...s.activeCall.participants.filter((x) => x.userId !== p.userId), p] } })),
  handleGroupParticipantLeft: (p) => set((s) => s.activeCall?.callId !== p.callId ? s : ({ activeCall: { ...s.activeCall, participants: s.activeCall.participants.filter((x) => x.userId !== p.userId) } })),
  handleParticipantState: (p) => set((s) => s.activeCall?.callId !== p.callId ? s : ({ activeCall: { ...s.activeCall, participants: s.activeCall.participants.map((x) => x.userId === p.fromUserId ? { ...x, ...p.state } : x) } })),
  handleNativeCallAction: async (action) => {
    const state = get();
    if (action.type === 'displayed') return;
    if (action.type === 'answer') {
      if (state.incomingDMCalls[action.callId]) {
        await state.answerDMCall(action.callId, true);
        return;
      }
      const call = state.activeCall;
      if (call?.callId === action.callId && call.callType === 'group' && call.status === 'ringing' && call.groupChatId) {
        state.joinGroupCall(call.callId, call.groupChatId, call.mediaType);
      }
      return;
    }
    if (action.type === 'decline') {
      if (state.incomingDMCalls[action.callId]) {
        await state.answerDMCall(action.callId, false);
        return;
      }
      if (state.activeCall?.callId === action.callId) state.endCall();
      return;
    }
    if (action.type === 'end' && state.activeCall?.callId === action.callId) {
      state.endCall();
    }
  },
  handleError: (error) => { if (get().activeCall || Object.keys(get().incomingDMCalls).length) set({ error }); },
}));
