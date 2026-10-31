jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mockAuth } }));
jest.mock('@/stores/serverStore', () => ({ useServerStore: { getState: () => ({ activeServerId: 'realm', byId: () => ({ url: 'https://realm.invalid', token: 'realm-token' }) }) } }));
jest.mock('@/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ soundVolumes: {} }) } }));
jest.mock('@/stores/blockedUsersStore', () => ({ useBlockedUsersStore: { getState: () => ({ isBlocked: () => false }), subscribe: jest.fn() } }));
jest.mock('@/lib/api', () => ({ createApi: () => mockApi }));
jest.mock('@/lib/socket', () => ({ getSocket: () => mockSocket }));
jest.mock('@/lib/notificationSounds', () => ({ setVoiceSessionActive: jest.fn(), playNotificationSound: jest.fn() }));
jest.mock('@/lib/livekit-init', () => ({ ensureLiveKitGlobals: () => true, getLiveKitInitError: () => null }));
jest.mock('@/lib/audioSession', () => ({ acquireAudioSession: jest.fn(async () => {}), releaseAudioSession: jest.fn(async () => {}) }));
jest.mock('livekit-client', () => ({ Room: jest.fn(() => mockRoom), RoomEvent: new Proxy({}, { get: (_t, key) => String(key) }) }));

import { AppState } from 'react-native';
import { useVoiceStore } from '../voiceStore';

const mockAuth = { user: { id: 'A', accountType: 'central' }, token: 'central-token', syncKey: 'key' };
const mockApi = { get: jest.fn(), post: jest.fn() };
const mockSocket = { emit: jest.fn(), on: jest.fn(), off: jest.fn(), connected: true };
const roomHandlers: Record<string, (...args: unknown[]) => void> = {};
const mockRoom = {
  on: jest.fn((event: string, handler: (...args: unknown[]) => void): void => { roomHandlers[event] = handler; }),
  connect: jest.fn(async () => {}), disconnect: jest.fn(async () => {}),
  localParticipant: { setMicrophoneEnabled: jest.fn(async () => {}), identity: 'A', trackPublications: new Map() },
  remoteParticipants: new Map(),
};
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const target = { serverId: 'realm', channelId: 'voice-1', channelName: 'Lounge' };
const reconnectHandler = () => mockSocket.on.mock.calls.filter(([event]) => event === 'connect').at(-1)?.[1] as () => void;

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockApi.get.mockResolvedValue({ data: { capability: { enabled: true, publicUrl: 'wss://media.invalid' } } });
  mockApi.post.mockResolvedValue({ data: { token: 'media-token' } });
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  await useVoiceStore.getState().joinChannel(target);
  await flush();
});
afterEach(async () => { useVoiceStore.getState().leaveChannel(); await flush(); jest.useRealTimers(); });

test('a socket reconnect re-announces the call with the current mute state', () => {
  expect(useVoiceStore.getState().channelId).toBe('voice-1');
  mockSocket.emit.mockClear();
  reconnectHandler()();
  expect(mockSocket.emit).toHaveBeenCalledWith('voice:join', { channelId: 'voice-1', muted: false, deafened: false });
});

test('leaving stops re-announcing', () => {
  const handler = reconnectHandler();
  useVoiceStore.getState().leaveChannel();
  expect(mockSocket.off).toHaveBeenCalledWith('connect', handler);
});

test('a dropped call that had been up rejoins the same channel', async () => {
  jest.advanceTimersByTime(15_000);
  mockRoom.connect.mockClear();
  roomHandlers.Disconnected(9); // SIGNAL_CLOSE
  expect(useVoiceStore.getState().channelId).toBeNull();
  jest.advanceTimersByTime(1000);
  await flush();
  expect(mockRoom.connect).toHaveBeenCalledTimes(1);
  expect(useVoiceStore.getState()).toMatchObject({ channelId: 'voice-1', serverId: 'realm', channelName: 'Lounge' });
});

test.each([[4, 'removed by a moderator'], [5, 'room deleted'], [1, 'client initiated']])(
  'reason %i (%s) does not rejoin', async (reason) => {
    jest.advanceTimersByTime(15_000);
    mockRoom.connect.mockClear();
    roomHandlers.Disconnected(reason);
    jest.advanceTimersByTime(5000);
    await flush();
    expect(mockRoom.connect).not.toHaveBeenCalled();
  },
);

test('a call that drops right after connecting does not loop', async () => {
  mockRoom.connect.mockClear();
  roomHandlers.Disconnected(9);
  jest.advanceTimersByTime(5000);
  await flush();
  expect(mockRoom.connect).not.toHaveBeenCalled();
});

test('a drop while backgrounded waits for the foreground', async () => {
  jest.advanceTimersByTime(15_000);
  mockRoom.connect.mockClear();
  const listeners: ((state: string) => void)[] = [];
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
    listeners.push(cb as (state: string) => void);
    return { remove: jest.fn() } as never;
  });
  Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
  roomHandlers.Disconnected(9);
  jest.advanceTimersByTime(5000);
  await flush();
  expect(mockRoom.connect).not.toHaveBeenCalled();
  listeners.forEach((cb) => cb('active'));
  await flush();
  expect(mockRoom.connect).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});
