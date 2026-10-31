import { act, fireEvent, render } from '@testing-library/react-native';
import { TheaterJoinModal, useOpenTheater } from '../TheaterJoinModal';

const mockReplace = jest.fn();
const mockSetPrompt = jest.fn();
const mockTheater = {
  channelId: null as string | null, serverId: null as string | null, channelName: null as string | null,
  roomUsersByChannel: {} as Record<string, { userId: string; username: string; avatar?: string | null; roleColor?: string | null }[]>,
  joinTheater: jest.fn(),
};
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key) }) }));
jest.mock('@/theme', () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock('lucide-react-native', () => ({ Film: 'Film' }));
jest.mock('../../Avatar', () => ({ Avatar: () => null }));
jest.mock('../../Text', () => ({ Text: require('react-native').Text }));
jest.mock('../../Pressable', () => ({ Pressable: require('react-native').Pressable }));
jest.mock('@/stores/theaterStore', () => {
  const useTheaterStore = (select: (state: unknown) => unknown) => select(mockTheater);
  useTheaterStore.getState = () => mockTheater;
  return { useTheaterStore };
});
jest.mock('@/stores/uiStore', () => ({ useUIStore: (select: (state: unknown) => unknown) => select({ setTheaterPrompt: mockSetPrompt, theaterPrompt: null }) }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ user: { accountType: 'central' }, serverUrl: null }) }));
jest.mock('@/stores/serverStore', () => ({ useServerStore: (select: (state: unknown) => unknown) => select({ byId: () => ({ url: 'https://realm.invalid' }) }) }));

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockTheater, { channelId: null, serverId: null, channelName: null, roomUsersByChannel: {} });
});

const renderModal = (props: Partial<Parameters<typeof TheaterJoinModal>[0]> = {}) => render(
  <TheaterJoinModal serverId="realm" channelId="theater" channelName="Movie Night" onCancel={jest.fn()} onJoined={jest.fn()} {...props} />,
);

test('lists who is watching', async () => {
  mockTheater.roomUsersByChannel.theater = [{ userId: 'a', username: 'Kim' }, { userId: 'b', username: 'Nya Nya' }];
  const screen = await renderModal();
  expect(screen.getByText('theater.watchingNow:{"count":2}')).toBeTruthy();
  expect(screen.getByText('Kim')).toBeTruthy();
  expect(screen.getByText('Nya Nya')).toBeTruthy();
});

test('an empty theater invites the user to start it', async () => {
  const screen = await renderModal();
  expect(screen.getByText('theater.nobodyWatching')).toBeTruthy();
});

test('warns when joining would leave another theater', async () => {
  Object.assign(mockTheater, { channelId: 'other', serverId: 'realm', channelName: 'Anime Club' });
  const screen = await renderModal();
  expect(screen.getByText('theater.switchTheater:{"name":"Anime Club"}')).toBeTruthy();
});

test('joins on confirmation and reports success only once the server accepts', async () => {
  const onJoined = jest.fn();
  const screen = await renderModal({ onJoined });
  await fireEvent.press(screen.getByText('theater.join'));
  expect(mockTheater.joinTheater).toHaveBeenCalledWith({ serverId: 'realm', channelId: 'theater', channelName: 'Movie Night' });
  expect(onJoined).not.toHaveBeenCalled();
  Object.assign(mockTheater, { channelId: 'theater', serverId: 'realm' });
  await screen.rerender(<TheaterJoinModal serverId="realm" channelId="theater" channelName="Movie Night" onCancel={jest.fn()} onJoined={onJoined} />);
  expect(onJoined).toHaveBeenCalledTimes(1);
});

test('a join that never lands surfaces an error instead of spinning forever', async () => {
  jest.useFakeTimers();
  try {
    const screen = await renderModal();
    await fireEvent.press(screen.getByText('theater.join'));
    await act(() => { jest.advanceTimersByTime(10_000); });
    expect(screen.getByText('theater.joinFailed')).toBeTruthy();
    expect(screen.getByText('theater.join')).toBeTruthy();
  } finally { jest.useRealTimers(); }
});

test('opening a theater asks first, but goes straight in when already joined', async () => {
  let open: ReturnType<typeof useOpenTheater> = () => {};
  function Probe() { open = useOpenTheater(); return null; }
  await render(<Probe />);
  open('realm', 'theater', 'Movie Night');
  expect(mockSetPrompt).toHaveBeenCalledWith({ serverId: 'realm', channelId: 'theater', channelName: 'Movie Night' });
  expect(mockReplace).not.toHaveBeenCalled();
  Object.assign(mockTheater, { channelId: 'theater', serverId: 'realm' });
  open('realm', 'theater', 'Movie Night');
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/server/[serverId]/theater/[channelId]', params: { serverId: 'realm', channelId: 'theater' } });
});
