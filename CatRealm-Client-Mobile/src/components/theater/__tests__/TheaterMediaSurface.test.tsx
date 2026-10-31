import { render } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { useEffect } from 'react';
import YoutubeIframe from 'react-native-youtube-iframe';
import { TheaterMediaSurface } from '../TheaterMediaSurface';

// Match the other native-view theater suites' budget on the shared build host.
jest.setTimeout(15_000);

jest.mock('@/stores/authStore', () => ({ useAuthStore: (select: (s: unknown) => unknown) => select({ token: 'central-token', user: { accountType: 'central' }, serverUrl: null }) }));
jest.mock('@/stores/serverStore', () => ({ useServerStore: (select: (s: unknown) => unknown) => select({ servers: [] }) }));
jest.mock('expo', () => ({ useEvent: () => ({ status: 'readyToPlay' }) }));
jest.mock('expo-video', () => ({
  useVideoPlayer: (_source: unknown, setup: (player: unknown) => void) => { setup(mockPlayer); return mockPlayer; },
  isPictureInPictureSupported: () => mockPipSupported,
  VideoView: 'VideoView',
}));
jest.mock('react-native-youtube-iframe', () => jest.fn());
jest.mock('@/components/Text', () => ({ Text: 'Text' }));
jest.mock('lucide-react-native', () => ({ PictureInPicture2: 'Icon' }));

const mockPlayer = { loop: false, audioMixingMode: '', staysActiveInBackground: false, muted: false, volume: 1, currentTime: 0, playing: false, play: jest.fn(), pause: jest.fn() };
let mockPipSupported = false;
const mockYouTubeMount = jest.fn();
const mockYouTubeUnmount = jest.fn();
beforeEach(() => {
  mockPipSupported = false;
  jest.clearAllMocks(); mockPlayer.playing = false; mockPlayer.currentTime = 0;
  (YoutubeIframe as unknown as jest.Mock).mockImplementation(function MockYouTube() {
    useEffect(() => { mockYouTubeMount(); return mockYouTubeUnmount; }, []);
    return null;
  });
  mockPlayer.play.mockImplementation(() => { mockPlayer.playing = true; });
  mockPlayer.pause.mockImplementation(() => { mockPlayer.playing = false; });
});

test('shared volume/mute reaches the native player and resizing does not reset it', async () => {
  const props = { videoUrl: 'https://media.invalid/video.mp4', playing: true, positionMs: 5000, width: 320, height: 180 };
  const screen = await render(<TheaterMediaSurface {...props} volume={0.25} muted />);
  expect(mockPlayer.volume).toBe(0.25);
  expect(mockPlayer.muted).toBe(true);
  expect(mockPlayer.currentTime).toBe(5);
  expect(mockPlayer.audioMixingMode).toBe('mixWithOthers');
  expect(mockPlayer.staysActiveInBackground).toBe(true);
  await screen.rerender(<TheaterMediaSurface {...props} width={184} height={104} volume={0.25} muted={false} />);
  expect(mockPlayer.volume).toBe(0.25);
  expect(mockPlayer.muted).toBe(false);
});

test('YouTube does not initialize a competing native audio player', async () => {
  await render(<TheaterMediaSurface videoUrl="youtube:abcdefghijk" playing positionMs={0} width={320} height={180} />);
  expect(mockPlayer.play).not.toHaveBeenCalled();
});

test('YouTube is contained and centered through landscape/fullscreen/mini-player resizing without remounting', async () => {
  const props = { videoUrl: 'youtube:abcdefghijk', playing: true, positionMs: 5000, width: 320, height: 180, muted: true, volume: 0.25 };
  const screen = await render(<TheaterMediaSurface {...props} />);
  for (const [width, height] of [[932, 430], [640, 180], [430, 932], [184, 104], [320, 180]]) {
    await screen.rerender(<TheaterMediaSurface {...props} width={width} height={height} />);
    const embed = (YoutubeIframe as unknown as jest.Mock).mock.calls.at(-1)[0];
    expect(embed.width).toBeLessThanOrEqual(width);
    expect(embed.height).toBeLessThanOrEqual(height);
    expect(embed.width / embed.height).toBeCloseTo(16 / 9);
    expect(embed).toMatchObject({ videoId: 'abcdefghijk', play: true, mute: true, volume: 25, allowWebViewZoom: false });
    expect(embed.webViewProps.scrollEnabled).toBe(false);
    expect(screen.getByTestId('theater-youtube-container').props.style).toMatchObject({ width, height, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' });
  }
  expect(mockYouTubeMount).toHaveBeenCalledTimes(1);
  expect(mockYouTubeUnmount).not.toHaveBeenCalled();
  expect(mockPlayer.play).not.toHaveBeenCalled();
});

test('sync ticks do not undo a local pause from native PiP', async () => {
  const props = { videoUrl: 'https://media.invalid/video.mp4', playing: true, positionMs: 5000, width: 320, height: 180 };
  const screen = await render(<TheaterMediaSurface {...props} />);
  mockPlayer.playing = false;
  mockPlayer.play.mockClear();
  await screen.rerender(<TheaterMediaSurface {...props} positionMs={10000} />);
  expect(mockPlayer.play).not.toHaveBeenCalled();
  expect(mockPlayer.currentTime).toBe(5);
});

test('PiP follows fullscreen control visibility without restarting video', async () => {
  mockPipSupported = true;
  const props = { videoUrl: 'https://media.invalid/video.mp4', playing: true, positionMs: 5000, width: 320, height: 180 };
  const opacity = new Animated.Value(1);
  const screen = await render(<TheaterMediaSurface {...props} controlsVisible controlsOpacity={opacity} />);
  expect(screen.getByLabelText('Picture in picture')).toBeTruthy();
  await screen.rerender(<TheaterMediaSurface {...props} controlsVisible={false} controlsOpacity={opacity} />);
  expect(screen.queryByLabelText('Picture in picture')).toBeNull();
  expect(screen.getByTestId('theater-pip-control', { includeHiddenElements: true }).props.pointerEvents).toBe('none');
  await screen.rerender(<TheaterMediaSurface {...props} controlsVisible controlsOpacity={opacity} />);
  expect(screen.getByLabelText('Picture in picture')).toBeTruthy();
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  expect(mockPlayer.pause).not.toHaveBeenCalled();
});

describe('YouTube follows the room play state', () => {
  const { act } = require('@testing-library/react-native');
  const { useImperativeHandle } = require('react');
  type Events = { onReady: () => void; onChangeState: (state: string) => void };
  let events: Events;
  // Real YouTube behaviour: seekTo() on an unstarted/cued video starts playback.
  const youtube = { time: 0, seekTo: jest.fn(), playVideo: jest.fn(), pauseVideo: jest.fn() };
  const report = (state: string) => act(async () => { events.onChangeState(state); });
  beforeEach(() => {
    Object.assign(youtube, { time: 0 });
    // React 19 hands `ref` to function components as an ordinary prop.
    (YoutubeIframe as unknown as jest.Mock).mockImplementation(function MockYouTube(props: Events & { ref: unknown }) {
      events = props;
      useImperativeHandle(props.ref, () => ({
        getCurrentTime: async () => youtube.time,
        seekTo: (seconds: number) => { youtube.seekTo(seconds); youtube.time = seconds; },
        playVideo: youtube.playVideo,
        pauseVideo: youtube.pauseVideo,
      }));
      return null;
    });
  });
  const base = { videoUrl: 'youtube:abcdefghijk', positionMs: 45_000, width: 320, height: 180 };

  test('a paused room loads cued at the position, is never seeked before it starts, and never plays', async () => {
    const screen = await render(<TheaterMediaSurface {...base} playing={false} />);
    expect((YoutubeIframe as unknown as jest.Mock).mock.calls.at(-1)[0].initialPlayerParams.start).toBe(45);
    await act(async () => { events.onReady(); });
    await report('video cued');
    await screen.rerender(<TheaterMediaSurface {...base} playing={false} positionMs={46_000} />);
    await act(async () => {});
    expect(youtube.seekTo).not.toHaveBeenCalled();
    expect(youtube.playVideo).not.toHaveBeenCalled();
    // If YouTube starts on its own anyway, it is paused again.
    await report('playing');
    expect(youtube.pauseVideo).toHaveBeenCalledTimes(1);
  });

  test('a playing room actually starts YouTube, then keeps it in sync', async () => {
    const screen = await render(<TheaterMediaSurface {...base} playing />);
    await act(async () => { events.onReady(); });
    await report('video cued');
    expect(youtube.playVideo).toHaveBeenCalled();
    youtube.playVideo.mockClear();
    youtube.time = 10;
    await report('playing');
    await act(async () => {});
    expect(youtube.seekTo).toHaveBeenCalledWith(45);
    await screen.rerender(<TheaterMediaSurface {...base} playing positionMs={60_000} />);
    await act(async () => {});
    expect(youtube.seekTo).toHaveBeenLastCalledWith(60);
    expect(youtube.playVideo).not.toHaveBeenCalled(); // already running
  });

  test('pressing pause pauses YouTube, and play resumes it', async () => {
    const screen = await render(<TheaterMediaSurface {...base} playing />);
    await act(async () => { events.onReady(); });
    await report('playing');
    youtube.playVideo.mockClear();
    await screen.rerender(<TheaterMediaSurface {...base} playing={false} />);
    expect(youtube.pauseVideo).toHaveBeenCalledTimes(1);
    await report('paused');
    await screen.rerender(<TheaterMediaSurface {...base} playing />);
    expect(youtube.playVideo).toHaveBeenCalledTimes(1);
  });

  test('a finished video is not restarted', async () => {
    await render(<TheaterMediaSurface {...base} playing />);
    await act(async () => { events.onReady(); });
    await report('playing');
    youtube.playVideo.mockClear();
    await report('ended');
    expect(youtube.playVideo).not.toHaveBeenCalled();
  });
});
