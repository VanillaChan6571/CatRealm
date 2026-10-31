import { act, fireEvent, render } from '@testing-library/react-native';
import type { View } from 'react-native';
import { AppTourOverlay } from '../AppTourOverlay';
import { TOUR_STEPS } from '../tourSteps';
import { decideAppTour, useAppTourStore } from '@/lib/appTour';
import { registerTourAnchor } from '@/lib/tourAnchors';
import i18n from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';

jest.setTimeout(20_000);
const mockReplace = jest.fn();
const mockPost = jest.fn(() => Promise.resolve({ data: { completed: true } }));
const mockUI = { profileEditMode: false, setProfileEditMode: jest.fn(), setServerDrawerOpen: jest.fn() };
let mockPath = '/home';
jest.mock('expo-router', () => ({ usePathname: () => mockPath, useRouter: () => ({ replace: mockReplace }) }));
jest.mock('@/theme', () => ({ useTheme: () => ({ colors: {}, radius: { md: 8 } }) }));
jest.mock('@/components/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/components/Pressable', () => ({ Pressable: require('react-native').Pressable }));
jest.mock('@/lib/api', () => ({ createAuthenticatedApi: () => ({ post: mockPost, get: jest.fn() }) }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(() => Promise.resolve(null)), setItem: jest.fn(() => Promise.resolve()) },
}));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (select: (state: unknown) => unknown) => select({ user: { id: 'u1', accountType: 'central' } }),
}));
jest.mock('@/stores/uiStore', () => ({ useUIStore: { getState: () => mockUI } }));

const fakeView = (y = 100) => ({ measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(10, y, 50, 30) }) as unknown as View;
const anchorAll = () => TOUR_STEPS.forEach((s) => { if (s.target) registerTourAnchor(s.target, { view: fakeView() }); });

async function press(screen: Awaited<ReturnType<typeof render>>, label: string) {
  await act(async () => { fireEvent.press(screen.getByText(label)); });
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  mockPath = '/home';
  mockUI.profileEditMode = false;
  useSettingsStore.setState({ language: 'en' });
  useAppTourStore.setState({ open: false });
});

test('uses the active app language for tour copy and controls', async () => {
  const screen = await render(<AppTourOverlay />);
  await act(async () => useAppTourStore.getState().start());
  await press(screen, '日本語');
  expect(screen.getByText('CatRealmへようこそ')).toBeTruthy();
  expect(screen.getByText('次')).toBeTruthy();
  expect(useSettingsStore.getState().language).toBe('ja');
});

test('the account decides first, then the device', () => {
  expect(decideAppTour(false, false)).toBe('tour');
  expect(decideAppTour(false, true)).toBe('tour');
  expect(decideAppTour(true, false)).toBe('offer');
  expect(decideAppTour(true, true)).toBeNull();
});

test('starts at Home, opens the server drawer for Discover, then waits for the user to tap You', async () => {
  anchorAll();
  const screen = await render(<AppTourOverlay />);
  await act(async () => useAppTourStore.getState().start());
  expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)/home');
  await press(screen, 'Next'); // Home
  await press(screen, 'Next'); // Servers
  await press(screen, 'Next'); // Discover
  expect(screen.getByText('Discover servers')).toBeTruthy();
  expect(mockUI.setServerDrawerOpen).toHaveBeenLastCalledWith(true);
  await press(screen, 'Next'); // Chats
  await press(screen, 'Next'); // Notifications
  await press(screen, 'Next'); // You
  expect(screen.getByText('Open your profile')).toBeTruthy();
  expect(screen.queryByText('Next')).toBeNull();

  mockPath = '/me';
  await screen.rerender(<AppTourOverlay />);
  await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
  expect(screen.getByText('Edit your profile')).toBeTruthy();

  // "Will do later" on editing skips the picture and banner steps.
  await press(screen, 'Will do later');
  expect(screen.getByText('Server Profiles')).toBeTruthy();
});

test('skipping marks both the account and this device', async () => {
  const screen = await render(<AppTourOverlay />);
  await act(async () => useAppTourStore.getState().start());
  await press(screen, 'Skip tour');
  expect(useAppTourStore.getState().open).toBe(false);
  expect(jest.requireMock<{ default: { setItem: jest.Mock } }>('@react-native-async-storage/async-storage').default.setItem)
    .toHaveBeenCalledWith('catrealm.app-tour-done.u1', '1');
  expect(mockPost).toHaveBeenCalledWith('/api/app-tour');
});
