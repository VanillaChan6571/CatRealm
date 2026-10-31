import { create } from 'zustand';
import type { Socket } from 'socket.io-client';
import { playNotificationSound, type SoundType } from '../lib/notificationSounds';
import { useSettingsStore, registerOnAudioSettingsChanged, registerOnNoiseGateThresholdChanged } from './settingsStore';
import { useAuthStore } from './authStore';
import { createAuthenticatedApi } from '../lib/authApi';
import { buildAudioPipeline, rebuildAudioPipeline, type AudioPipeline } from '../lib/audioProcessing';
import { captureScreenShare } from '../lib/desktopCapture';
import { useMediaStore, registerOnCallMediaReplaced } from './mediaStore';

// Module-level audio pipeline state for calls.
let activeCallPipeline: AudioPipeline | null = null;
let activeCallRawStream: MediaStream | null = null;
let activeScreenShareStream: MediaStream | null = null;
let suppressNextScreenShareEndedSound = false;
let screenShareWasCameraEnabled = false;

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      activeCallPipeline?.resume();
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════════════

export type CallMediaType = 'audio' | 'video';
export type CallStatus = 'ringing' | 'active' | 'ended' | 'declined' | 'missed' | 'cancelled';

export interface IncomingDMCall {
  callId: string;
  conversationId: string;
  callerId: string;
  callerName: string;
  callerAvatar: string | null;
  mediaType: CallMediaType;
  receivedAt: number;
  privacyMode: boolean;
}

export interface IncomingGroupCall {
  callId: string;
  groupChatId: string;
  initiatorId: string;
  initiatorName: string;
  mediaType: CallMediaType;
  receivedAt: number;
  shouldNotify?: boolean;
}

/** Someone in a group call, as seen by any member (joined or not). */
export interface GroupCallRosterEntry {
  userId: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
}

export interface DMCallState {
  callId: string;
  conversationId: string;
  otherUserId: string;
  otherUsername: string;
  otherAvatar: string | null;
  mediaType: CallMediaType;
  status: CallStatus;
  startedAt: number;
  isInitiator: boolean;
  privacyMode: boolean;
  otherMuted?: boolean;
  otherDeafened?: boolean;
  otherVideoEnabled?: boolean;
  otherSharingScreen?: boolean;
  otherConnected?: boolean;
}

export interface GroupCallState {
  callId: string;
  groupChatId: string;
  groupName: string;
  groupAvatar: string | null;
  mediaType: CallMediaType;
  status: CallStatus;
  startedAt: number;
  isInitiator: boolean;
  participants: Array<{
    userId: string;
    username: string;
    displayName: string | null;
    avatar: string | null;
    muted?: boolean;
    deafened?: boolean;
    videoEnabled?: boolean;
    sharingScreen?: boolean;
  }>;
}

type CallScreenShareSource =
  | { kind: 'desktop'; sourceId: string }
  | { kind: 'device'; deviceId: string; audioDeviceId?: string | null };

interface CallState {
  // Active calls
  activeDMCall: DMCallState | null;
  activeGroupCall: GroupCallState | null;

  // Incoming calls (ringing)
  incomingDMCalls: Record<string, IncomingDMCall>;
  incomingGroupCalls: Record<string, IncomingGroupCall>;
  /** Who is in each group's running call, keyed by groupChatId. */
  groupCallRosters: Record<string, { callId: string; participants: GroupCallRosterEntry[] }>;
  pendingGroupCallMeta: {
    groupChatId: string;
    groupName: string;
    groupAvatar: string | null;
    mediaType: CallMediaType;
  } | null;

  localStream: MediaStream | null;

  // Call state
  isMuted: boolean;
  isDeafened: boolean;
  mutedBeforeDeafen: boolean;
  isVideoEnabled: boolean;
  isSharingScreen: boolean;
  notice: string | null;
  /** Shown after the other side declines; outlives the call (see CallDeclinedToast). */
  declinedNotice: { name: string; at: number } | null;
  dismissDeclinedNotice: () => void;

  // Speaking state (keyed by userId, updated by call panels)
  callSpeakingByUser: Record<string, boolean>;

  // Settings
  audioDeviceId: string | null;
  videoDeviceId: string | null;

  // Actions
  initiateCall: (conversationId: string, otherUserId: string, otherUsername: string, otherAvatar: string | null, mediaType: CallMediaType, privacyMode: boolean) => Promise<void>;
  initiateGroupCall: (groupChatId: string, groupName: string, groupAvatar: string | null, mediaType: CallMediaType) => Promise<void>;
  joinGroupCall: (call: {
    callId: string;
    groupChatId: string;
    groupName: string;
    groupAvatar: string | null;
    mediaType: CallMediaType;
  }) => Promise<void>;
  resumeDMCall: (call: {
    callId: string;
    conversationId: string;
    otherUserId: string;
    otherUsername: string;
    otherAvatar: string | null;
    mediaType: CallMediaType;
    otherJoined?: boolean;
  }) => Promise<void>;
  answerCall: (callId: string, accept: boolean) => void;
  endCall: (callId: string, reason?: string) => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  startVideo: (deviceId?: string) => Promise<void>;
  toggleVideo: () => void;
  startScreenShare: (source?: CallScreenShareSource) => Promise<void>;
  toggleScreenShare: () => void;
  setCallSpeaking: (userId: string, speaking: boolean) => void;

  // Socket handlers
  handleIncomingCall: (payload: {
    callId: string;
    conversationId: string;
    callerId: string;
    callerName: string;
    callerAvatar: string | null;
    mediaType: CallMediaType;
    privacyMode: boolean;
  }) => void;
  handleCallAccepted: (payload: { callId: string }) => void;
  handleCallDeclined: (payload: { callId: string; reason: string }) => void;
  handleRemoteCallStateUpdate: (payload: {
    callId: string;
    fromUserId: string;
    state: {
      muted?: boolean;
      deafened?: boolean;
      videoEnabled?: boolean;
      sharingScreen?: boolean;
    };
  }) => void;
  handleCallEnded: (payload: { callId: string; reason: string; duration?: number }) => void;
  handleDMParticipantLeft: (payload: { callId: string; userId: string; reason?: string }) => void;
  handleDMParticipantJoined: (payload: { callId: string; userId: string }) => Promise<void>;
  handleCallBusy: (payload: { conversationId: string }) => void;
  handleCallError: (payload: { error: string }) => void;
  handleGroupCallStarted: (payload: {
    callId: string;
    groupChatId: string;
    initiatorId: string;
    initiatorName: string;
    mediaType: CallMediaType;
  }) => void;
  handleGroupCallInitiated: (payload: {
    callId: string;
    groupChatId: string;
    mediaType: CallMediaType;
  }) => void;
  handleGroupCallJoined: (payload: {
    callId: string;
    participants: Array<{
      userId: string;
      username: string;
      displayName: string | null;
      avatar: string | null;
    }>;
  }) => Promise<void>;
  handleGroupCallParticipantJoined: (payload: {
    callId: string;
    userId: string;
    username: string;
    displayName: string | null;
    avatar: string | null;
  }) => void;
  handleGroupCallParticipantLeft: (payload: { callId: string; userId: string; duration: number }) => void;
  handleGroupCallEnded: (payload: { callId: string; reason: string; duration?: number }) => void;
  handleGroupCallRoster: (payload: { callId: string; groupChatId: string; participants: GroupCallRosterEntry[] }) => void;
  /** Loads the group's running call (if any) and its roster, e.g. after a reload. */
  fetchGroupCallRoster: (groupChatId: string) => Promise<void>;
  handleGroupCallError: (payload: { error: string }) => void;

  // Rejoin support
  lastEndedDMCall: {
    callId: string;
    conversationId: string;
    otherUserId: string;
    otherUsername: string;
    otherAvatar: string | null;
    mediaType: CallMediaType;
    endedAt: number;
    /** The call is still live, held by another of this user's devices. */
    onOtherDevice?: boolean;
  } | null;
  rejoinCall: () => Promise<void>;
  clearLastEndedCall: () => void;
  handleCallRejoined: (payload: { callId: string; otherJoined?: boolean }) => Promise<void>;
  // Multi-device: another of this user's devices answered/declined, or took the call over
  handleCallHandledElsewhere: (payload: { callId: string; reason?: string }) => void;
  handleCallMovedDevice: (payload: { callId: string }) => void;

  // Cleanup
  cleanup: () => void;
}

// ══════════════════════════════════════════════════════════════════════════════
// SOCKET REFERENCE
// ══════════════════════════════════════════════════════════════════════════════

let callSocket: Socket | null = null;

export function setCallSocket(socket: Socket) {
  callSocket = socket;
}

export function getCallSocket() {
  return callSocket;
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

function stopStream(stream: MediaStream | null) {
  if (!stream) return;
  stream.getTracks().forEach((track) => {
    track.stop();
  });
}

async function tryJoinCallLiveKit(
  callId: string,
  callType: 'dm' | 'group',
  mediaType: CallMediaType,
  muted: boolean,
  microphoneTrack?: MediaStreamTrack | null,
): Promise<boolean> {
  const socket = callSocket;
  if (!socket?.connected) return false;
  try {
    const joined = await useMediaStore.getState().joinCall({
      socket,
      callId,
      callType,
      mediaType,
      muted,
      microphoneTrack: microphoneTrack ?? null,
      microphoneTrackLabel: 'catrealm:call:processed-mic',
    });
    if (!joined) {
      useCallStore.setState({ notice: 'LiveKit media is unavailable for this call.' });
    }
    return joined;
  } catch {
    useCallStore.setState({ notice: 'LiveKit media failed to connect for this call.' });
    return false;
  }
}

function getCurrentUserId() {
  const authUserId = useAuthStore.getState().user?.id;
  if (authUserId) return authUserId;
  return localStorage.getItem('userId') || '';
}

function getRemoteShareSignalKey(callId: string, userId: string) {
  return `${callId}:${userId}`;
}

const lastRemoteShareSignalByParticipant = new Map<string, boolean>();

function clearRemoteShareSignalsForCall(callId: string) {
  const prefix = `${callId}:`;
  for (const key of Array.from(lastRemoteShareSignalByParticipant.keys())) {
    if (key.startsWith(prefix)) {
      lastRemoteShareSignalByParticipant.delete(key);
    }
  }
}


type CallSoundSettingKey =
  | 'soundVoiceMute'
  | 'soundVoiceUnmute'
  | 'soundVoiceDeafen'
  | 'soundVoiceUndeafen'
  | 'soundDMOutgoingCall'
  | 'soundScreenshareGoLive'
  | 'soundScreenshareUserJoin'
  | 'soundScreenshareUserLeft'
  | 'soundScreenshareEnded'
  | 'soundScreenshareStopped';

function playConfiguredCallSound(
  soundType: SoundType,
  settingKey: CallSoundSettingKey,
) {
  const settings = useSettingsStore.getState() as Record<string, any>;
  const soundsDisabled = settings.streamerMode && settings.streamerModeDisableSounds;
  if (soundsDisabled || !settings.notificationsEnabled) return;
  if (!settings[settingKey]) return;
  const volume = settings.soundVolumes?.[settingKey] ?? 60;
  playNotificationSound(soundType, volume);
}

function emitActiveCallStateUpdate(statePatch: {
  muted?: boolean;
  deafened?: boolean;
  videoEnabled?: boolean;
  sharingScreen?: boolean;
}) {
  const socket = getCallSocket();
  if (!socket?.connected) return;
  const { activeDMCall, activeGroupCall } = useCallStore.getState();
  if (activeDMCall?.status === 'active') {
    console.log('[Call Store] Emitting DM state update:', statePatch);
    socket.emit('call:state:update', {
      callId: activeDMCall.callId,
      state: statePatch,
    });
    return;
  }
  if (activeGroupCall?.status === 'active') {
    console.log('[Call Store] Emitting group call state update:', statePatch);
    socket.emit('gc:call:state:update', {
      callId: activeGroupCall.callId,
      state: statePatch,
    });
  }
}

function getCallAudioConstraint(): MediaTrackConstraints | boolean {
  const deviceId = useSettingsStore.getState().voiceInputDeviceId;
  if (!deviceId) return true;
  return {
    deviceId: { exact: deviceId },
  };
}

async function getCallUserMedia(mediaType: CallMediaType): Promise<MediaStream> {
  const audioConstraint = getCallAudioConstraint();
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: audioConstraint,
      video: mediaType === 'video',
    });
  } catch (error) {
    const maybeName = (error as { name?: string })?.name ?? '';
    const isInputSelectionError = maybeName === 'NotFoundError'
      || maybeName === 'OverconstrainedError'
      || maybeName === 'ConstraintNotSatisfiedError';
    if (!isInputSelectionError || audioConstraint === true) {
      throw error;
    }
    console.warn('[Call] Selected input device unavailable, falling back to default microphone');
    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: mediaType === 'video',
    });
  }
}

function getAudioPipelineOpts() {
  const s = useSettingsStore.getState();
  return {
    noiseGateEnabled: s.noiseGateEnabled,
    noiseGateThreshold: s.noiseGateThreshold,
    rnnoiseEnabled: s.rnnoiseEnabled,
  };
}

async function getProcessedCallStream(mediaType: CallMediaType): Promise<{
  rawStream: MediaStream;
  localStream: MediaStream;
  pipeline: AudioPipeline | null;
}> {
  const rawStream = await getCallUserMedia(mediaType);
  const pipeline = await buildAudioPipeline(rawStream, getAudioPipelineOpts());
  return {
    rawStream,
    localStream: pipeline?.processedStream ?? rawStream,
    pipeline,
  };
}

function mergeGroupParticipants(
  existing: GroupCallState['participants'],
  incoming: GroupCallState['participants'],
): GroupCallState['participants'] {
  const byId = new Map(existing.map((p) => [p.userId, p]));
  for (const participant of incoming) {
    const previous = byId.get(participant.userId);
    byId.set(participant.userId, {
      ...previous,
      ...participant,
      userId: participant.userId,
    });
  }
  return Array.from(byId.values());
}

function updateGroupParticipant(
  participants: GroupCallState['participants'],
  userId: string,
  patch: Partial<GroupCallState['participants'][number]>,
): GroupCallState['participants'] {
  const sanitizedPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  ) as Partial<GroupCallState['participants'][number]>;
  if (Object.keys(sanitizedPatch).length === 0) return participants;

  let changed = false;
  const next = participants.map((participant) => {
    if (participant.userId !== userId) return participant;
    changed = true;
    return { ...participant, ...sanitizedPatch };
  });
  if (changed) return next;
  return participants;
}

// ══════════════════════════════════════════════════════════════════════════════
// ZUSTAND STORE
// ══════════════════════════════════════════════════════════════════════════════

export const useCallStore = create<CallState>((set, get) => ({
  // Initial state
  activeDMCall: null,
  activeGroupCall: null,
  incomingDMCalls: {},
  incomingGroupCalls: {},
  groupCallRosters: {},
  pendingGroupCallMeta: null,
  localStream: null,
  isMuted: false,
  isDeafened: false,
  mutedBeforeDeafen: false,
  isVideoEnabled: false,
  isSharingScreen: false,
  notice: null,
  declinedNotice: null,
  dismissDeclinedNotice: () => set({ declinedNotice: null }),
  callSpeakingByUser: {},
  audioDeviceId: null,
  videoDeviceId: null,
  lastEndedDMCall: null,

  // ════════════════════════════════════════════════════════════════════════════
  // ACTIONS
  // ════════════════════════════════════════════════════════════════════════════

  initiateCall: async (conversationId, _otherUserId, otherUsername, _otherAvatar, mediaType, privacyMode) => {
    const socket = getCallSocket();
    if (!socket?.connected) {
      console.error('[Call] Socket not connected');
      return;
    }

    console.log(`[Call] Initiating ${mediaType} call to ${otherUsername}`);

    // Get user media (with audio processing pipeline)
    try {
      const { rawStream, localStream: stream, pipeline } = await getProcessedCallStream(mediaType);
      activeCallPipeline = pipeline;
      activeCallRawStream = rawStream;

      // Apply mute state to audio tracks
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !get().isMuted;
      });

      set({ localStream: stream, isVideoEnabled: mediaType === 'video', isSharingScreen: false });

      // Emit call initiation to server
      socket.emit('call:initiate', { conversationId, mediaType, privacyMode });

      // Play outgoing call sound
      const settings = useSettingsStore.getState();
      const soundsDisabled = settings.streamerMode && settings.streamerModeDisableSounds;
      if (!soundsDisabled && settings.notificationsEnabled) {
        playConfiguredCallSound('dm-outgoing-call', 'soundDMOutgoingCall');
      }
    } catch (error) {
      console.error('[Call] Failed to get user media:', error);
      alert('Microphone/camera access denied, or selected input device is unavailable. Please check permissions and Voice settings.');
    }
  },

  initiateGroupCall: async (groupChatId, groupName, groupAvatar, mediaType) => {
    const socket = getCallSocket();
    if (!socket?.connected) {
      console.error('[GroupCall] Socket not connected');
      return;
    }

    const { activeDMCall, activeGroupCall } = get();
    if (activeDMCall || activeGroupCall) {
      alert('You are already in a call.');
      return;
    }

    try {
      const { rawStream, localStream: stream, pipeline } = await getProcessedCallStream(mediaType);
      activeCallPipeline = pipeline;
      activeCallRawStream = rawStream;
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !get().isMuted;
      });
      set({
        localStream: stream,
        isVideoEnabled: mediaType === 'video',
        isSharingScreen: false,
        pendingGroupCallMeta: {
          groupChatId,
          groupName,
          groupAvatar,
          mediaType,
        },
      });
      socket.emit('gc:call:initiate', { groupChatId, mediaType });
    } catch (error) {
      console.error('[GroupCall] Failed to get user media:', error);
      alert('Microphone/camera access denied, or selected input device is unavailable. Please check permissions and Voice settings.');
    }
  },

  joinGroupCall: async (call) => {
    const socket = getCallSocket();
    if (!socket?.connected) {
      console.error('[GroupCall] Socket not connected');
      return;
    }
    const selfUserId = getCurrentUserId();
    const { activeDMCall, activeGroupCall } = get();
    if (activeDMCall) {
      alert('You are already in a DM call.');
      return;
    }
    if (activeGroupCall && activeGroupCall.callId !== call.callId) {
      alert('You are already in another group call.');
      return;
    }

    let localStream = get().localStream;
    if (!localStream) {
      try {
        const { rawStream, localStream: processed, pipeline } = await getProcessedCallStream(call.mediaType);
        activeCallPipeline = pipeline;
        activeCallRawStream = rawStream;
        localStream = processed;
        localStream.getAudioTracks().forEach((track) => {
          track.enabled = !get().isMuted;
        });
        set({ localStream, isVideoEnabled: call.mediaType === 'video', isSharingScreen: false });
      } catch (error) {
        console.error('[GroupCall] Failed to get user media:', error);
        alert('Microphone/camera access denied, or selected input device is unavailable. Please check permissions and Voice settings.');
        return;
      }
    }

    set((state) => ({
      activeGroupCall: {
        callId: call.callId,
        groupChatId: call.groupChatId,
        groupName: call.groupName,
        groupAvatar: call.groupAvatar,
        mediaType: call.mediaType,
        status: 'active',
        startedAt: Date.now(),
        isInitiator: state.activeGroupCall?.callId === call.callId
          ? state.activeGroupCall.isInitiator
          : false,
        participants: mergeGroupParticipants(
          state.activeGroupCall?.callId === call.callId
            ? (state.activeGroupCall?.participants ?? [])
            : [],
          [{
            userId: selfUserId,
            username: 'You',
            displayName: null,
            avatar: null,
            muted: state.isMuted,
            deafened: state.isDeafened,
            videoEnabled: state.isVideoEnabled,
            sharingScreen: state.isSharingScreen,
          }],
        ),
      },
      incomingGroupCalls: {
        ...state.incomingGroupCalls,
        [call.groupChatId]: {
          callId: call.callId,
          groupChatId: call.groupChatId,
          initiatorId: state.incomingGroupCalls[call.groupChatId]?.initiatorId || selfUserId,
          initiatorName: state.incomingGroupCalls[call.groupChatId]?.initiatorName || 'Group Call',
          mediaType: call.mediaType,
          receivedAt: state.incomingGroupCalls[call.groupChatId]?.receivedAt || Date.now(),
          shouldNotify: false,
        },
      },
    }));

    socket.emit('gc:call:join', { callId: call.callId });
    emitActiveCallStateUpdate({
      muted: get().isMuted,
      deafened: get().isDeafened,
      videoEnabled: get().isVideoEnabled,
      sharingScreen: get().isSharingScreen,
    });
  },

  resumeDMCall: async (call) => {
    const socket = getCallSocket();
    if (!socket?.connected) {
      console.error('[Call] Socket not connected');
      return;
    }

    const { activeDMCall, activeGroupCall } = get();
    if (activeGroupCall) {
      console.warn('[Call] Cannot resume DM call while group call is active');
      return;
    }
    if (activeDMCall && activeDMCall.callId !== call.callId) {
      console.warn('[Call] Another DM call is already active');
      return;
    }

    let localStream = get().localStream;
    if (!localStream) {
      try {
        const { rawStream, localStream: processed, pipeline } = await getProcessedCallStream(call.mediaType);
        activeCallPipeline = pipeline;
        activeCallRawStream = rawStream;
        localStream = processed;
        localStream.getAudioTracks().forEach((track) => {
          track.enabled = !get().isMuted;
        });
        set({ localStream, isVideoEnabled: call.mediaType === 'video', isSharingScreen: false });
      } catch (error) {
        console.error('[Call] Failed to get user media while resuming call:', error);
        return;
      }
    }

    set({
      activeDMCall: {
        callId: call.callId,
        conversationId: call.conversationId,
        otherUserId: call.otherUserId,
        otherUsername: call.otherUsername,
        otherAvatar: call.otherAvatar,
        mediaType: call.mediaType,
        status: 'active',
        startedAt: activeDMCall?.callId === call.callId ? activeDMCall.startedAt : Date.now(),
        isInitiator: activeDMCall?.callId === call.callId ? activeDMCall.isInitiator : false,
        privacyMode: false,
        otherMuted: activeDMCall?.callId === call.callId ? activeDMCall.otherMuted : false,
        otherDeafened: activeDMCall?.callId === call.callId ? activeDMCall.otherDeafened : false,
        otherVideoEnabled: activeDMCall?.callId === call.callId ? activeDMCall.otherVideoEnabled : (call.mediaType === 'video'),
        otherSharingScreen: activeDMCall?.callId === call.callId ? activeDMCall.otherSharingScreen : false,
        otherConnected: activeDMCall?.callId === call.callId ? activeDMCall.otherConnected : call.otherJoined !== false,
      },
    });

    emitActiveCallStateUpdate({
      muted: get().isMuted,
      deafened: get().isDeafened,
      videoEnabled: get().isVideoEnabled,
      sharingScreen: get().isSharingScreen,
    });
  },

  answerCall: (callId, accept) => {
    const socket = getCallSocket();
    if (!socket?.connected) return;

    const incomingCall = get().incomingDMCalls[callId];
    if (!incomingCall) return;

    console.log(`[Call] ${accept ? 'Accepting' : 'Declining'} call ${callId}`);

    if (accept) {
      getProcessedCallStream(incomingCall.mediaType)
        .then(async ({ rawStream, localStream: stream, pipeline }) => {
          activeCallPipeline = pipeline;
          activeCallRawStream = rawStream;
          // Apply mute state
          stream.getAudioTracks().forEach((track) => {
            track.enabled = !get().isMuted;
          });

          set({ localStream: stream, isVideoEnabled: incomingCall.mediaType === 'video', isSharingScreen: false });

          // Send accept to server
          socket.emit('call:answer', { callId, accept: true });

          // Move to active call
          set((state) => ({
            activeDMCall: {
              callId,
              conversationId: incomingCall.conversationId,
              otherUserId: incomingCall.callerId,
              otherUsername: incomingCall.callerName,
              otherAvatar: incomingCall.callerAvatar,
              mediaType: incomingCall.mediaType,
              privacyMode: incomingCall.privacyMode,
              status: 'active',
              startedAt: Date.now(),
              isInitiator: false,
              otherMuted: false,
              otherDeafened: false,
              otherVideoEnabled: incomingCall.mediaType === 'video',
              otherSharingScreen: false,
              otherConnected: true,
            },
            incomingDMCalls: Object.fromEntries(
              Object.entries(state.incomingDMCalls).filter(([id]) => id !== callId)
            ),
          }));
          emitActiveCallStateUpdate({
            muted: get().isMuted,
            deafened: get().isDeafened,
            videoEnabled: incomingCall.mediaType === 'video',
            sharingScreen: false,
          });

          // Try LiveKit SFU — callee side joins the same room as initiator
          const micTrack = stream.getAudioTracks()[0] ?? null;
          const sfuJoined = await tryJoinCallLiveKit(callId, 'dm', incomingCall.mediaType, get().isMuted, micTrack);
          if (sfuJoined) {
            console.log('[Call] Using LiveKit SFU for DM call (callee)', callId);
          }
        })
        .catch((error) => {
          console.error('[Call] Failed to get user media:', error);
          socket.emit('call:answer', { callId, accept: false });

          // Remove from incoming
          set((state) => ({
            incomingDMCalls: Object.fromEntries(
              Object.entries(state.incomingDMCalls).filter(([id]) => id !== callId)
            ),
          }));
        });
    } else {
      // Decline call
      socket.emit('call:answer', { callId, accept: false });

      // Remove from incoming
      set((state) => ({
        incomingDMCalls: Object.fromEntries(
          Object.entries(state.incomingDMCalls).filter(([id]) => id !== callId)
        ),
      }));
    }
  },

  endCall: (callId, reason = 'ended') => {
    const socket = getCallSocket();
    const { activeGroupCall } = get();
    if (!socket?.connected) {
      get().cleanup();
      return;
    }

    console.log(`[Call] Ending call ${callId}`);

    if (activeGroupCall?.callId === callId) {
      set((state) => {
        const existing = state.incomingGroupCalls[activeGroupCall.groupChatId];
        if (!existing || existing.callId !== callId) return {};
        return {
          incomingGroupCalls: {
            ...state.incomingGroupCalls,
            [activeGroupCall.groupChatId]: {
              ...existing,
              shouldNotify: false,
            },
          },
        };
      });
      socket.emit('gc:call:leave', { callId });
      get().cleanup();
      return;
    }

    // Save for potential rejoin — only when call was active (ringing cancels don't need rejoin)
    const { activeDMCall: dmCall } = get();
    if (dmCall && dmCall.status === 'active') {
      set({
        lastEndedDMCall: {
          callId: dmCall.callId,
          conversationId: dmCall.conversationId,
          otherUserId: dmCall.otherUserId,
          otherUsername: dmCall.otherUsername,
          otherAvatar: dmCall.otherAvatar,
          mediaType: dmCall.mediaType,
          endedAt: Date.now(),
        },
      });
    }
    socket.emit('call:end', { callId, reason });
    get().cleanup();
  },

  toggleMute: () => {
    const { localStream, isMuted, isDeafened } = get();
    // Deafened users stay muted until they undeafen.
    const nextMuted = isDeafened ? true : !isMuted;

    if (nextMuted === isMuted) return;

    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    void useMediaStore.getState().setMicrophoneMuted(nextMuted);

    set((state) => ({
      isMuted: nextMuted,
      activeGroupCall: state.activeGroupCall
        ? {
            ...state.activeGroupCall,
            participants: updateGroupParticipant(state.activeGroupCall.participants, getCurrentUserId(), {
              muted: nextMuted,
            }),
          }
        : state.activeGroupCall,
    }));
    emitActiveCallStateUpdate({ muted: nextMuted });
    playConfiguredCallSound(nextMuted ? 'voice-mute' : 'voice-unmute', nextMuted ? 'soundVoiceMute' : 'soundVoiceUnmute');
  },

  toggleDeafen: () => {
    const { isDeafened, isMuted, mutedBeforeDeafen } = get();
    const nextDeafened = !isDeafened;
    const restoreMuted = isDeafened ? mutedBeforeDeafen : isMuted;
    const nextMuted = nextDeafened ? true : restoreMuted;
    const nextMutedBeforeDeafen = nextDeafened ? isMuted : mutedBeforeDeafen;

    useMediaStore.getState().setDeafened(nextDeafened);
    void useMediaStore.getState().setMicrophoneMuted(nextMuted);

    // Also mute/unmute the local audio track so the processed stream matches
    get().localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });

    set((state) => ({
      isDeafened: nextDeafened,
      isMuted: nextMuted,
      mutedBeforeDeafen: nextMutedBeforeDeafen,
      activeGroupCall: state.activeGroupCall
        ? {
            ...state.activeGroupCall,
            participants: updateGroupParticipant(state.activeGroupCall.participants, getCurrentUserId(), {
              deafened: nextDeafened,
              muted: nextMuted,
            }),
          }
        : state.activeGroupCall,
    }));
    emitActiveCallStateUpdate({ deafened: nextDeafened, muted: nextMuted });
    playConfiguredCallSound(nextDeafened ? 'voice-deafen' : 'voice-undeafen', nextDeafened ? 'soundVoiceDeafen' : 'soundVoiceUndeafen');
  },

  startVideo: async (deviceId) => {
    try {
      await useMediaStore.getState().startCamera(deviceId);
      set((state) => ({
        isVideoEnabled: true,
        activeGroupCall: state.activeGroupCall
          ? {
              ...state.activeGroupCall,
              participants: updateGroupParticipant(state.activeGroupCall.participants, getCurrentUserId(), {
                videoEnabled: true,
              }),
            }
          : state.activeGroupCall,
      }));
      emitActiveCallStateUpdate({ videoEnabled: true });
    } catch (error) {
      console.error('[Call] Failed to enable camera:', error);
      alert('Camera access denied. Please check permissions.');
    }
  },

  toggleVideo: () => {
    const { isVideoEnabled } = get();

    if (!isVideoEnabled) {
      void get().startVideo();
    } else {
      void useMediaStore.getState().stopCamera().then(() => {
        set((state) => ({
          isVideoEnabled: false,
          activeGroupCall: state.activeGroupCall
            ? {
                ...state.activeGroupCall,
                participants: updateGroupParticipant(state.activeGroupCall.participants, getCurrentUserId(), {
                  videoEnabled: false,
                }),
              }
            : state.activeGroupCall,
        }));
        emitActiveCallStateUpdate({ videoEnabled: false });
      });
    }
  },

  startScreenShare: async (source) => {
    const { isSharingScreen, isVideoEnabled } = get();
    if (isSharingScreen) return;

    try {
      const { screenshareFps, screenshareResolution, screenshareAudio } = useSettingsStore.getState();
      const height = screenshareResolution;
      const width = Math.round((screenshareResolution * 16) / 9);
      const isElectron = Boolean(window.electron?.getDesktopSources);

      let screenStream: MediaStream;
      if (source?.kind === 'device') {
        const result = await captureScreenShare({
          kind: 'device',
          deviceId: source.deviceId,
          audioDeviceId: typeof source.audioDeviceId === 'string' ? source.audioDeviceId : undefined,
          width,
          height,
          frameRate: screenshareFps,
          includeAudio: source.audioDeviceId === undefined ? screenshareAudio : source.audioDeviceId !== null,
        });
        screenStream = result.stream;
      } else if (isElectron && source?.kind === 'desktop') {
        const result = await captureScreenShare({
          kind: 'desktop',
          sourceId: source.sourceId,
          width,
          height,
          frameRate: screenshareFps,
          includeAudio: screenshareAudio,
        });
        screenStream = result.stream;
      } else {
        const result = await captureScreenShare({
          kind: 'browser',
          width,
          height,
          frameRate: screenshareFps,
          includeAudio: screenshareAudio,
        });
        screenStream = result.stream;
      }

      const videoTrack = screenStream.getVideoTracks()[0];
      if (!videoTrack) return;

      activeScreenShareStream = screenStream;
      screenShareWasCameraEnabled = isVideoEnabled;

      // Stop camera if it was on, then publish screen share via LiveKit
      if (isVideoEnabled) {
        await useMediaStore.getState().stopCamera();
      }
      await useMediaStore.getState().startScreenShare(screenStream, 'catrealm');

      set((state) => ({
        isSharingScreen: true,
        isVideoEnabled: false,
        activeGroupCall: state.activeGroupCall
          ? {
              ...state.activeGroupCall,
              participants: updateGroupParticipant(state.activeGroupCall.participants, getCurrentUserId(), {
                sharingScreen: true,
                videoEnabled: false,
              }),
            }
          : state.activeGroupCall,
      }));
      emitActiveCallStateUpdate({ sharingScreen: true, videoEnabled: false });
      playConfiguredCallSound('screenshare-go-live', 'soundScreenshareGoLive');

      videoTrack.onended = async () => {
        console.log('[Call Store] Screen share track ended (onended event fired)');
        const shouldPlayEndedSound = !suppressNextScreenShareEndedSound;
        suppressNextScreenShareEndedSound = false;
        const wasCameraEnabled = screenShareWasCameraEnabled;
        screenShareWasCameraEnabled = false;
        activeScreenShareStream = null;

        await useMediaStore.getState().stopScreenShare();

        let cameraRestored = false;
        if (wasCameraEnabled) {
          try {
            await useMediaStore.getState().startCamera();
            cameraRestored = true;
          } catch {
            // camera restore failed, that's OK
          }
        }

        const latest = get();
        set((state) => ({
          isSharingScreen: false,
          isVideoEnabled: cameraRestored,
          activeGroupCall: state.activeGroupCall
            ? {
                ...state.activeGroupCall,
                participants: updateGroupParticipant(state.activeGroupCall.participants, getCurrentUserId(), {
                  sharingScreen: false,
                  videoEnabled: cameraRestored,
                }),
              }
            : state.activeGroupCall,
        }));
        emitActiveCallStateUpdate({ sharingScreen: false, videoEnabled: cameraRestored });
        if (shouldPlayEndedSound && (latest.activeDMCall || latest.activeGroupCall)) {
          playConfiguredCallSound('screenshare-ended', 'soundScreenshareEnded');
        }
      };
    } catch (error) {
      console.error('[Call] Failed to start screen share:', error);
    }
  },

  toggleScreenShare: async () => {
    const { isSharingScreen } = get();

    console.log('[Call Store] toggleScreenShare called, current state:', isSharingScreen);

    if (!isSharingScreen) {
      await get().startScreenShare();
      return;
    }

    // Stop screen sharing
    console.log('[Call Store] Stopping screen share');
    suppressNextScreenShareEndedSound = true;
    const wasCameraEnabled = screenShareWasCameraEnabled;
    screenShareWasCameraEnabled = false;

    await useMediaStore.getState().stopScreenShare();
    activeScreenShareStream?.getTracks().forEach((track) => track.stop());
    activeScreenShareStream = null;

    let cameraRestored = false;
    if (wasCameraEnabled) {
      try {
        await useMediaStore.getState().startCamera();
        cameraRestored = true;
      } catch {
        // camera restore failed
      }
    }

    // Update state
    set((state) => ({
      isSharingScreen: false,
      isVideoEnabled: cameraRestored,
      activeGroupCall: state.activeGroupCall
        ? {
            ...state.activeGroupCall,
            participants: updateGroupParticipant(state.activeGroupCall.participants, getCurrentUserId(), {
              sharingScreen: false,
              videoEnabled: cameraRestored,
            }),
          }
        : state.activeGroupCall,
    }));
    emitActiveCallStateUpdate({ sharingScreen: false, videoEnabled: cameraRestored });
    playConfiguredCallSound('screenshare-stopped', 'soundScreenshareStopped');
  },

  // ════════════════════════════════════════════════════════════════════════════
  // SOCKET HANDLERS
  // ════════════════════════════════════════════════════════════════════════════

  handleIncomingCall: (payload) => {
    console.log('[Call] Incoming call:', payload);

    // Busy on this device: don't ring here, but don't decline either — the
    // user's other devices may still answer. The server times the call out.
    const { activeDMCall, activeGroupCall } = get();
    if (activeDMCall || activeGroupCall) {
      return;
    }

    // Add to incoming calls
    set((state) => ({
      incomingDMCalls: {
        ...state.incomingDMCalls,
        [payload.callId]: {
          callId: payload.callId,
          conversationId: payload.conversationId,
          callerId: payload.callerId,
          callerName: payload.callerName,
          callerAvatar: payload.callerAvatar,
          mediaType: payload.mediaType,
          privacyMode: payload.privacyMode,
          receivedAt: Date.now(),
        },
      },
    }));

    // Fallback local dismiss in case the server's ringing timeout (60s) never
    // reaches this device. Never decline from here: with several devices signed
    // in, an unattended device must not reject a call another device answered.
    setTimeout(() => {
      if (!get().incomingDMCalls[payload.callId]) return;
      set((state) => ({
        incomingDMCalls: Object.fromEntries(
          Object.entries(state.incomingDMCalls).filter(([id]) => id !== payload.callId)
        ),
      }));
    }, 65000);
  },

  handleCallAccepted: async (payload) => {
    console.log('[Call] Call accepted:', payload.callId);

    const socket = getCallSocket();
    if (!socket) return;

    const { activeDMCall } = get();
    if (!activeDMCall || activeDMCall.callId !== payload.callId) return;

    // Update status
    set((state) => ({
      activeDMCall: state.activeDMCall
        ? { ...state.activeDMCall, status: 'active' as CallStatus, otherConnected: true }
        : null,
    }));

    emitActiveCallStateUpdate({
      muted: get().isMuted,
      deafened: get().isDeafened,
      videoEnabled: get().isVideoEnabled,
      sharingScreen: get().isSharingScreen,
    });

    // Try LiveKit SFU — if central has LiveKit enabled both sides join the same room
    const micTrack = get().localStream?.getAudioTracks()[0] ?? null;
    const sfuJoined = await tryJoinCallLiveKit(activeDMCall.callId, 'dm', activeDMCall.mediaType, get().isMuted, micTrack);
    if (sfuJoined) {
      console.log('[Call] Using LiveKit SFU for DM call', activeDMCall.callId);
    }
  },

  handleCallDeclined: (payload) => {
    console.log('[Call] Call declined:', payload);
    const call = get().activeDMCall;
    if (call?.callId !== payload.callId) return;
    get().cleanup();
    // Not alert(): a native dialog breaks keyboard focus in Electron on Windows.
    set({ declinedNotice: { name: call.otherUsername, at: Date.now() } });
  },

  handleRemoteCallStateUpdate: (payload) => {
    console.log('[Call Store] Remote state update received:', payload);
    const soundsToPlay: Array<{ soundType: SoundType; settingKey: CallSoundSettingKey }> = [];
    const signaledSharing = typeof payload.state?.sharingScreen === 'boolean'
      ? payload.state.sharingScreen
      : null;
    if (signaledSharing !== null) {
      const signalKey = getRemoteShareSignalKey(payload.callId, payload.fromUserId);
      const previousSignal = lastRemoteShareSignalByParticipant.get(signalKey);
      if (previousSignal === undefined) {
        if (signaledSharing) {
          soundsToPlay.push({ soundType: 'screenshare-user-join', settingKey: 'soundScreenshareUserJoin' });
        }
      } else if (previousSignal !== signaledSharing) {
        soundsToPlay.push({
          soundType: signaledSharing ? 'screenshare-user-join' : 'screenshare-user-left',
          settingKey: signaledSharing ? 'soundScreenshareUserJoin' : 'soundScreenshareUserLeft',
        });
      }
      lastRemoteShareSignalByParticipant.set(signalKey, signaledSharing);
    }
    set((state) => {
      const next: Partial<CallState> = {};

      const activeDM = state.activeDMCall;
      if (activeDM && activeDM.callId === payload.callId && activeDM.otherUserId === payload.fromUserId) {
        const newState = {
          ...activeDM,
          otherMuted: typeof payload.state?.muted === 'boolean' ? payload.state.muted : activeDM.otherMuted,
          otherDeafened: typeof payload.state?.deafened === 'boolean' ? payload.state.deafened : activeDM.otherDeafened,
          otherVideoEnabled: typeof payload.state?.videoEnabled === 'boolean' ? payload.state.videoEnabled : activeDM.otherVideoEnabled,
          otherSharingScreen: typeof payload.state?.sharingScreen === 'boolean' ? payload.state.sharingScreen : activeDM.otherSharingScreen,
        };
        console.log('[Call Store] Updated DM call state:', {
          otherVideoEnabled: newState.otherVideoEnabled,
          otherSharingScreen: newState.otherSharingScreen,
        });
        next.activeDMCall = newState;
      }

      const activeGroup = state.activeGroupCall;
      if (activeGroup && activeGroup.callId === payload.callId) {
        const participantPatch: Partial<GroupCallState['participants'][number]> = {};
        if (typeof payload.state?.muted === 'boolean') participantPatch.muted = payload.state.muted;
        if (typeof payload.state?.deafened === 'boolean') participantPatch.deafened = payload.state.deafened;
        if (typeof payload.state?.videoEnabled === 'boolean') participantPatch.videoEnabled = payload.state.videoEnabled;
        if (typeof payload.state?.sharingScreen === 'boolean') participantPatch.sharingScreen = payload.state.sharingScreen;
        if (Object.keys(participantPatch).length === 0) return Object.keys(next).length > 0 ? next : {};

        next.activeGroupCall = {
          ...activeGroup,
          participants: updateGroupParticipant(activeGroup.participants, payload.fromUserId, participantPatch),
        };
      }

      return Object.keys(next).length > 0 ? next : {};
    });
    soundsToPlay.forEach((sound) => playConfiguredCallSound(sound.soundType, sound.settingKey));
  },

  handleCallEnded: (payload) => {
    console.log('[Call] Call ended:', payload.callId, payload.reason);
    clearRemoteShareSignalsForCall(payload.callId);

    // 'left_call' = we left but call may still be active; keep rejoin offer open
    // Any other reason = call is fully over; clear the rejoin offer
    if (payload.reason !== 'left_call') {
      set((s) => s.lastEndedDMCall?.callId === payload.callId ? { lastEndedDMCall: null } : {});
    }
    set((s) => s.incomingDMCalls[payload.callId]
      ? { incomingDMCalls: Object.fromEntries(Object.entries(s.incomingDMCalls).filter(([id]) => id !== payload.callId)) }
      : {});

    const { activeDMCall, activeGroupCall, incomingDMCalls } = get();
    if (activeDMCall?.callId === payload.callId || activeGroupCall?.callId === payload.callId || incomingDMCalls[payload.callId]) {
      get().cleanup();
    }

    if (payload.duration) {
      const minutes = Math.floor(payload.duration / 60);
      const seconds = payload.duration % 60;
      console.log(`[Call] Call duration: ${minutes}m ${seconds}s`);
    }
  },

  handleDMParticipantLeft: (payload) => {
    const { activeDMCall } = get();
    if (!activeDMCall || activeDMCall.callId !== payload.callId || activeDMCall.otherUserId !== payload.userId) {
      return;
    }
    clearRemoteShareSignalsForCall(payload.callId);
    // The server keeps the remaining participant in the call for three minutes.
    set({ activeDMCall: { ...activeDMCall, otherConnected: false, otherSharingScreen: false, otherVideoEnabled: false } });
  },

  handleDMParticipantJoined: async (payload) => {
    const { activeDMCall } = get();

    if (activeDMCall && activeDMCall.callId === payload.callId && activeDMCall.otherUserId === payload.userId) {
      set({ activeDMCall: { ...activeDMCall, otherConnected: true } });
    }
  },

  handleCallBusy: (payload) => {
    console.log('[Call] User is busy:', payload.conversationId);
    alert('The user is currently in another call.');
    get().cleanup();
  },

  handleCallError: (payload) => {
    console.error('[Call] Error:', payload.error);
    alert(`Call error: ${payload.error}`);
    get().cleanup();
  },

  handleGroupCallStarted: (payload) => {
    set((state) => {
      const selfUserId = getCurrentUserId();
      if (payload.initiatorId === selfUserId) {
        return {};
      }

      const isAlreadyInThisCall = !!state.activeGroupCall
        && state.activeGroupCall.status === 'active'
        && (
          state.activeGroupCall.callId === payload.callId
          || state.activeGroupCall.groupChatId === payload.groupChatId
        );
      if (isAlreadyInThisCall) {
        return {};
      }

      return {
        incomingGroupCalls: {
          ...state.incomingGroupCalls,
          [payload.groupChatId]: {
            callId: payload.callId,
            groupChatId: payload.groupChatId,
            initiatorId: payload.initiatorId,
            initiatorName: payload.initiatorName,
            mediaType: payload.mediaType,
            receivedAt: Date.now(),
            shouldNotify: true,
          },
        },
      };
    });
  },

  handleGroupCallInitiated: (payload) => {
    const selfUserId = getCurrentUserId();
    const pending = get().pendingGroupCallMeta;
    const selfUser = useAuthStore.getState().user;
    const selfName = selfUser?.displayName || selfUser?.username || 'You';
    set((state) => ({
      activeGroupCall: {
        callId: payload.callId,
        groupChatId: payload.groupChatId,
        groupName: pending?.groupChatId === payload.groupChatId ? pending.groupName : (state.activeGroupCall?.groupName || 'Group Chat'),
        groupAvatar: pending?.groupChatId === payload.groupChatId ? pending.groupAvatar : (state.activeGroupCall?.groupAvatar || null),
        mediaType: payload.mediaType,
        status: 'active',
        startedAt: Date.now(),
        isInitiator: true,
        participants: mergeGroupParticipants(
          state.activeGroupCall?.callId === payload.callId
            ? (state.activeGroupCall?.participants ?? [])
            : [],
          [{
          userId: selfUserId,
          username: 'You',
          displayName: null,
          avatar: null,
          muted: state.isMuted,
          deafened: state.isDeafened,
          videoEnabled: state.isVideoEnabled,
          sharingScreen: state.isSharingScreen,
          }],
        ),
      },
      incomingGroupCalls: {
        ...state.incomingGroupCalls,
        [payload.groupChatId]: {
          callId: payload.callId,
          groupChatId: payload.groupChatId,
          initiatorId: selfUserId,
          initiatorName: selfName,
          mediaType: payload.mediaType,
          receivedAt: Date.now(),
          shouldNotify: false,
        },
      },
      pendingGroupCallMeta: null,
    }));
    emitActiveCallStateUpdate({
      muted: get().isMuted,
      deafened: get().isDeafened,
      videoEnabled: get().isVideoEnabled,
      sharingScreen: get().isSharingScreen,
    });

    // The starter joins the call's media room too. Only joiners did (in
    // handleGroupCallJoined), so whoever started a group call had no audio.
    const micTrack = get().localStream?.getAudioTracks()[0] ?? null;
    void tryJoinCallLiveKit(payload.callId, 'group', payload.mediaType, get().isMuted, micTrack).then((sfuJoined) => {
      if (sfuJoined) console.log('[GroupCall] Using LiveKit SFU for group call', payload.callId);
    });
  },

  handleGroupCallJoined: async (payload) => {
    const socket = getCallSocket();
    if (!socket) return;
    const selfUserId = getCurrentUserId();
    const { activeGroupCall } = get();
    if (!activeGroupCall || activeGroupCall.callId !== payload.callId) return;

    const incomingParticipants = payload.participants
      .filter((participant) => participant.userId !== selfUserId)
      .map((participant) => ({
        ...participant,
        muted: false,
        deafened: false,
        videoEnabled: activeGroupCall.mediaType === 'video',
        sharingScreen: false,
      }));

    set((state) => ({
      activeGroupCall: state.activeGroupCall && state.activeGroupCall.callId === payload.callId
        ? {
            ...state.activeGroupCall,
            participants: mergeGroupParticipants(state.activeGroupCall.participants, incomingParticipants),
          }
        : state.activeGroupCall,
    }));

    // Try LiveKit SFU for group call — all participants join the same room
    const micTrack = get().localStream?.getAudioTracks()[0] ?? null;
    const sfuJoined = await tryJoinCallLiveKit(payload.callId, 'group', activeGroupCall.mediaType, get().isMuted, micTrack);
    if (sfuJoined) {
      console.log('[GroupCall] Using LiveKit SFU for group call', payload.callId);
    }
  },

  handleGroupCallParticipantJoined: (payload) => {
    const selfUserId = getCurrentUserId();
    if (!payload?.userId || payload.userId === selfUserId) return;
    const { activeGroupCall } = get();
    if (!activeGroupCall || activeGroupCall.callId !== payload.callId) return;
    set((state) => {
      if (!state.activeGroupCall || state.activeGroupCall.callId !== payload.callId) return {};
      return {
        activeGroupCall: {
          ...state.activeGroupCall,
          participants: mergeGroupParticipants(state.activeGroupCall.participants, [{
            userId: payload.userId,
            username: payload.username,
            displayName: payload.displayName,
            avatar: payload.avatar,
            muted: false,
            deafened: false,
            videoEnabled: state.activeGroupCall.mediaType === 'video',
            sharingScreen: false,
          }]),
        },
      };
    });
    // Re-broadcast local call flags when someone joins so newcomers get immediate state parity.
    emitActiveCallStateUpdate({
      muted: get().isMuted,
      deafened: get().isDeafened,
      videoEnabled: get().isVideoEnabled,
      sharingScreen: get().isSharingScreen,
    });
  },

  handleGroupCallParticipantLeft: (payload) => {
    const activeGroupCall = get().activeGroupCall;
    const participant = activeGroupCall?.callId === payload.callId
      ? activeGroupCall.participants.find((item) => item.userId === payload.userId)
      : null;
    const signalKey = getRemoteShareSignalKey(payload.callId, payload.userId);
    const hadSignaledSharing = lastRemoteShareSignalByParticipant.get(signalKey) === true;
    lastRemoteShareSignalByParticipant.delete(signalKey);
    if (participant?.sharingScreen || hadSignaledSharing) {
      playConfiguredCallSound('screenshare-user-left', 'soundScreenshareUserLeft');
    }
    set((state) => {
      if (!state.activeGroupCall || state.activeGroupCall.callId !== payload.callId) return {};
      return {
        activeGroupCall: {
          ...state.activeGroupCall,
          participants: state.activeGroupCall.participants.filter((participant) => participant.userId !== payload.userId),
        },
      };
    });
  },

  handleGroupCallEnded: (payload) => {
    clearRemoteShareSignalsForCall(payload.callId);
    set((state) => ({
      incomingGroupCalls: Object.fromEntries(
        Object.entries(state.incomingGroupCalls).filter(([, call]) => call.callId !== payload.callId)
      ),
      groupCallRosters: Object.fromEntries(
        Object.entries(state.groupCallRosters).filter(([, roster]) => roster.callId !== payload.callId)
      ),
    }));
    if (get().activeGroupCall?.callId === payload.callId) {
      get().cleanup();
    }
  },

  handleGroupCallRoster: (payload) => {
    set((state) => ({
      groupCallRosters: {
        ...state.groupCallRosters,
        [payload.groupChatId]: { callId: payload.callId, participants: payload.participants },
      },
    }));
  },

  fetchGroupCallRoster: async (groupChatId) => {
    try {
      const res = await createAuthenticatedApi().get(`/api/calls/group/${encodeURIComponent(groupChatId)}/active`);
      const call = res.data?.call as {
        callId: string;
        groupChatId: string;
        mediaType: CallMediaType;
        initiatorId: string;
        participants: GroupCallRosterEntry[];
      } | null;
      set((state) => {
        const groupCallRosters = { ...state.groupCallRosters };
        const incomingGroupCalls = { ...state.incomingGroupCalls };
        if (!call) {
          delete groupCallRosters[groupChatId];
          // A listed call the server no longer has is stale (we missed its end).
          if (incomingGroupCalls[groupChatId] && state.activeGroupCall?.groupChatId !== groupChatId) {
            delete incomingGroupCalls[groupChatId];
          }
          return { groupCallRosters, incomingGroupCalls };
        }
        groupCallRosters[groupChatId] = { callId: call.callId, participants: call.participants };
        if (!incomingGroupCalls[groupChatId]) {
          // Opened the chat after the call started (e.g. after a reload): list it
          // quietly so the call pane offers Join without ringing.
          const initiator = call.participants.find((p) => p.userId === call.initiatorId);
          incomingGroupCalls[groupChatId] = {
            callId: call.callId,
            groupChatId,
            initiatorId: call.initiatorId,
            initiatorName: initiator?.displayName || initiator?.username || 'Someone',
            mediaType: call.mediaType,
            receivedAt: Date.now(),
            shouldNotify: false,
          };
        }
        return { groupCallRosters, incomingGroupCalls };
      });
    } catch {
      // Best effort: the roster event keeps it current while connected.
    }
  },

  handleGroupCallError: (payload) => {
    console.error('[GroupCall] Error:', payload.error);
    alert(`Group call error: ${payload.error}`);
    if (get().activeGroupCall) {
      get().cleanup();
    }
  },

  // ════════════════════════════════════════════════════════════════════════════
  // REJOIN
  // ════════════════════════════════════════════════════════════════════════════

  rejoinCall: async () => {
    const { lastEndedDMCall } = get();
    if (!lastEndedDMCall) return;

    const socket = getCallSocket();
    if (!socket?.connected) return;

    socket.emit('call:rejoin', { callId: lastEndedDMCall.callId });
  },

  clearLastEndedCall: () => {
    set({ lastEndedDMCall: null });
  },

  handleCallRejoined: async (payload) => {
    const { lastEndedDMCall } = get();
    if (!lastEndedDMCall || lastEndedDMCall.callId !== payload.callId) return;

    set({ lastEndedDMCall: null });

    await get().resumeDMCall({
      callId: lastEndedDMCall.callId,
      conversationId: lastEndedDMCall.conversationId,
      otherUserId: lastEndedDMCall.otherUserId,
      otherUsername: lastEndedDMCall.otherUsername,
      otherAvatar: lastEndedDMCall.otherAvatar,
      mediaType: lastEndedDMCall.mediaType,
      // Rejoining while the other person is away keeps them shown as away.
      otherJoined: payload.otherJoined,
    });

    const { activeDMCall } = get();
    if (!activeDMCall) return;
    const micTrack = get().localStream?.getAudioTracks()[0] ?? null;
    const sfuJoined = await tryJoinCallLiveKit(activeDMCall.callId, 'dm', activeDMCall.mediaType, get().isMuted, micTrack);
    if (sfuJoined) {
      console.log('[Call] Rejoined call via LiveKit SFU', activeDMCall.callId);
    }
  },

  handleCallHandledElsewhere: (payload) => {
    if (!get().incomingDMCalls[payload.callId]) return;
    console.log('[Call] Call handled on another device:', payload);
    set((state) => ({
      incomingDMCalls: Object.fromEntries(
        Object.entries(state.incomingDMCalls).filter(([id]) => id !== payload.callId)
      ),
    }));
  },

  handleCallMovedDevice: (payload) => {
    const { activeDMCall } = get();
    if (!activeDMCall || activeDMCall.callId !== payload.callId) return;
    console.log('[Call] Call moved to another device:', payload.callId);
    clearRemoteShareSignalsForCall(payload.callId);
    // Step aside locally without call:end — the call continues on the other device.
    get().cleanup();
    set({
      lastEndedDMCall: {
        callId: activeDMCall.callId,
        conversationId: activeDMCall.conversationId,
        otherUserId: activeDMCall.otherUserId,
        otherUsername: activeDMCall.otherUsername,
        otherAvatar: activeDMCall.otherAvatar,
        mediaType: activeDMCall.mediaType,
        endedAt: Date.now(),
        onOtherDevice: true,
      },
    });
  },

  // ════════════════════════════════════════════════════════════════════════════
  // SETTINGS
  // ════════════════════════════════════════════════════════════════════════════

  setCallSpeaking: (userId, speaking) => {
    set((s) => ({
      callSpeakingByUser: { ...s.callSpeakingByUser, [userId]: speaking },
    }));
  },

  // ════════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ════════════════════════════════════════════════════════════════════════════

  cleanup: () => {
    const { activeDMCall, activeGroupCall } = get();

    // Disconnect LiveKit room if active for this call
    const mediaStore = useMediaStore.getState();
    if (activeDMCall?.callId) {
      mediaStore.leave('dm', activeDMCall.callId);
    } else if (activeGroupCall?.callId) {
      mediaStore.leave('group', activeGroupCall.callId);
    }

    // Destroy audio processing pipeline, stop raw stream
    activeCallPipeline?.destroy();
    activeCallPipeline = null;
    stopStream(activeCallRawStream);
    activeCallRawStream = null;
    stopStream(activeScreenShareStream);
    activeScreenShareStream = null;
    suppressNextScreenShareEndedSound = false;
    screenShareWasCameraEnabled = false;
    lastRemoteShareSignalByParticipant.clear();

    // Reset state
    set({
      activeDMCall: null,
      activeGroupCall: null,
      pendingGroupCallMeta: null,
      localStream: null,
      isSharingScreen: false,
      isVideoEnabled: false,
      notice: null,
      callSpeakingByUser: {},
    });
  },
}));

// ── Audio processing hot-swap ──────────────────────────────────────────────

export async function rebuildCallAudioProcessing(): Promise<void> {
  const state = useCallStore.getState();
  if (!activeCallRawStream) return;
  const { activeDMCall, activeGroupCall } = state;
  if (!activeDMCall && !activeGroupCall) return;

  const { pipeline, processedTrack } = await rebuildAudioPipeline(
    activeCallPipeline,
    activeCallRawStream,
    getAudioPipelineOpts(),
  );
  activeCallPipeline = pipeline;

  const processedStream = pipeline ? pipeline.processedStream : activeCallRawStream;
  const isMuted = state.isMuted;

  // Replace audio track on the LiveKit microphone publication
  const mediaSession = useMediaStore.getState().activeSession;
  const publication = mediaSession?.localMicrophonePublication;
  if (publication && processedTrack) {
    try {
      await (publication.track as any)?.replaceTrack(processedTrack);
      if (processedTrack) processedTrack.enabled = !isMuted;
    } catch {
      // ignore replacement errors
    }
  }

  useCallStore.setState({ localStream: processedStream });
}

registerOnAudioSettingsChanged(() => { void rebuildCallAudioProcessing(); });

// Same account joined the DM call's media room from another device: step aside
// instead of sitting in a call with no media (Discord-style device handoff).
registerOnCallMediaReplaced(({ callId, callType }) => {
  if (callType !== 'dm') return;
  useCallStore.getState().handleCallMovedDevice({ callId });
});

// Live threshold update — no rebuild needed
registerOnNoiseGateThresholdChanged((db) => {
  activeCallPipeline?.updateNoiseGateThreshold(db);
});
