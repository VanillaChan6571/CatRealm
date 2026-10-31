import { render } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';
import { BottomDock } from '../../BottomDock';

jest.setTimeout(15_000);
jest.mock('expo-router', () => ({ usePathname: () => mockPath, useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 48, left: 0, right: 0 }) }));
jest.mock('@/theme', () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock('@/hooks/useDeviceLayout', () => ({ useDeviceLayout: () => ({ isTablet: false }) }));
jest.mock('@/components/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/components/Pressable', () => ({ Pressable: require('react-native').Pressable }));
jest.mock('@/components/Avatar', () => ({ Avatar: require('react-native').View }));
jest.mock('lucide-react-native', () => ({ Bell: 'Icon', Cat: 'Icon', Home: 'Icon', MessageCircle: 'Icon' }));
jest.mock('@/stores/theaterStore', () => ({ useTheaterStore: (select: (state: unknown) => unknown) => select(mockTheater) }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ user: null }) }));
jest.mock('@/stores/serverStore', () => ({ useServerStore: (select: (state: unknown) => unknown) => select({ activeServerId: null, servers: [] }) }));
jest.mock('@/stores/dmStore', () => ({ useDMStore: (select: (state: unknown) => unknown) => select({ conversations: [] }) }));
jest.mock('@/stores/groupChatStore', () => ({ useGroupChatStore: (select: (state: unknown) => unknown) => select({ groups: [] }) }));
jest.mock('@/stores/friendStore', () => ({ useFriendStore: (select: (state: unknown) => unknown) => select({ incoming: [] }) }));
jest.mock('@/stores/notificationStore', () => ({ useNotificationStore: (select: (state: unknown) => unknown) => select({ summary: null }) }));
jest.mock('@/stores/channelStore', () => ({ useChannelStore: (select: (state: unknown) => unknown) => select({ lastChannelByServer: {} }) }));
jest.mock('@/stores/uiStore', () => ({ useUIStore: (select: (state: unknown) => unknown) => select({}) }));
let mockPath = '/server/realm/theater/channel';
const mockTheater = { overlayMode: 'expanded', focused: false };

test('the dock hides only for fullscreen theater and returns immediately on exit or navigation', async () => {
  const screen = await render(<BottomDock />);
  expect(screen.getByText('tabs.home')).toBeTruthy();
  mockTheater.focused = true;
  await screen.rerender(<BottomDock />);
  expect(screen.queryByText('tabs.home')).toBeNull();
  mockTheater.focused = false;
  await screen.rerender(<BottomDock />);
  expect(screen.getByText('tabs.home')).toBeTruthy();
  mockTheater.focused = true; mockPath = '/home';
  await screen.rerender(<BottomDock />);
  expect(screen.getByText('tabs.home')).toBeTruthy();
});

test('the dock reserves the Android navigation-bar safe area', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const screen = await render(<BottomDock />);
  const style = StyleSheet.flatten(screen.getByTestId('bottom-dock').props.style);

  expect(style.height).toBe(112);
  expect(style.paddingBottom).toBe(56);
});

test('the iOS dock keeps its original height over the home indicator', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const screen = await render(<BottomDock />);
  const style = StyleSheet.flatten(screen.getByTestId('bottom-dock').props.style);

  expect(style.height).toBe(64);
  expect(style.paddingBottom).toBe(8);
});
