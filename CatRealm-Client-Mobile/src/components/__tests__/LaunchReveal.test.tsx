import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';
import { LaunchReveal, easedKeyframes } from '../LaunchReveal';
// The allowlist React Native's native animated module validates against (untyped internal module).
const { isSupportedInterpolationParam } = jest.requireActual('react-native/Libraries/Animated/NativeAnimatedAllowlist') as {
  isSupportedInterpolationParam: (param: string) => boolean;
};

const reduce = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled');
let frameGapMs = 16;
let rafSpy: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers();
  reduce.mockResolvedValue(false);
  frameGapMs = 16;
  // Frames arrive every `frameGapMs`; a busy JS thread means long gaps.
  rafSpy = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), frameGapMs) as unknown as number);
});
afterEach(() => { rafSpy.mockRestore(); jest.useRealTimers(); });
afterAll(() => { reduce.mockRestore(); });
const settle = () => act(async () => {});
const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });

test('holds while loading, then reveals the app and reports when done', async () => {
  const onDone = jest.fn();
  const screen = await render(<LaunchReveal ready={false} onDone={onDone} />);
  await settle();
  expect(screen.getByTestId('launch-reveal').props.pointerEvents).toBe('auto');
  await advance(5000);
  expect(onDone).not.toHaveBeenCalled();

  await screen.rerender(<LaunchReveal ready onDone={onDone} />);
  expect(screen.getByTestId('launch-reveal').props.pointerEvents).toBe('none');
  // The reveal starts after a few smooth frames. (Jest has no native animation
  // driver, so the 650 ms reveal itself completes instantly here.)
  await advance(30);
  expect(onDone).not.toHaveBeenCalled();
  await advance(100);
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('the artwork is not rebuilt when ready flips, so native animations cannot snap back', async () => {
  const multiply = jest.spyOn(Animated, 'multiply');
  try {
    const onDone = jest.fn();
    const screen = await render(<LaunchReveal ready={false} onDone={onDone} />);
    await settle();
    const built = multiply.mock.calls.length;
    expect(built).toBeGreaterThan(0);
    await screen.rerender(<LaunchReveal ready onDone={onDone} />);
    expect(multiply).toHaveBeenCalledTimes(built);
  } finally { multiply.mockRestore(); }
});

test('waits for the app to finish rendering before revealing, with a cap', async () => {
  frameGapMs = 100; // JS busy mounting the app
  const onDone = jest.fn();
  await render(<LaunchReveal ready onDone={onDone} />);
  await settle();
  await advance(1200);
  expect(onDone).not.toHaveBeenCalled();
  await advance(1100); // 1.5 s cap reached, then the reveal plays
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('with Reduce Motion the reveal is a short fade', async () => {
  reduce.mockResolvedValue(true);
  const onDone = jest.fn();
  await render(<LaunchReveal ready onDone={onDone} />);
  await settle();
  await advance(350);
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('every interpolation is accepted by the native animated module', async () => {
  // Jest runs the JS fallback, which accepts options the native driver rejects
  // (e.g. `easing`), so check the configs against the native allowlist.
  const interpolate = jest.spyOn(Animated.Value.prototype, 'interpolate');
  try {
    await render(<LaunchReveal ready={false} onDone={jest.fn()} />);
    await settle();
    expect(interpolate).toHaveBeenCalled();
    const unsupported = interpolate.mock.calls.flatMap(([config]) =>
      Object.keys(config).filter((key) => !isSupportedInterpolationParam(key)));
    expect(unsupported).toEqual([]);
  } finally { interpolate.mockRestore(); }
});

test('eased keyframes keep the endpoints and follow the curve', () => {
  const { inputRange, outputRange } = easedKeyframes([[0, 1], [0.5, 0]], (t) => t * t, 4);
  expect(inputRange).toEqual([0, 0.125, 0.25, 0.375, 0.5]);
  expect(outputRange).toEqual([1, 1 - 1 / 16, 1 - 1 / 4, 1 - 9 / 16, 0]);
});
