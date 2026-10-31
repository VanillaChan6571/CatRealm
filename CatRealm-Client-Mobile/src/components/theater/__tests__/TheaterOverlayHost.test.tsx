import { act, fireEvent, render } from '@testing-library/react-native';
import { Animated, PanResponder, StyleSheet, type PanResponderCallbacks } from 'react-native';
import { TheaterOverlayHost } from '../../TheaterMiniPlayer';

// The first render lazily loads/transforms native UI dependencies on cold CI.
jest.setTimeout(15_000);

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key === 'theater.openChat' ? 'Open chat' : key }) }));
jest.mock('../TheaterChatPreview', () => ({ TheaterChatPreview: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 20, left: 0, right: 0 }) }));
jest.mock('@/theme', () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: (select: (s: unknown) => unknown) => select({ user: null }) }));
jest.mock('@/stores/serverStore', () => ({ useServerStore: (select: (s: unknown) => unknown) => select({ channels: {} }) }));
jest.mock('@/stores/theaterStore', () => ({ useTheaterStore: (select: (s: unknown) => unknown) => select(mockState) }));
jest.mock('@/components/Text', () => ({ Text: 'Text' }));
jest.mock('../TheaterMediaSurface', () => ({ TheaterMediaSurface: function Media() {
  const React = require('react');
  React.useEffect(() => { mockMount(); return mockUnmount; }, []);
  return null;
} }));
jest.mock('lucide-react-native', () => ({ GripHorizontal: 'Icon', Maximize: 'Icon', Maximize2: 'Icon', MessageCircle: 'Icon', Pause: 'Icon', Play: 'Icon', Volume2: 'Icon', VolumeX: 'Icon', X: 'Icon', Phone: 'Icon', PhoneOff: 'Icon', Mic: 'Icon', MicOff: 'Icon', Headphones: 'Icon', HeadphoneOff: 'Icon' }));

const mockReplace = jest.fn();
const mockMount = jest.fn();
const mockUnmount = jest.fn();
const mockLeave = jest.fn();
const mockSetFocused = jest.fn((focused: boolean) => { mockState.focused = focused; });
const mockState = {
  channelId: 'channel', serverId: 'realm', channelName: 'Movies', queue: [], participants: [],
  playbackState: { videoUrl: 'https://media.invalid/movie.mp4' as string | null, playing: true },
  overlayMode: 'floating', expandedFrame: null as null | { x: number; y: number; width: number; height: number },
  focused: false, focusControlsVisible: true, setFocused: mockSetFocused, mediaVolume: 1, mediaMuted: false,
  setFocusControlsVisible: jest.fn((visible: boolean) => { mockState.focusControlsVisible = visible; }),
  computeExpectedPositionMs: () => 0, leaveTheater: mockLeave,
  setOverlayMode: jest.fn((mode: string) => { mockState.overlayMode = mode; }),
  setPanelTab: jest.fn(),
  realmUser: null as null | { id: string; permissions: number }, control: jest.fn(),
};
let callbacks: PanResponderCallbacks;
const createResponder = PanResponder.create;
function gesture(name: keyof PanResponderCallbacks, dx = 0, dy = 0, touches: { pageX: number; pageY: number }[] = []) {
  return callbacks[name]?.({ nativeEvent: { touches } } as never, { dx, dy, numberActiveTouches: touches.length } as never);
}
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  mockState.overlayMode = 'floating'; mockState.expandedFrame = null;
  mockState.focused = false; mockState.playbackState.videoUrl = 'https://media.invalid/movie.mp4';
  mockState.focusControlsVisible = true;
  mockState.realmUser = null;
  jest.spyOn(PanResponder, 'create').mockImplementation((config) => { callbacks = config; return createResponder(config); });
});

test('fullscreen playback works for an administrator who is not the host', async () => {
  mockState.overlayMode = 'expanded'; mockState.focused = true; mockState.focusControlsVisible = true;
  mockState.realmUser = { id: 'admin', permissions: 2 ** 43 };
  const screen = await render(<TheaterOverlayHost />);
  expect(screen.getByLabelText('Join theater voice')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Pause theater video'));
  expect(mockState.control).toHaveBeenCalledWith('channel', { playing: false, positionMs: 0 });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('drag handlers reach a native view and capture movement over embedded media', async () => {
  const screen = await render(<TheaterOverlayHost />);
  const surface = screen.getByTestId('theater-drag-surface');
  expect(surface.props.onMoveShouldSetResponderCapture).toEqual(expect.any(Function));
  expect(surface.props.onResponderMove).toEqual(expect.any(Function));
  expect(screen.getByTestId('theater-media-surface').props.pointerEvents).toBe('none');
  expect(gesture('onStartShouldSetPanResponderCapture')).toBe(false);
  expect(gesture('onMoveShouldSetPanResponderCapture', 2)).toBe(false);
  expect(gesture('onMoveShouldSetPanResponderCapture', 20)).toBe(true);
});

test('dragging and interrupted drags do not navigate; the next tap still opens theater', async () => {
  const screen = await render(<TheaterOverlayHost />);
  await act(() => { gesture('onPanResponderGrant'); gesture('onPanResponderMove', -100, -100); gesture('onPanResponderTerminate', -100, -100); });
  await fireEvent.press(screen.getByLabelText('Return to theater'));
  expect(mockReplace).not.toHaveBeenCalled();
  gesture('onStartShouldSetPanResponderCapture');
  await fireEvent.press(screen.getByLabelText('Return to theater'));
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/server/[serverId]/theater/[channelId]', params: { serverId: 'realm', channelId: 'channel' } });
  expect(mockState.overlayMode).toBe('floating');
});

test('collapse preserves the player and restores dragging, including a missing expanded frame', async () => {
  mockState.overlayMode = 'expanded';
  mockState.expandedFrame = { x: 0, y: 0, width: 400, height: 225 };
  const screen = await render(<TheaterOverlayHost />);
  expect(screen.getByTestId('theater-drag-surface').props.onResponderMove).toBeUndefined();
  mockState.overlayMode = 'floating'; mockState.expandedFrame = null;
  await screen.rerender(<TheaterOverlayHost />);
  expect(screen.getByTestId('theater-drag-surface').props.onResponderMove).toEqual(expect.any(Function));
  mockState.overlayMode = 'expanded';
  await screen.rerender(<TheaterOverlayHost />);
  expect(screen.getByTestId('theater-drag-surface').props.onResponderMove).toEqual(expect.any(Function));
  expect(mockMount).toHaveBeenCalledTimes(1);
  expect(mockUnmount).not.toHaveBeenCalled();
});

test('the floating player can be closed without navigating back into theater', async () => {
  const screen = await render(<TheaterOverlayHost />);
  const stopPropagation = jest.fn();
  await fireEvent.press(screen.getByLabelText('Leave theater'), { stopPropagation });
  expect(stopPropagation).toHaveBeenCalled();
  expect(mockLeave).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
});

test('fullscreen Open chat opens the embedded tab without navigation or remounting media', async () => {
  mockState.overlayMode = 'expanded'; mockState.focused = true;
  const screen = await render(<TheaterOverlayHost />);
  expect(screen.queryByLabelText('Leave theater')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Open chat'), { stopPropagation: jest.fn() });
  expect(mockSetFocused).toHaveBeenCalledWith(false);
  expect(mockState.setPanelTab).toHaveBeenCalledWith('chat');
  expect(mockState.setOverlayMode).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
  mockState.expandedFrame = { x: 0, y: 0, width: 400, height: 225 };
  await screen.rerender(<TheaterOverlayHost />);
  expect(screen.getByLabelText('Theater player')).toBeTruthy();
  expect(mockMount).toHaveBeenCalledTimes(1);
  expect(mockUnmount).not.toHaveBeenCalled();
  expect(mockLeave).not.toHaveBeenCalled();
});

test('repeated drags to the same corner settle instead of leaving an offset player', async () => {
  const screen = await render(<TheaterOverlayHost />);
  const position = () => StyleSheet.flatten(screen.getByTestId('theater-positioner').props.style);
  await act(() => { gesture('onPanResponderGrant'); gesture('onPanResponderRelease', -10000, -10000); jest.advanceTimersByTime(300); });
  const corner = position();
  await act(() => { gesture('onPanResponderGrant'); gesture('onPanResponderMove', 20, 20); });
  expect(position().left).not.toEqual(corner.left);
  await act(() => { gesture('onPanResponderRelease', 20, 20); });
  expect(position().left).toEqual(corner.left);
  expect(position().top).toEqual(corner.top);
});

test('pinching the floating player resizes it within bounds and keeps the new size', async () => {
  const screen = await render(<TheaterOverlayHost />);
  const size = () => StyleSheet.flatten(screen.getByTestId('theater-drag-surface').props.style);
  const pinch = (spread: number) => [{ pageX: 100, pageY: 100 }, { pageX: 100 + spread, pageY: 100 }];
  expect(gesture('onMoveShouldSetPanResponderCapture', 0, 0, pinch(100))).toBe(true);
  const media = () => StyleSheet.flatten(screen.getByTestId('theater-media-surface').props.style);
  await act(() => { gesture('onPanResponderGrant'); gesture('onPanResponderMove', 0, 0, pinch(100)); gesture('onPanResponderMove', 0, 0, pinch(150)); });
  await act(() => { jest.advanceTimersByTime(20); });
  // Mid-pinch, the box and the video resize together, before the fingers lift.
  expect(size()).toMatchObject({ width: 276, height: Math.round(276 * 9 / 16) + 28 });
  expect(media()).toMatchObject({ width: 276, height: Math.round(276 * 9 / 16) });
  // Lifting a finger mid-pinch must not turn the resize into a jump.
  await act(() => { gesture('onPanResponderMove', 400, 400); gesture('onPanResponderRelease', 400, 400); jest.advanceTimersByTime(300); });
  expect(size().width).toBe(276);
  await act(() => { gesture('onPanResponderGrant'); gesture('onPanResponderMove', 0, 0, pinch(100)); gesture('onPanResponderMove', 0, 0, pinch(1)); gesture('onPanResponderRelease'); jest.advanceTimersByTime(300); });
  expect(size().width).toBe(144);
});

test.each([null, 'https://media.invalid/movie.mp4'])('fullscreen controls fade out and a video tap restores exit controls with source %s', async (videoUrl) => {
  mockState.overlayMode = 'expanded'; mockState.focused = true;
  mockState.playbackState.videoUrl = videoUrl;
  const timing = jest.spyOn(Animated, 'timing');
  // No stage measurement yet: fullscreen must still have usable escape controls.
  const screen = await render(<TheaterOverlayHost />);
  expect(screen.getByLabelText('Exit fullscreen')).toBeTruthy();
  await act(() => { jest.advanceTimersByTime(3000); });
  await screen.rerender(<TheaterOverlayHost />);
  expect(timing).toHaveBeenCalledWith(expect.anything(), { toValue: 0, duration: 250, useNativeDriver: true });
  expect(screen.queryByLabelText('Open chat')).toBeNull();
  expect(screen.queryByLabelText('Exit fullscreen')).toBeNull();
  expect(screen.getByTestId('theater-fullscreen-header', { includeHiddenElements: true }).props.pointerEvents).toBe('none');
  expect(screen.getByTestId('theater-fullscreen-controls', { includeHiddenElements: true }).props.pointerEvents).toBe('none');
  await fireEvent.press(screen.getByLabelText('Theater player'));
  await screen.rerender(<TheaterOverlayHost />);
  expect(timing).toHaveBeenCalledWith(expect.anything(), { toValue: 1, duration: 180, useNativeDriver: true });
  expect(screen.getByLabelText('Open chat')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Exit fullscreen'), { stopPropagation: jest.fn() });
  expect(mockSetFocused).toHaveBeenCalledWith(false);
  await screen.rerender(<TheaterOverlayHost />);
  expect(screen.queryByLabelText('Exit fullscreen')).toBeNull();
  expect(mockMount).toHaveBeenCalledTimes(videoUrl ? 1 : 0);
  expect(mockUnmount).not.toHaveBeenCalled();
});

test('fullscreen control interactions suspend auto-hide until release, then restart the timer', async () => {
  mockState.overlayMode = 'expanded'; mockState.focused = true;
  const screen = await render(<TheaterOverlayHost />);
  await fireEvent(screen.getByTestId('theater-fullscreen-controls'), 'touchStart');
  await act(() => { jest.advanceTimersByTime(4000); });
  expect(mockState.focusControlsVisible).toBe(true);
  await fireEvent(screen.getByTestId('theater-fullscreen-controls'), 'touchEnd');
  await act(() => { jest.advanceTimersByTime(2000); });
  expect(mockState.focusControlsVisible).toBe(true);
  await fireEvent.press(screen.getByLabelText('Theater player'));
  await act(() => { jest.advanceTimersByTime(2000); });
  expect(mockState.focusControlsVisible).toBe(true);
  await act(() => { jest.advanceTimersByTime(501); });
  expect(mockState.focusControlsVisible).toBe(false);
});

test('leaving fullscreen cancels auto-hide and restores inline controls', async () => {
  mockState.overlayMode = 'expanded'; mockState.focused = true;
  mockState.expandedFrame = { x: 0, y: 80, width: 400, height: 225 };
  const screen = await render(<TheaterOverlayHost />);
  await fireEvent.press(screen.getByLabelText('Exit fullscreen'), { stopPropagation: jest.fn() });
  await screen.rerender(<TheaterOverlayHost />);
  await act(() => { jest.advanceTimersByTime(3000); });
  expect(mockState.focusControlsVisible).toBe(true);
  expect(screen.getByLabelText('Enter fullscreen')).toBeTruthy();
});

test('an empty queue can enter fullscreen without mounting a native media player', async () => {
  mockState.overlayMode = 'expanded';
  mockState.expandedFrame = { x: 0, y: 80, width: 400, height: 225 };
  mockState.playbackState.videoUrl = null;
  const screen = await render(<TheaterOverlayHost />);
  await fireEvent.press(screen.getByLabelText('Enter fullscreen'), { stopPropagation: jest.fn() });
  expect(mockSetFocused).toHaveBeenCalledWith(true);
  expect(mockMount).not.toHaveBeenCalled();
  await screen.rerender(<TheaterOverlayHost />);
  expect(screen.getByLabelText('Exit fullscreen')).toBeTruthy();
});
