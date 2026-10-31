import { act, fireEvent, render, within } from '@testing-library/react-native';
import { Keyboard, StyleSheet, type KeyboardEvent } from 'react-native';
import TheaterScreen from '../../../../app/(app)/server/[serverId]/theater/[channelId]';
jest.mock('../../PulsingBorder', () => ({ PulsingBorder: () => require('react').createElement(require('react-native').View, { testID: 'pulsing-border' }) }));
jest.mock('../TheaterJoinModal', () => ({ TheaterJoinModal: () => require('react').createElement(require('react-native').View, { testID: 'theater-join-modal' }) }));
jest.mock('../TheaterChatPanel', () => ({ TheaterChatPanel: () => require('react').createElement(require('react-native').View, { testID: 'theater-chat-panel' }) }));

jest.setTimeout(15_000);
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ serverId: 'realm', channelId: 'channel' }), useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 20, left: 44, right: 0 }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock('@/hooks/useDeviceLayout', () => ({ useDeviceLayout: () => ({ width: 932, height: 430, isTablet: true, isLandscape: true }) }));
jest.mock('@/hooks/useTheaterOverlayStage', () => ({ useTheaterOverlayStage: () => ({ stageRef: { current: null }, measure: jest.fn() }) }));
jest.mock('@/components', () => {
  const RN = require('react-native');
  return { Text: RN.Text, Pressable: RN.Pressable, Avatar: RN.View };
});
jest.mock('@/components/Text', () => ({ Text: require('react-native').Text }));
jest.mock('lucide-react-native', () => ({ MessageCircle: 'Icon', ChevronLeft: 'Icon', Film: 'Icon', Play: 'Icon', Pause: 'Icon', SkipForward: 'Icon', Users: 'Icon', List: 'Icon', Plus: 'Icon', Trash2: 'Icon', ThumbsUp: 'Icon', Crown: 'Icon', Mic: 'Icon', MicOff: 'Icon', Volume2: 'Icon', VolumeX: 'Icon', Phone: 'Icon', PhoneOff: 'Icon', Headphones: 'Icon', HeadphoneOff: 'Icon' }));
jest.mock('@/stores/theaterStore', () => ({ useTheaterStore: (select: (state: unknown) => unknown) => select(mockTheater) }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ user: { id: 'me' } }) }));
jest.mock('@/stores/serverStore', () => ({ useServerStore: (select: (state: unknown) => unknown) => select(mockServer) }));
jest.mock('@/stores/channelStore', () => ({ useChannelStore: (select: (state: unknown) => unknown) => select({ lastChannelByServer: {} }) }));
jest.mock('@/stores/uiStore', () => ({ useUIStore: (select: (state: unknown) => unknown) => select({ setChannelsSheetOpen: jest.fn() }) }));

const mockTheater = {
  serverId: 'realm', channelId: 'channel', channelName: 'Theater Test', focused: false,
  queue: [], participants: [], playbackState: null, mediaVolume: 1, mediaMuted: false,
  computeExpectedPositionMs: () => 0,
  selfMicEnabled: false, control: jest.fn(),
  panelTab: 'queue', setPanelTab: jest.fn((tab: string) => { mockTheater.panelTab = tab; }),
};
const mockServer = { activeServerId: 'realm', channels: { realm: [{ id: 'channel', effective_permissions: 0 }] } };
beforeEach(() => { mockTheater.panelTab = 'queue'; mockTheater.focused = false; mockTheater.control.mockClear(); mockServer.channels.realm[0].effective_permissions = 0; });

test('a non-host can control permitted playback without joining voice', async () => {
  mockServer.channels.realm[0].effective_permissions = 2 ** 47;
  const screen = await render(<TheaterScreen />);
  expect(screen.getByText('Not In Call')).toBeTruthy();
  expect(screen.getByLabelText('Join theater voice')).toBeTruthy();
  expect(screen.queryByLabelText('Unmute microphone')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Play theater video'));
  expect(mockTheater.control).toHaveBeenCalledWith('channel', { playing: true, positionMs: 0 });
});

test('a wide landscape phone keeps inline controls and a non-overlapping queue action', async () => {
  const screen = await render(<TheaterScreen />);
  await fireEvent(screen.getByTestId('theater-body'), 'layout', { nativeEvent: { layout: { width: 932, height: 310 } } });
  expect(screen.getByTestId('theater-inline-controls')).toBeTruthy();
  expect(screen.getByText('theater.leave')).toBeTruthy();
  expect(screen.getByLabelText('theater.addVideo')).toBeTruthy();
  // Add shares the compact action row, not a separate full-width panel.
  expect(within(screen.getByTestId('theater-inline-controls')).getByLabelText('theater.addVideo')).toBeTruthy();
});

test('theater chat is accessible as a third tab without leaving the theater screen', async () => {
  const screen = await render(<TheaterScreen />);
  await fireEvent.press(screen.getByLabelText('Theater chat'));
  await screen.rerender(<TheaterScreen />);
  expect(mockTheater.panelTab).toBe('chat');
  expect(screen.getByTestId('theater-chat-panel')).toBeTruthy();
  expect(screen.getByTestId('theater-inline-controls')).toBeTruthy();
});

test('typing hides inline controls and closing the keyboard restores accessible action targets', async () => {
  const listeners: Record<string, () => void> = {};
  const addListener = Keyboard.addListener.bind(Keyboard);
  const spy = jest.spyOn(Keyboard, 'addListener').mockImplementation((event, callback) => {
    listeners[event] = () => callback({} as KeyboardEvent);
    return addListener(event, callback);
  });
  try {
    mockTheater.panelTab = 'chat';
    const screen = await render(<TheaterScreen />);
    // Stacked (portrait) layout: the chat shares the column with the controls.
    await fireEvent(screen.getByTestId('theater-body'), 'layout', { nativeEvent: { layout: { width: 430, height: 700 } } });
    await act(() => listeners.keyboardDidShow());
    expect(screen.queryByTestId('theater-inline-controls')).toBeNull();
    expect(screen.getByTestId('theater-chat-panel')).toBeTruthy();
    await act(() => listeners.keyboardDidHide());
    expect(screen.getByTestId('theater-inline-controls')).toBeTruthy();
    const buttonStyle = StyleSheet.flatten(screen.getByLabelText('theater.addVideo').props.style);
    expect(buttonStyle.minHeight).toBe(44);
    expect(buttonStyle.minWidth).toBe(44);
  } finally { spy.mockRestore(); }
});

test('explicit fullscreen removes inline chrome, and exiting restores it without waiting for rotation', async () => {
  const screen = await render(<TheaterScreen />);
  mockTheater.focused = true;
  await screen.rerender(<TheaterScreen />);
  expect(screen.queryByTestId('theater-inline-controls')).toBeNull();
  expect(screen.queryByLabelText('theater.addVideo')).toBeNull();
  expect(screen.queryByText('theater.leave')).toBeNull();
  mockTheater.focused = false;
  await screen.rerender(<TheaterScreen />);
  expect(screen.getByText('theater.leave')).toBeTruthy();
  expect(screen.getByLabelText('theater.addVideo')).toBeTruthy();
});

test('the dock inset survives iOS keyboard avoidance so the chat composer is not hidden behind the dock', async () => {
  const screen = await render(<TheaterScreen />);
  // KeyboardAvoidingView's "padding" mode replaces its own paddingBottom.
  let node = screen.getByTestId('theater-body').parent;
  let dockInset = 0;
  for (; node; node = node.parent) dockInset = Math.max(dockInset, Number(StyleSheet.flatten(node.props.style)?.paddingBottom ?? 0));
  expect(dockInset).toBe(64);
});

test('typing in the tablet sidebar chat keeps the controls and the dock inset in place', async () => {
  const listeners: Record<string, () => void> = {};
  const addListener = Keyboard.addListener.bind(Keyboard);
  const spy = jest.spyOn(Keyboard, 'addListener').mockImplementation((event, callback) => {
    listeners[event] = () => callback({} as KeyboardEvent);
    return addListener(event, callback);
  });
  try {
    mockTheater.panelTab = 'chat';
    const screen = await render(<TheaterScreen />);
    await fireEvent(screen.getByTestId('theater-body'), 'layout', { nativeEvent: { layout: { width: 1180, height: 680 } } });
    await act(() => listeners.keyboardDidShow());
    expect(screen.getByTestId('theater-inline-controls')).toBeTruthy();
    let node = screen.getByTestId('theater-body').parent;
    let dockInset = 0;
    for (; node; node = node.parent) dockInset = Math.max(dockInset, Number(StyleSheet.flatten(node.props.style)?.paddingBottom ?? 0));
    // Changing the inset mid-animation strands the composer under the iOS keyboard.
    expect(dockInset).toBe(64);
  } finally { spy.mockRestore(); }
});

test('the add button is labelled and pulses only while the queue is empty', async () => {
  try {
    const screen = await render(<TheaterScreen />);
    expect(screen.getByText('theater.addVideoShort')).toBeTruthy();
    expect(screen.getByTestId('pulsing-border')).toBeTruthy();
    mockTheater.queue = [{ id: 'q1', title: 'Clip', source_url: 'https://media.invalid/a.mp4', votes: 0 }] as never;
    await screen.rerender(<TheaterScreen />);
    expect(screen.queryByTestId('pulsing-border')).toBeNull();
  } finally {
    mockTheater.queue = [];
  }
});
