import { act, renderHook } from '@testing-library/react-native';
import type { View } from 'react-native';
import { useTheaterOverlayStage } from '../useTheaterOverlayStage';

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    const React = require('react');
    React.useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused]);
  },
  useNavigation: () => mockNavigation,
}));
type TransitionListener = (event: { data?: { closing?: boolean } }) => void;
let transitionListeners: TransitionListener[] = [];
const mockNavigation = {
  addListener: jest.fn((_event: string, listener: TransitionListener) => {
    transitionListeners.push(listener);
    return () => { transitionListeners = transitionListeners.filter((l) => l !== listener); };
  }),
};
const finishTransition = (closing = false) => act(() => { transitionListeners.forEach((l) => l({ data: { closing } })); });
jest.mock('@/stores/theaterStore', () => ({ useTheaterStore: { getState: () => mockState } }));

let mockFocused = true;
const mockState = {
  serverId: 'realm', channelId: 'channel', setOverlayMode: jest.fn(), setExpandedFrame: jest.fn(),
};
const measurements: Array<(x: number, y: number, width: number, height: number) => void> = [];
const mockView = { measureInWindow: jest.fn((callback) => measurements.push(callback)) };
async function flushLayout() { await act(() => { jest.advanceTimersByTime(50); }); }
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); measurements.length = 0; mockFocused = true; transitionListeners = [];
  mockState.serverId = 'realm'; mockState.channelId = 'channel';
});
afterEach(() => { jest.useRealTimers(); });
async function setup() {
  const screen = await renderHook(() => useTheaterOverlayStage('realm', 'channel', true, 400, 225));
  screen.result.current.stageRef.current = mockView as unknown as View;
  await finishTransition();
  await flushLayout();
  return screen;
}

test('blur floats the player and rejects delayed native measurements', async () => {
  const screen = await setup();
  expect(measurements).toHaveLength(1);
  mockFocused = false;
  await screen.rerender({});
  expect(mockState.setOverlayMode).toHaveBeenLastCalledWith('floating');
  measurements[0](0, 0, 400, 225);
  expect(mockState.setExpandedFrame).not.toHaveBeenCalled();
});

test('returning to a kept-mounted screen remeasures; old focus callbacks stay invalid', async () => {
  const screen = await setup();
  mockFocused = false; await screen.rerender({});
  mockFocused = true; await screen.rerender({});
  await finishTransition();
  await flushLayout();
  expect(measurements).toHaveLength(2);
  measurements[0](1, 1, 400, 225);
  expect(mockState.setExpandedFrame).not.toHaveBeenCalled();
  measurements[1](0, 20, 400, 225);
  expect(mockState.setExpandedFrame).toHaveBeenCalledWith({ x: 0, y: 20, width: 400, height: 225 });
});

test('an old realm screen cannot position or collapse a newly joined theater', async () => {
  const screen = await setup();
  mockState.serverId = 'other-realm';
  measurements[0](0, 0, 400, 225);
  expect(mockState.setExpandedFrame).not.toHaveBeenCalled();
  mockState.setOverlayMode.mockClear();
  await screen.unmount();
  expect(mockState.setOverlayMode).not.toHaveBeenCalled();
});

test('a newer rotation/layout measurement supersedes earlier native callbacks', async () => {
  const screen = await setup();
  screen.result.current.measure();
  await flushLayout();
  measurements[1](0, 0, 800, 400);
  measurements[0](0, 20, 400, 225);
  expect(mockState.setExpandedFrame).toHaveBeenCalledTimes(1);
  expect(mockState.setExpandedFrame).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 800, height: 400 });
});

test('unmount cancels pending layout work and invalid measurements are ignored', async () => {
  const screen = await setup();
  measurements[0](NaN, 0, 400, 225);
  measurements[0](0, 0, 0, 225);
  expect(mockState.setExpandedFrame).not.toHaveBeenCalled();
  screen.result.current.measure();
  await screen.unmount();
  await flushLayout();
  expect(mockView.measureInWindow).toHaveBeenCalledTimes(1);
});

test('the player stays floating until the screen has finished sliding in', async () => {
  const screen = await renderHook(() => useTheaterOverlayStage('realm', 'channel', true, 400, 225));
  screen.result.current.stageRef.current = mockView as unknown as View;
  await flushLayout();
  expect(mockState.setOverlayMode).not.toHaveBeenCalledWith('expanded');
  expect(measurements).toHaveLength(0);
  await finishTransition(true); // the outgoing screen's close does not count
  expect(mockState.setOverlayMode).not.toHaveBeenCalledWith('expanded');
  await finishTransition();
  await flushLayout();
  expect(mockState.setOverlayMode).toHaveBeenCalledWith('expanded');
  expect(measurements).toHaveLength(1);
});

test('without a transition event the player still expands after the fallback', async () => {
  const screen = await renderHook(() => useTheaterOverlayStage('realm', 'channel', true, 400, 225));
  screen.result.current.stageRef.current = mockView as unknown as View;
  await act(() => { jest.advanceTimersByTime(700); });
  await flushLayout();
  expect(mockState.setOverlayMode).toHaveBeenCalledWith('expanded');
  expect(measurements).toHaveLength(1);
});

test('leaving mid-slide never expands the player afterwards', async () => {
  const screen = await renderHook(() => useTheaterOverlayStage('realm', 'channel', true, 400, 225));
  mockFocused = false;
  await screen.rerender({});
  await act(() => { jest.advanceTimersByTime(1000); });
  expect(mockState.setOverlayMode).not.toHaveBeenCalledWith('expanded');
  expect(transitionListeners).toHaveLength(0);
});
