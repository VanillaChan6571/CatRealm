import { act, fireEvent, render } from '@testing-library/react-native';
import { TheaterChatPanel } from '../TheaterChatPanel';
import { useMessageStore } from '@/stores/messageStore';
import type { Message } from '@/types';

jest.setTimeout(15_000);
jest.mock('expo-router', () => ({ useFocusEffect: (callback: any) => require('react').useEffect(callback, [callback]) }));
jest.mock('react-native-reanimated', () => ({ useSharedValue: () => ({ value: 0 }) }));
jest.mock('@/theme', () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock('@/components/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/components/Avatar', () => ({ Avatar: (props: any) => require('react').createElement('Avatar', { ...props, testID: 'chat-avatar' }) }));
jest.mock('@/components/MarkdownText', () => ({ MarkdownText: ({ text }: any) => require('react').createElement(require('react-native').Text, null, text) }));
jest.mock('@/components/MobileComposer', () => ({ MobileComposer: (props: any) => {
  mockComposer = props;
  return require('react').createElement(require('react-native').TouchableOpacity, { accessibilityLabel: 'Send chat message', onPress: () => props.onSend('hello') });
} }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: (select: any) => select({ user: { id: 'self', accountType: 'central' } }) }));
jest.mock('@/stores/serverStore', () => ({ useServerStore: (select: any) => select({ byId: () => mockServer, channels: { realm: [{ id: 'movies', effective_permissions: mockPermissions }] } }) }));
jest.mock('@/stores/theaterStore', () => ({ useTheaterStore: (select: any) => select({ realmUser: { id: 'self', permissions: 6 } }) }));
jest.mock('@/stores/blockedUsersStore', () => ({ useBlockedUsersStore: (select: any) => select({ blockedUsers: mockBlocked }) }));
jest.mock('@/stores/channelStore', () => ({ useChannelStore: { getState: () => mockChannel } }));
jest.mock('@/lib/socket', () => ({ getSocket: (url: string) => { mockSocketUrl(url); return mockSocket; } }));
jest.mock('@/lib/api', () => ({ createApi: (...args: any[]) => { mockApiArgs(...args); return { get: mockGet }; }, createAuthenticatedApi: () => ({ post: jest.fn(async () => {}) }) }));
jest.mock('@/lib/expressionCache', () => ({ useExpressionLookup: () => null }));
jest.mock('@/lib/debugLog', () => ({ debugLog: jest.fn() }));
const mockServer = { url: 'https://realm.test', token: 'realm-token' as string | undefined };
let mockPermissions = 6;
let mockBlocked = new Set<string>();
let mockComposer: any;
const mockApiArgs = jest.fn();
const mockGet = jest.fn();
const mockSocketUrl = jest.fn();
const mockSocket = { connected: true, emit: jest.fn(), on: jest.fn(), off: jest.fn() };
const mockChannel = { activeChannelId: null as string | null, setActiveChannel: (id: string | null) => { mockChannel.activeChannelId = id; }, resetCounts: jest.fn() };
const msg = (id: string, time: number, extra = {}) => ({ id, channel_id: 'movies', user_id: 'friend', username: 'Friend', content: `Message ${id}`, created_at: time, ...extra }) as Message;
const panel = () => <TheaterChatPanel serverId="realm" channelId="movies" />;
beforeEach(() => {
  jest.clearAllMocks(); useMessageStore.getState().reset();
  mockPermissions = 6; mockBlocked = new Set(); mockServer.token = 'realm-token'; mockSocket.connected = true;
  mockChannel.activeChannelId = null;
  mockGet.mockResolvedValue({ data: [msg('history', 100)] });
});

test('fetches history even with a live-message cache, merges it, and uses realm credentials', async () => {
  useMessageStore.getState().appendMessage('movies', msg('live', 200));
  const screen = await render(panel());
  expect(mockApiArgs).toHaveBeenCalledWith('https://realm.test', 'realm-token');
  expect(mockGet).toHaveBeenCalledWith('/api/messages/movies', { params: { limit: 50 } });
  expect(screen.getByText('Message history')).toBeTruthy();
  expect(screen.getByText('Message live')).toBeTruthy();
  expect(useMessageStore.getState().earliestId.movies).toBe('100');
  await screen.unmount();
  expect(mockChannel.activeChannelId).toBeNull();
  expect(mockSocket.off).toHaveBeenCalledWith('connect', expect.any(Function));
});
test.each(['/uploads/friend.png', 'https://auth.test/avatars/friend.png', null])('shows avatars for historical and live chat messages: %s', async (avatar) => {
  mockGet.mockResolvedValue({ data: [msg('history', 100, { avatar, display_name: 'Display Friend' })] });
  const screen = await render(panel());
  expect(screen.getByTestId('chat-avatar').props).toMatchObject({
    username: 'Display Friend', uri: avatar, baseUrl: 'https://realm.test', size: 32, showStatus: false,
  });
  await act(() => useMessageStore.getState().appendMessage('movies', msg('live', 200, { avatar })));
  expect(screen.getAllByTestId('chat-avatar')).toHaveLength(2);
  expect(screen.getAllByTestId('chat-avatar').some((node) => node.props.username === 'Friend' && node.props.uri === avatar)).toBe(true);
});
test('waits for realm token hydration without falling back to a central token', async () => {
  mockServer.token = undefined;
  const screen = await render(panel());
  expect(mockGet).not.toHaveBeenCalled();
  mockServer.token = 'realm-token';
  await screen.rerender(panel());
  expect(mockGet).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Message history')).toBeTruthy();
});
test('reports history failures and lets the user retry', async () => {
  mockGet.mockRejectedValueOnce(new Error('offline'));
  const screen = await render(panel());
  expect(screen.queryByText('No messages yet.')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Retry chat history'));
  expect(mockGet).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Message history')).toBeTruthy();
  expect(screen.queryByLabelText('Retry chat history')).toBeNull();
});
test('loads older pages using the history cursor and deduplicates live overlap', async () => {
  const page = Array.from({ length: 50 }, (_, i) => msg(String(i), i + 100));
  mockGet.mockResolvedValueOnce({ data: page }).mockResolvedValueOnce({ data: [msg('older', 99), page[0]] });
  const screen = await render(panel());
  await fireEvent.press(screen.getByText('Load older messages'));
  expect(mockGet).toHaveBeenLastCalledWith('/api/messages/movies', { params: { limit: 50, before: '100' } });
  expect(useMessageStore.getState().byChannel.movies).toHaveLength(51);
  expect(useMessageStore.getState().earliestId.movies).toBe('99');
});
test('reflects live messages and deletes while filtering blocked users and threads', async () => {
  mockBlocked = new Set(['blocked']);
  const screen = await render(panel());
  await act(() => {
    useMessageStore.getState().appendMessage('movies', msg('new', 300));
    useMessageStore.getState().appendMessage('movies', msg('blocked', 301, { user_id: 'blocked' }));
    useMessageStore.getState().appendMessage('movies', msg('thread', 302, { thread_id: 't' }));
  });
  expect(screen.getByText('Message new')).toBeTruthy();
  expect(screen.queryByText('Message blocked')).toBeNull();
  expect(screen.queryByText('Message thread')).toBeNull();
  await act(() => useMessageStore.getState().removeMessage('movies', 'new'));
  expect(screen.queryByText('Message new')).toBeNull();
});
test('sends to the theater realm socket, not an implicit active realm', async () => {
  const screen = await render(panel());
  await fireEvent.press(screen.getByLabelText('Send chat message'));
  expect(mockSocketUrl).toHaveBeenLastCalledWith('https://realm.test');
  expect(mockSocket.emit).toHaveBeenLastCalledWith('message:send', { channelId: 'movies', content: 'hello', attachments: [], nsfwTags: [] });
});
test('keeps a draft when disconnected', async () => {
  const screen = await render(panel());
  await act(() => mockComposer.onChangeText('keep this'));
  mockSocket.connected = false;
  await fireEvent.press(screen.getByLabelText('Send chat message'));
  expect(mockComposer.value).toBe('keep this');
  expect(screen.getByText('Chat is disconnected. Reconnect and try again.')).toBeTruthy();
});
test('respects read-only and no-history channel permissions', async () => {
  mockPermissions = 2;
  const screen = await render(panel());
  expect(screen.getByText('Message history')).toBeTruthy();
  expect(screen.queryByLabelText('Send chat message')).toBeNull();
  mockPermissions = 0;
  await screen.rerender(panel());
  expect(screen.queryByText('Message history')).toBeNull();
  expect(screen.getByText('You do not have permission to read this chat.')).toBeTruthy();
});
