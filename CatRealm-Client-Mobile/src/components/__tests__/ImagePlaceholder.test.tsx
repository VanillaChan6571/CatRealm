import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ImagePlaceholder } from '../ImagePlaceholder';
import { FadeInImage } from '../FadeInImage';
import { Avatar } from '../Avatar';

jest.mock('@/theme', () => ({ useTheme: () => ({ colors: { bgElev2: '#44306E', bgApp: '#3A2864', text2: '#ccc', statusColor: {} } }) }));
jest.mock('expo-image', () => ({ Image: (props: object) => require('react').createElement(require('react-native').View, { testID: 'expo-image', ...props }) }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
jest.mock('expo-battery', () => ({ usePowerState: () => ({ lowPowerMode: false, batteryLevel: 1, batteryState: 0 }), BatteryState: { UNPLUGGED: 1 } }));
jest.mock('@/stores/settingsStore', () => ({ useSettingsStore: (select: (s: unknown) => unknown) => select({ showAvatarBackground: true, playGifAvatars: true }) }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: (select: (s: unknown) => unknown) => select({ user: { accountType: 'central' }, serverUrl: null }) }));
const DEFAULT_AVATAR = 'https://auth.invalid/uploads/avatars/default-v2.jpg';
jest.mock('@/utils/mediaUrl', () => ({
  resolveAvatarUrl: (uri: string | null) => uri,
  defaultAvatarUrl: () => 'https://auth.invalid/uploads/avatars/default-v2.jpg',
}));
jest.mock('@/lib/imageCache', () => ({ useCachedUri: (uri: string | null) => uri, centralScope: () => 'c', realmScope: () => 'r', evictCachedFile: () => {} }));
jest.mock('../Text', () => ({ Text: require('react-native').Text }));

type Screen = Awaited<ReturnType<typeof render>>;
const load = (screen: Screen) =>
  act(() => { fireEvent(screen.getByTestId('expo-image'), 'load', { source: { width: 10, height: 10 } }); });

const layout = (node: unknown, width: number, height: number) =>
  act(() => { fireEvent(node as never, 'layout', { nativeEvent: { layout: { width, height, x: 0, y: 0 } } }); });

test('the cat mark only appears where asked', async () => {
  const screen = await render(<>
    <ImagePlaceholder />
    <ImagePlaceholder mark />
    <ImagePlaceholder mark />
  </>);
  for (const node of screen.getAllByTestId('image-placeholder')) await layout(node, 300, 200);
  expect(screen.getAllByTestId('image-placeholder')).toHaveLength(3);
  expect(screen.getAllByTestId('image-placeholder-mark')).toHaveLength(2);
  await screen.unmount();
});

test('a banner shows the placeholder until the image arrives, then drops it', async () => {
  const screen = await render(<FadeInImage uri="https://cdn.invalid/banner.png" />);
  await layout(screen.getByTestId('image-placeholder'), 330, 108);
  expect(screen.getByTestId('image-placeholder-mark')).toBeTruthy();
  expect(screen.getByTestId('expo-image').props.transition).toBeGreaterThan(0);
  await load(screen);
  expect(screen.queryByTestId('image-placeholder')).toBeNull();
  await screen.rerender(<FadeInImage uri="https://cdn.invalid/other.png" />);
  expect(screen.getByTestId('image-placeholder')).toBeTruthy();
});

test('an avatar with a picture shows the placeholder, not the initial, while it loads', async () => {
  const screen = await render(<Avatar username="vanilla" uri="https://cdn.invalid/v.png" size={48} />);
  expect(screen.getByTestId('image-placeholder')).toBeTruthy();
  expect(screen.queryByTestId('image-placeholder-mark')).toBeNull(); // too small for the mark
  expect(screen.queryByText('V')).toBeNull();
  await load(screen);
  expect(screen.queryByTestId('image-placeholder')).toBeNull();
});

const shownUri = (screen: Screen) => screen.getByTestId('expo-image').props.source.uri;
const fail = (screen: Screen) => act(() => { fireEvent(screen.getByTestId('expo-image'), 'error'); });

test('an avatar without a picture shows the CatRealm default', async () => {
  const screen = await render(<Avatar username="vanilla" uri={null} size={48} />);
  expect(shownUri(screen)).toBe(DEFAULT_AVATAR);
  expect(screen.queryByText('V')).toBeNull();
});

test('a failed avatar falls back to the default, then to its initial', async () => {
  const screen = await render(<Avatar username="vanilla" uri="https://cdn.invalid/broken.png" size={48} />);
  await fail(screen);
  expect(shownUri(screen)).toBe(DEFAULT_AVATAR);
  await fail(screen);
  expect(screen.getByText('V')).toBeTruthy();
  expect(screen.queryByTestId('image-placeholder')).toBeNull();
});

test('a failed avatar retries its real picture instead of staying on the fallback', async () => {
  jest.useFakeTimers();
  try {
    const screen = await render(<Avatar username="vanilla" uri="https://cdn.invalid/flaky.png" size={48} />);
    await fail(screen);
    expect(shownUri(screen)).toBe(DEFAULT_AVATAR);
    await act(() => { jest.advanceTimersByTime(2_000); });
    expect(shownUri(screen)).toBe('https://cdn.invalid/flaky.png');
  } finally {
    jest.useRealTimers();
  }
});

test.each([
  ['a big chat image', 350, 215, 64],
  ['a tall narrow slot', 40, 300, 18],
  ['a short wide banner', 330, 60, 36],
  ['a server icon', 50, 50, 23],
])('the cat mark is an undistorted square in %s', async (_label, width, height, expected) => {
  const screen = await render(<ImagePlaceholder mark />);
  await layout(screen.getByTestId('image-placeholder'), width, height);
  const markView = screen.getByTestId('image-placeholder-mark');
  const style = StyleSheet.flatten(markView.props.style);
  expect(style.width).toBe(expected);
  expect(style.height).toBe(expected);
  expect(markView.props.resizeMode).toBe('contain');
});

test('a failed banner stops showing the loading placeholder', async () => {
  const screen = await render(<FadeInImage uri="https://cdn.invalid/missing.png" />);
  expect(screen.getByTestId('image-placeholder')).toBeTruthy();
  await act(() => { fireEvent(screen.getByTestId('expo-image'), 'error'); });
  expect(screen.queryByTestId('image-placeholder')).toBeNull();
});
