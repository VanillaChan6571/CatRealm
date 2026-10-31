import { render, renderHook } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ConnectedChannelPulse, useConnectedChannelIds } from '../ConnectedChannelPulse';
import { PulsingBorder } from '../PulsingBorder';

const mockVoice = { serverId: 'realm-a' as string | null, channelId: 'voice-1' as string | null };
const mockTheater = { serverId: 'realm-b' as string | null, channelId: 'theater-1' as string | null };
jest.mock('@/stores/voiceStore', () => ({ useVoiceStore: (select: (state: unknown) => unknown) => select(mockVoice) }));
jest.mock('@/stores/theaterStore', () => ({ useTheaterStore: (select: (state: unknown) => unknown) => select(mockTheater) }));
jest.mock('@/theme', () => ({ useTheme: () => ({ colors: { statusColor: { online: '#23A559' } } }) }));

test('only marks the call or theater in the realm being viewed', async () => {
  expect((await renderHook(() => useConnectedChannelIds('realm-a'))).result.current)
    .toEqual({ voiceChannelId: 'voice-1', theaterChannelId: null });
  expect((await renderHook(() => useConnectedChannelIds('realm-b'))).result.current)
    .toEqual({ voiceChannelId: null, theaterChannelId: 'theater-1' });
  expect((await renderHook(() => useConnectedChannelIds(null))).result.current)
    .toEqual({ voiceChannelId: null, theaterChannelId: null });
});

test('the channel highlight is a non-interactive green fill with a green outline', async () => {
  const screen = await render(<ConnectedChannelPulse radius={8} />);
  expect(screen.getByTestId('connected-channel-pulse').props.pointerEvents).toBe('none');
  expect(StyleSheet.flatten(screen.getByTestId('pulsing-border-glow').props.style).borderColor).toBe('#23A559');
});

// The outline used to breathe via a JS-driven Animated loop, which committed a Fabric
// update every frame and hung iOS (0x8BADF00D). It must stay static.
test('PulsingBorder is a static full-strength outline that starts no animation', async () => {
  const { Animated } = require('react-native');
  const loop = jest.spyOn(Animated, 'loop');
  try {
    const screen = await render(<PulsingBorder color="#9B77FF" radius={20} />);
    const glow = StyleSheet.flatten(screen.getByTestId('pulsing-border-glow').props.style);
    expect(glow.opacity).toBeUndefined();
    expect(glow.transform).toBeUndefined();
    expect(loop).not.toHaveBeenCalled();
    await screen.unmount();
  } finally { loop.mockRestore(); }
});
