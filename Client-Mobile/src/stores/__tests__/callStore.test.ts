jest.mock('@/lib/livekit-init', () => ({ ensureLiveKitGlobals: () => true, getLiveKitInitError: () => null }));
jest.mock('@/lib/api', () => ({ createAuthenticatedApi: () => mockApi }));
jest.mock('@/lib/audioSession', () => ({ acquireAudioSession: jest.fn(async () => {}), releaseAudioSession: jest.fn(async () => {}) }));
jest.mock('@/lib/notificationSounds', () => ({ startLoopingNotificationSound: jest.fn(async () => async () => {}) }));
jest.mock('@/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ notificationsEnabled: false }) } }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mockAuth } }));
jest.mock('@/stores/dmStore', () => ({ useDMStore: { getState: () => ({ conversations: [] }) } }));
jest.mock('@/stores/groupChatStore', () => ({ useGroupChatStore: { getState: () => ({ groups: [] }) } }));
jest.mock('livekit-client', () => ({ Room: jest.fn(() => mockRoom), RoomEvent: { Disconnected: 'disconnected', TrackSubscribed: 'subscribed', TrackUnsubscribed: 'unsubscribed' } }));

import { acquireAudioSession, releaseAudioSession } from '@/lib/audioSession';
import { useCallStore } from '../callStore';

const mockApi = { get: jest.fn(), post: jest.fn() };
let mockAuth = { user: { id: 'self' }, token: 'token', syncKey: 'key' };
const mockSocket = { connected: true, emit: jest.fn() };
const mockRoom = {
  on: jest.fn(), connect: jest.fn(), disconnect: jest.fn(async () => {}),
  localParticipant: { setMicrophoneEnabled: jest.fn(async () => {}), setCameraEnabled: jest.fn(async () => {}), videoTrackPublications: new Map() },
};
const incoming = { callId: 'call-1', conversationId: 'dm-1', callerId: 'peer', callerName: 'Peer', callerAvatar: null, mediaType: 'audio' as const };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockAuth = { user: { id: 'self' }, token: 'token', syncKey: 'key' };
  mockApi.get.mockResolvedValue({ data: { capability: { enabled: true, contexts: ['dm'] } } });
  mockApi.post.mockResolvedValue({ data: { ok: true, token: 'token', url: 'wss://media.invalid' } });
  mockRoom.connect.mockResolvedValue(undefined);
  useCallStore.setState(useCallStore.getInitialState());
  useCallStore.getState().setSocket(mockSocket as never);
  useCallStore.getState().handleIncomingDM(incoming);
});

afterEach(async () => { useCallStore.getState().endCall(); await flush(); jest.runOnlyPendingTimers(); jest.useRealTimers(); });

test('answers before media connection, starts native audio, and can end while connecting', async () => {
  let finishConnect!: () => void;
  mockRoom.connect.mockReturnValueOnce(new Promise<void>((resolve) => { finishConnect = resolve; }));
  const answering = useCallStore.getState().answerDMCall(incoming.callId, true);
  expect(mockSocket.emit).toHaveBeenCalledWith('call:answer', { callId: incoming.callId, accept: true });
  expect(useCallStore.getState().activeCall?.status).toBe('active');
  await flush();
  expect(acquireAudioSession).toHaveBeenCalledTimes(1);
  expect(mockRoom.connect).toHaveBeenCalledTimes(1);
  expect((acquireAudioSession as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(mockRoom.connect.mock.invocationCallOrder[0]);

  useCallStore.getState().endCall();
  finishConnect();
  await answering;
  await flush();
  expect(mockSocket.emit).toHaveBeenCalledWith('call:end', { callId: incoming.callId });
  expect(releaseAudioSession).toHaveBeenCalledTimes(1);
  expect(useCallStore.getState()).toMatchObject({ activeCall: null, connecting: false, error: null });
  useCallStore.getState().handleError('Call not found');
  expect(useCallStore.getState().error).toBeNull();
});

test('a media failure leaves a usable hang-up control and clears its error on end', async () => {
  mockRoom.connect.mockRejectedValueOnce(new Error('Signal error'));
  await useCallStore.getState().answerDMCall(incoming.callId, true);
  expect(useCallStore.getState()).toMatchObject({ activeCall: { callId: incoming.callId }, connecting: false, error: 'Signal error' });
  useCallStore.getState().endCall();
  await flush();
  expect(useCallStore.getState()).toMatchObject({ activeCall: null, error: null });
  expect(releaseAudioSession).toHaveBeenCalledTimes(1);
});

test('foreground recovery removes a call already ended on the server', async () => {
  useCallStore.setState({ activeCall: { callId: 'old-call', callType: 'dm', title: 'Peer', mediaType: 'audio', status: 'active', participants: [] }, error: 'Signal error' });
  mockApi.get.mockResolvedValueOnce({ data: { activeCalls: [] } });
  await useCallStore.getState().recoverActiveCalls();
  expect(useCallStore.getState()).toMatchObject({ activeCall: null, error: null });
  expect(mockSocket.emit).not.toHaveBeenCalledWith('call:end', { callId: 'old-call' });
});

test('recovery does not silently rejoin a call this device left', async () => {
  mockApi.get.mockResolvedValueOnce({ data: { activeCalls: [{
    callId: 'left-call', callType: 'dm', status: 'active', selfJoined: false, otherJoined: true,
    conversationId: 'dm-1', otherUser: { userId: 'peer', username: 'Peer' }, mediaType: 'audio',
  }] } });
  await useCallStore.getState().recoverActiveCalls();
  expect(useCallStore.getState().activeCall).toBeNull();
  expect(mockRoom.connect).not.toHaveBeenCalled();
});

test('an acceptance arriving before initiation still connects the mobile caller', async () => {
  await useCallStore.getState().handleDMAccepted({ callId: incoming.callId });
  useCallStore.getState().handleDMInitiated({ callId: incoming.callId, conversationId: incoming.conversationId, mediaType: 'audio' });
  await flush();
  expect(useCallStore.getState().activeCall?.status).toBe('active');
  expect(mockRoom.connect).toHaveBeenCalledTimes(1);
});

test('late recovery from an old account cannot restore its call', async () => {
  let finish!: (value: unknown) => void;
  mockApi.get.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const recovery = useCallStore.getState().recoverActiveCalls();
  mockAuth = { user: { id: 'other' }, token: 'other-token', syncKey: 'other-key' };
  finish({ data: { activeCalls: [{ callId: 'old-call', callType: 'dm', status: 'active', selfJoined: true }] } });
  await recovery;
  expect(useCallStore.getState().activeCall).toBeNull();
});

test('resetting call state on account switch dismisses and declines an incoming call', async () => {
  expect(useCallStore.getState().incomingDMCalls[incoming.callId]).toBeDefined();
  useCallStore.getState().endCall();
  await flush();
  expect(mockSocket.emit).toHaveBeenCalledWith('call:answer', { callId: incoming.callId, accept: false });
  expect(useCallStore.getState().incomingDMCalls).toEqual({});
});
