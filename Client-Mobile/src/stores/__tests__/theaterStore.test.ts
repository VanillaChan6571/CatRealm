jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mockAuth } }));
jest.mock('@/stores/serverStore', () => ({ useServerStore: { getState: () => ({ activeServerId: 'realm', byId: () => ({ url: 'https://realm.invalid', token: 'realm-token' }) }) } }));
jest.mock('@/stores/blockedUsersStore', () => ({ useBlockedUsersStore: { getState: () => ({ isBlocked: (id: string) => id === 'blocked' }), subscribe: jest.fn() } }));
jest.mock('@/lib/api', () => ({ createApi: () => mockApi }));
jest.mock('@/lib/socket', () => ({ getSocket: () => mockSocket }));
jest.mock('@/lib/notificationSounds', () => ({ setTheaterSessionActive: jest.fn() }));
jest.mock('@/lib/livekit-init', () => ({ ensureLiveKitGlobals: () => true, getLiveKitInitError: () => null }));
jest.mock('@/lib/audioSession', () => ({ acquireAudioSession: jest.fn(async () => {}), releaseAudioSession: jest.fn(async () => {}) }));
jest.mock('livekit-client', () => ({ Room: jest.fn(() => mockRoom), RoomEvent: { Disconnected: 'disconnected', TrackSubscribed: 'track' } }));

import { useTheaterStore } from '../theaterStore';
import { acquireAudioSession, releaseAudioSession } from '@/lib/audioSession';

const mockAuth = { user: { id: 'A', accountType: 'central' }, token: 'central-token', syncKey: 'key' };
const mockApi = { get: jest.fn(), post: jest.fn() };
const mockSocket = { emit: jest.fn(), connected: true, timeout: jest.fn(), on: jest.fn(), off: jest.fn() };
const mockRoom = {
  on: jest.fn(), connect: jest.fn(), disconnect: jest.fn(),
  localParticipant: { setMicrophoneEnabled: jest.fn() }, remoteParticipants: new Map(),
};
let acknowledge: (value: unknown) => void;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
beforeEach(async () => {
  useTheaterStore.getState().leaveTheater();
  await flush();
  jest.clearAllMocks();
  mockRoom.remoteParticipants.clear();
  mockApi.get.mockResolvedValue({ data: { capability: { enabled: true, publicUrl: 'wss://media.invalid' } } });
  mockApi.post.mockResolvedValue({ data: { token: 'media-token' } });
  mockRoom.connect.mockResolvedValue(undefined);
  mockRoom.disconnect.mockReset().mockResolvedValue(undefined);
  mockRoom.localParticipant.setMicrophoneEnabled.mockReset().mockResolvedValue(undefined);
  mockSocket.connected = true;
  mockSocket.timeout.mockReturnValue(mockSocket);
  mockSocket.emit.mockImplementation((event, _args, cb) => { if (event === 'theater:join') acknowledge = cb; });
});
afterEach(async () => { useTheaterStore.getState().leaveTheater(); await flush(); });
test('exiting fullscreen drops old screen-sized bounds before native remeasurement', () => {
  useTheaterStore.setState({ serverId: 'realm', channelId: 'channel', overlayMode: 'expanded', focused: true,
    expandedFrame: { x: 0, y: 0, width: 932, height: 430 } });
  useTheaterStore.getState().setFocused(false);
  expect(useTheaterStore.getState()).toMatchObject({ focused: false, expandedFrame: null, focusControlsVisible: true });
  useTheaterStore.getState().setOverlayMode('floating');
  useTheaterStore.getState().setFocused(true);
  expect(useTheaterStore.getState().focused).toBe(false);
});
test('floating and hidden modes atomically clear expanded layout and reject stale bounds', () => {
  useTheaterStore.setState({ serverId: 'realm', channelId: 'channel', overlayMode: 'expanded', focused: true,
    expandedFrame: { x: 0, y: 0, width: 400, height: 800 } });
  useTheaterStore.getState().setOverlayMode('floating');
  expect(useTheaterStore.getState()).toMatchObject({ overlayMode: 'floating', focused: false, expandedFrame: null });
  useTheaterStore.getState().setExpandedFrame({ x: 0, y: 0, width: 400, height: 800 });
  expect(useTheaterStore.getState().expandedFrame).toBeNull();
  useTheaterStore.getState().setOverlayMode('expanded');
  useTheaterStore.getState().setExpandedFrame({ x: 0, y: 0, width: 400, height: 225 });
  expect(useTheaterStore.getState().expandedFrame?.height).toBe(225);
  useTheaterStore.getState().setOverlayMode('hidden');
  expect(useTheaterStore.getState().expandedFrame).toBeNull();
});
async function join(voice = true) {
  await useTheaterStore.getState().joinTheater({ serverId: 'realm', channelId: 'channel' });
  acknowledge({ ok: true, users: [{ id: 'A', username: 'self', micEnabled: false, clientType: 'mobile', voiceConnected: false }], queue: [], you: 'A' });
  await flush();
  if (voice) { void useTheaterStore.getState().joinVoice(); await flush(); }
}
test('starts audio before connection and releases it once on leave', async () => {
  await join();
  expect(useTheaterStore.getState().overlayMode).toBe('floating');
  expect(acquireAudioSession).toHaveBeenCalledTimes(1);
  expect(mockRoom.connect).toHaveBeenCalledTimes(1);
  expect((acquireAudioSession as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(mockRoom.connect.mock.invocationCallOrder[0]);
  useTheaterStore.getState().leaveTheater();
  useTheaterStore.getState().leaveTheater();
  await flush();
  expect(releaseAudioSession).toHaveBeenCalledTimes(1);
});

test('watching alone never starts a voice room or requests media credentials', async () => {
  mockApi.get.mockResolvedValueOnce({ data: { user: { id: 'A', isOwner: true } } });
  await join(false);
  expect(mockSocket.emit).toHaveBeenCalledWith('theater:join', { channelId: 'channel', voiceConnected: false }, expect.any(Function));
  expect(useTheaterStore.getState()).toMatchObject({ voiceStatus: 'disconnected', realmUser: { id: 'A', isOwner: true } });
  expect(mockApi.get.mock.calls).toEqual([['/api/auth/me']]);
  expect(mockApi.post).not.toHaveBeenCalled();
  expect(acquireAudioSession).not.toHaveBeenCalled();
  expect(mockRoom.connect).not.toHaveBeenCalled();
  await useTheaterStore.getState().toggleMic();
  await useTheaterStore.getState().toggleDeafen();
  expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  await useTheaterStore.getState().leaveVoice();
  expect(releaseAudioSession).not.toHaveBeenCalled();
});

test('explicit voice join is single-flight, connects muted, and leaving preserves watching', async () => {
  await join(false);
  const { participants, queue, playbackState } = useTheaterStore.getState();
  const pending = useTheaterStore.getState().joinVoice();
  expect(useTheaterStore.getState().voiceStatus).toBe('connecting');
  await useTheaterStore.getState().joinVoice();
  await pending;
  expect(mockRoom.connect).toHaveBeenCalledTimes(1);
  expect(useTheaterStore.getState()).toMatchObject({ voiceStatus: 'connected', selfMicEnabled: false });
  expect(mockSocket.emit).toHaveBeenCalledWith('theater:voice-state', { channelId: 'channel', voiceConnected: true });
  await useTheaterStore.getState().toggleMic();
  await useTheaterStore.getState().toggleDeafen();
  await useTheaterStore.getState().leaveVoice();
  expect(mockSocket.emit).toHaveBeenCalledWith('theater:voice-state', { channelId: 'channel', voiceConnected: false });
  expect(useTheaterStore.getState()).toMatchObject({ channelId: 'channel', queue, playbackState, participants, voiceStatus: 'disconnected', selfMicEnabled: false, selfDeafened: false });
  expect(mockSocket.emit.mock.calls.some(([event]) => event === 'theater:leave')).toBe(false);
  expect(releaseAudioSession).toHaveBeenCalledTimes(1);
  await useTheaterStore.getState().joinVoice();
  expect(useTheaterStore.getState()).toMatchObject({ voiceStatus: 'connected', selfMicEnabled: false });
});

test.each(['capabilities', 'token'])('canceling during %s cannot acquire audio or connect later', async (stage) => {
  await join(false);
  let finish!: (value: unknown) => void;
  const request = new Promise((resolve) => { finish = resolve; });
  if (stage === 'capabilities') mockApi.get.mockReturnValueOnce(request);
  else mockApi.post.mockReturnValueOnce(request);
  const pending = useTheaterStore.getState().joinVoice();
  await flush();
  await useTheaterStore.getState().leaveVoice();
  finish({ data: stage === 'capabilities' ? { capability: { enabled: true } } : { token: 'late-token' } });
  await pending;
  expect(useTheaterStore.getState()).toMatchObject({ channelId: 'channel', voiceStatus: 'disconnected' });
  expect(mockRoom.connect).not.toHaveBeenCalled();
  expect(acquireAudioSession).not.toHaveBeenCalled();
});

test('canceling an in-flight native connection waits for teardown and never reports In Call', async () => {
  await join(false);
  let finish!: () => void;
  mockRoom.connect.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  const pending = useTheaterStore.getState().joinVoice();
  await flush();
  const leaving = useTheaterStore.getState().leaveVoice();
  await flush();
  expect(useTheaterStore.getState().voiceStatus).toBe('disconnecting');
  expect(releaseAudioSession).not.toHaveBeenCalled();
  await useTheaterStore.getState().joinVoice();
  expect(mockRoom.connect).toHaveBeenCalledTimes(1);
  finish();
  await Promise.all([pending, leaving]);
  expect(useTheaterStore.getState()).toMatchObject({ channelId: 'channel', voiceStatus: 'disconnected' });
  expect(releaseAudioSession).toHaveBeenCalledTimes(1);
  expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  expect(mockSocket.emit.mock.calls.some(([event, data]) => event === 'theater:voice-state' && data.voiceConnected === true)).toBe(false);
});

test('failed voice connection leaves video joined and supports retry', async () => {
  await join(false);
  mockRoom.connect.mockRejectedValueOnce(new Error('Connection failed'));
  await useTheaterStore.getState().joinVoice();
  expect(useTheaterStore.getState()).toMatchObject({ channelId: 'channel', voiceStatus: 'disconnected', mediaError: 'Connection failed' });
  expect(releaseAudioSession).toHaveBeenCalledTimes(1);
  await useTheaterStore.getState().joinVoice();
  expect(useTheaterStore.getState()).toMatchObject({ voiceStatus: 'connected', mediaError: null });
});

test('remote voice disconnect clears the badge and audio without leaving theater', async () => {
  await join();
  const disconnected = mockRoom.on.mock.calls.find(([event]) => event === 'disconnected')![1];
  disconnected();
  await flush();
  expect(useTheaterStore.getState()).toMatchObject({ channelId: 'channel', voiceStatus: 'disconnected', selfMicEnabled: false });
  expect(useTheaterStore.getState().mediaError).toContain('disconnected');
  expect(releaseAudioSession).toHaveBeenCalledTimes(1);
});

test('late unmute cannot update the badge or microphone intent after leaving voice', async () => {
  await join();
  let finish!: () => void;
  mockRoom.localParticipant.setMicrophoneEnabled.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  const pending = useTheaterStore.getState().toggleMic();
  await useTheaterStore.getState().leaveVoice();
  finish();
  await pending;
  expect(useTheaterStore.getState()).toMatchObject({ voiceStatus: 'disconnected', selfMicEnabled: false, mediaAudioUpdating: false });
  expect(mockSocket.emit.mock.calls.some(([event]) => event === 'theater:mic-state')).toBe(false);
});
test('leaving before the join acknowledgment prevents a ghost player', async () => {
  await useTheaterStore.getState().joinTheater({ serverId: 'realm', channelId: 'channel' });
  useTheaterStore.getState().leaveTheater();
  acknowledge({ ok: true });
  await flush();
  expect(useTheaterStore.getState().channelId).toBeNull();
  expect(mockRoom.connect).not.toHaveBeenCalled();
});
test('deafen and undeafen actually mute and restore remote audio', async () => {
  const track = { kind: 'audio', mediaStreamTrack: { enabled: true }, setVolume: jest.fn() };
  mockRoom.remoteParticipants.set('peer', { identity: 'peer', audioTrackPublications: new Map([['audio', { track }]]) });
  await join();
  await useTheaterStore.getState().toggleDeafen();
  expect(track.mediaStreamTrack.enabled).toBe(false);
  await useTheaterStore.getState().toggleDeafen();
  expect(track.mediaStreamTrack.enabled).toBe(true);
  expect(track.setVolume).toHaveBeenCalledWith(1);
});
test('a late connection after leave cannot turn the microphone back on', async () => {
  let finish!: () => void;
  mockRoom.connect.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  await join();
  useTheaterStore.getState().leaveTheater();
  finish();
  await flush();
  expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  expect(releaseAudioSession).toHaveBeenCalledTimes(1);
});

test('joining starts muted and the first tap unmutes both native audio and presence', async () => {
  await join();
  expect(useTheaterStore.getState().selfMicEnabled).toBe(false);
  expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  await useTheaterStore.getState().toggleMic();
  expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
  expect(useTheaterStore.getState().selfMicEnabled).toBe(true);
  expect(useTheaterStore.getState().participants[0].micEnabled).toBe(true);
  expect(mockSocket.emit).toHaveBeenCalledWith('theater:mic-state', { channelId: 'channel', micEnabled: true });
  useTheaterStore.getState().leaveTheater();
  await join();
  expect(useTheaterStore.getState().selfMicEnabled).toBe(false);
  expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(1);
});

test('failed unmute preserves the muted icon and does not broadcast a false state', async () => {
  await join();
  mockRoom.localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(new Error('Microphone permission denied'));
  await useTheaterStore.getState().toggleMic();
  expect(useTheaterStore.getState()).toMatchObject({ selfMicEnabled: false, mediaAudioUpdating: false, mediaError: 'Microphone permission denied' });
  expect(mockSocket.emit.mock.calls.filter(([event]) => event === 'theater:mic-state')).toHaveLength(0);
});

test('audio toggles cannot overlap or update the room after leave', async () => {
  await join();
  let finish!: () => void;
  mockRoom.localParticipant.setMicrophoneEnabled.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  const pending = useTheaterStore.getState().toggleMic();
  await useTheaterStore.getState().toggleMic();
  await useTheaterStore.getState().toggleDeafen();
  expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(1);
  useTheaterStore.getState().leaveTheater();
  finish();
  await pending;
  expect(useTheaterStore.getState()).toMatchObject({ selfMicEnabled: false, mediaAudioUpdating: false });
  expect(mockSocket.emit.mock.calls.filter(([event]) => event === 'theater:mic-state')).toHaveLength(0);
});

test('deafen then undeafen keeps a join-muted microphone muted', async () => {
  await join();
  await useTheaterStore.getState().toggleDeafen();
  await useTheaterStore.getState().toggleDeafen();
  expect(mockRoom.localParticipant.setMicrophoneEnabled.mock.calls).toEqual([[false], [false]]);
  expect(useTheaterStore.getState().selfMicEnabled).toBe(false);
});

test('realm permission lookup is scoped to the joined session', async () => {
  let finish!: (response: unknown) => void;
  mockApi.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await join();
  expect(mockApi.get).toHaveBeenCalledWith('/api/auth/me');
  useTheaterStore.getState().leaveTheater();
  finish({ data: { user: { id: 'A', isOwner: true } } });
  await flush();
  expect(useTheaterStore.getState().realmUser).toBeNull();
});

test('playback denials are surfaced and late replies cannot affect a new room', async () => {
  await join();
  useTheaterStore.getState().control('channel', { playing: true });
  const reply = mockSocket.emit.mock.calls.find(([event]) => event === 'theater:state')![2];
  expect(mockSocket.timeout).toHaveBeenCalledWith(5000);
  reply(null, { ok: false, error: 'Missing permission: play_in_theater' });
  expect(useTheaterStore.getState().controlError).toBe('Missing permission: play_in_theater');
  useTheaterStore.getState().leaveTheater();
  await join();
  reply(new Error('Timed out'));
  expect(useTheaterStore.getState().controlError).toBeNull();
});

const reconnectHandler = () => {
  const call = mockSocket.on.mock.calls.filter(([event]) => event === 'connect').at(-1);
  if (!call) throw new Error('no reconnect listener');
  return call[1] as () => void;
};

test('a silent (watch-only) viewer rejoins watch-only after a reconnect', async () => {
  await join(false);
  mockSocket.emit.mockClear();
  reconnectHandler()();
  expect(mockSocket.emit).toHaveBeenCalledWith('theater:join', { channelId: 'channel', voiceConnected: false }, expect.any(Function));
  acknowledge({ ok: true, users: [{ id: 'A', username: 'self' }, { id: 'B', username: 'friend' }], queue: [], you: 'A' });
  await flush();
  const state = useTheaterStore.getState();
  expect(state).toMatchObject({ channelId: 'channel', voiceStatus: 'disconnected', overlayMode: 'floating' });
  expect(state.participants.map((p) => p.userId)).toEqual(['A', 'B']);
  // Never escalates into voice.
  expect(mockSocket.emit.mock.calls.map(([event]) => event)).toEqual(['theater:join']);
  expect(mockRoom.connect).not.toHaveBeenCalled();
});

test('a viewer in theater voice rejoins with voice and restores an unmuted mic', async () => {
  await join();
  await useTheaterStore.getState().toggleMic();
  mockSocket.emit.mockClear();
  reconnectHandler()();
  expect(mockSocket.emit).toHaveBeenCalledWith('theater:join', { channelId: 'channel', voiceConnected: true }, expect.any(Function));
  acknowledge({ ok: true, users: [{ id: 'A', username: 'self' }], queue: [], you: 'A' });
  await flush();
  expect(mockSocket.emit).toHaveBeenCalledWith('theater:mic-state', { channelId: 'channel', micEnabled: true });
  expect(useTheaterStore.getState().voiceStatus).toBe('connected');
});

test('leaving stops the reconnect rejoin', async () => {
  await join(false);
  const handler = reconnectHandler();
  useTheaterStore.getState().leaveTheater();
  expect(mockSocket.off).toHaveBeenCalledWith('connect', handler);
  mockSocket.emit.mockClear();
  handler();
  expect(mockSocket.emit).not.toHaveBeenCalled();
});
