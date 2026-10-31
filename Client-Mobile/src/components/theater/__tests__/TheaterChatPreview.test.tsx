import { act, fireEvent, render } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { TheaterChatPreview } from '../TheaterChatPreview';
import { useTheaterChatPreviewStore as store, type TheaterChatPreview as Preview } from '@/stores/theaterChatPreviewStore';

jest.setTimeout(15_000);
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/Avatar', () => ({ Avatar: (props: any) => require('react').createElement('Avatar', { ...props, testID: 'chat-avatar' }) }));
jest.mock('@/components/Text', () => ({ Text: 'Text' }));
jest.mock('@/hooks/useAppForeground', () => ({ useAppForeground: () => mockForeground }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: (select: any) => select({ user: { id: mockAccount } }) }));
jest.mock('@/stores/settingsStore', () => ({ useSettingsStore: (select: any) => select({ theaterChatPreviews: mockEnabled }) }));
jest.mock('@/stores/blockedUsersStore', () => ({ useBlockedUsersStore: (select: any) => select({ blockedUsers: mockBlocked }) }));
jest.mock('@/stores/theaterChatPreviewStore', () => ({
  THEATER_CHAT_PREVIEW_MS: 5000,
  useTheaterChatPreviewStore: require('zustand').create((set: any) => ({ preview: null, clear: () => set({ preview: null }) })),
}));
let mockForeground = true;
let mockEnabled = true;
let mockAccount = 'self';
let mockBlocked = new Set<string>();
const open = jest.fn();
const props = { channelId: 'movies', serverId: 'realm', top: 80, right: 64, maxWidth: 320, onOpenChat: open };
const makePreview = (id = '1'): Preview => ({ id, channelId: 'movies', serverId: 'realm', serverUrl: 'https://realm.test', accountId: 'self', userId: 'friend', name: 'Friend', avatar: '/uploads/friend.png', text: `Hello ${id}`, fallback: 'newChatMessage', receivedAt: Date.now() });
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  mockForeground = true; mockEnabled = true; mockAccount = 'self'; mockBlocked = new Set();
  store.setState({ preview: makePreview() });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test.each(['/uploads/friend.png', 'https://auth.test/avatars/friend.png', null])('renders sender avatar with the correct realm base and fallback name: %s', async (avatar) => {
  store.setState({ preview: { ...makePreview(), avatar } });
  const screen = await render(<TheaterChatPreview {...props} />);
  expect(screen.getByTestId('chat-avatar').props).toMatchObject({
    username: 'Friend', uri: avatar, baseUrl: 'https://realm.test', size: 32, showStatus: false,
  });
});

test('shows a tappable bubble and clears it when opening chat', async () => {
  const screen = await render(<TheaterChatPreview {...props} />);
  expect(screen.getByText('Friend')).toBeTruthy();
  expect(screen.getByText('Hello 1')).toBeTruthy();
  const stopPropagation = jest.fn();
  await fireEvent.press(screen.getByRole('button'), { stopPropagation });
  expect(stopPropagation).toHaveBeenCalled(); expect(open).toHaveBeenCalledTimes(1);
  expect(store.getState().preview).toBeNull();
});
test('fades in, remains for five seconds, then fades out and releases the preview', async () => {
  const timing = jest.spyOn(Animated, 'timing');
  const screen = await render(<TheaterChatPreview {...props} />);
  expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, duration: 180, useNativeDriver: true }));
  await act(() => jest.advanceTimersByTime(4900));
  expect(screen.getByText('Hello 1')).toBeTruthy();
  await act(() => jest.advanceTimersByTime(700));
  expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 0, duration: 250, useNativeDriver: true }));
  expect(store.getState().preview).toBeNull();
});
test('a newer message replaces the old bubble and owns its own dismissal timer', async () => {
  const screen = await render(<TheaterChatPreview {...props} />);
  await act(() => jest.advanceTimersByTime(4000));
  await act(() => store.setState({ preview: makePreview('2') }));
  expect(screen.queryByText('Hello 1')).toBeNull();
  await act(() => jest.advanceTimersByTime(2000));
  expect(screen.getByText('Hello 2')).toBeTruthy();
  await act(() => jest.advanceTimersByTime(4000));
  expect(store.getState().preview).toBeNull();
});
test.each(['disabled', 'background', 'blocked', 'account', 'channel', 'realm'])('clears immediately on %s without later replay', async (reason) => {
  const screen = await render(<TheaterChatPreview {...props} />);
  if (reason === 'disabled') mockEnabled = false;
  if (reason === 'background') mockForeground = false;
  if (reason === 'blocked') mockBlocked = new Set(['friend']);
  if (reason === 'account') mockAccount = 'another';
  await screen.rerender(<TheaterChatPreview {...props} channelId={reason === 'channel' ? 'other' : props.channelId} serverId={reason === 'realm' ? 'other' : props.serverId} />);
  expect(screen.queryByTestId('theater-chat-preview')).toBeNull();
  expect(store.getState().preview).toBeNull();
});
test('unmount cancels the timer and releases the message', async () => {
  const screen = await render(<TheaterChatPreview {...props} />);
  await screen.unmount();
  expect(store.getState().preview).toBeNull();
  // An old timer must not clear a preview from a later fullscreen session.
  store.setState({ preview: makePreview('2') });
  await act(() => jest.advanceTimersByTime(6000));
  expect(store.getState().preview?.id).toBe('2');
});
