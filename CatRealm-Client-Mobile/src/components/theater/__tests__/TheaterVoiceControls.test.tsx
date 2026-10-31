import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { TheaterVoiceControls } from '../TheaterVoiceControls';

// Cold CI transforms native UI dependencies on the first render.
jest.setTimeout(15_000);

jest.mock('@/theme', () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock('@/components/Text', () => ({ Text: require('react-native').Text }));
jest.mock('lucide-react-native', () => ({ Phone: 'Icon', PhoneOff: 'Icon', Mic: 'Icon', MicOff: 'Icon', Headphones: 'Icon', HeadphoneOff: 'Icon' }));
jest.mock('@/stores/theaterStore', () => ({ useTheaterStore: Object.assign(
  (select: (s: unknown) => unknown) => select(mockState), { getState: () => mockState },
) }));
const mockState = {
  channelId: 'theater', serverId: 'realm', voiceStatus: 'disconnected', selfMicEnabled: false, selfDeafened: false,
  mediaAudioUpdating: false, joinVoice: jest.fn(), leaveVoice: jest.fn(), toggleMic: jest.fn(), toggleDeafen: jest.fn(),
};
const press = async (target: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(target, { stopPropagation: jest.fn() });
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockState, { channelId: 'theater', voiceStatus: 'disconnected', selfMicEnabled: false, selfDeafened: false, mediaAudioUpdating: false });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('watching displays Not In Call, and joining requires the audio warning confirmation', async () => {
  const screen = await render(<TheaterVoiceControls />);
  expect(screen.getByText('Not In Call')).toBeTruthy();
  expect(screen.queryByLabelText('Unmute microphone')).toBeNull();
  await press(screen.getByLabelText('Join theater voice'));
  expect(mockState.joinVoice).not.toHaveBeenCalled();
  const [, message, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect(message).toContain('video quieter');
  expect(message).toContain('microphone muted');
  expect(buttons[0]).toMatchObject({ text: 'Keep Watching', style: 'cancel' });
  buttons[1].onPress();
  expect(mockState.joinVoice).toHaveBeenCalledTimes(1);
});

test('a confirmation left open cannot join voice in a different theater', async () => {
  const screen = await render(<TheaterVoiceControls />);
  await press(screen.getByLabelText('Join theater voice'));
  mockState.channelId = 'different-theater';
  (Alert.alert as jest.Mock).mock.calls[0][2][1].onPress();
  expect(mockState.joinVoice).not.toHaveBeenCalled();
});

test('only a connected voice room shows In Call and microphone controls', async () => {
  mockState.voiceStatus = 'connecting';
  const screen = await render(<TheaterVoiceControls overlay />);
  expect(screen.getByText('Connecting…')).toBeTruthy();
  expect(screen.queryByText('In Call')).toBeNull();
  await press(screen.getByLabelText('Cancel joining theater voice'));
  expect(mockState.leaveVoice).toHaveBeenCalledTimes(1);
  mockState.voiceStatus = 'connected';
  await screen.rerender(<TheaterVoiceControls overlay />);
  expect(screen.getByText('In Call')).toBeTruthy();
  await press(screen.getByLabelText('Unmute microphone'));
  expect(mockState.toggleMic).toHaveBeenCalledTimes(1);
  await press(screen.getByLabelText('Leave theater voice'));
  expect(mockState.leaveVoice).toHaveBeenCalledTimes(2);
});

test('leaving voice disables join until teardown completes', async () => {
  mockState.voiceStatus = 'disconnecting';
  const screen = await render(<TheaterVoiceControls />);
  expect(screen.getByText('Leaving Call…')).toBeTruthy();
  await press(screen.getByLabelText('Join theater voice'));
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(mockState.joinVoice).not.toHaveBeenCalled();
});
