import { act, render } from '@testing-library/react-native';
import { Animated, Text } from 'react-native';
import { useUIStore } from '@/stores/uiStore';
import { useDrawerTransition } from '@/hooks/useDrawerTransition';

function Drawer({ open, width = 300 }: { open: boolean; width?: number }) {
  const { mounted } = useDrawerTransition(open, width);
  return mounted ? <Text>Drawer</Text> : null;
}

afterEach(() => jest.restoreAllMocks());

test('obsolete close completion cannot hide a reopened drawer', async () => {
  const completions: Array<(result: { finished: boolean }) => void> = [];
  const stop = jest.fn();
  jest.spyOn(Animated, 'parallel').mockImplementation(() => ({
    start: (callback) => { if (callback) completions.push(callback); },
    stop, reset: jest.fn(),
  }));
  const screen = await render(<Drawer open />);
  await screen.rerender(<Drawer open={false} />);
  const obsoleteClose = completions[completions.length - 1];
  expect(screen.getByText('Drawer')).toBeTruthy();
  await screen.rerender(<Drawer open />);
  await act(async () => { obsoleteClose({ finished: true }); });
  expect(screen.getByText('Drawer')).toBeTruthy();
  expect(stop).toHaveBeenCalled();
  await screen.rerender(<Drawer open={false} />);
  await act(async () => { completions[completions.length - 1]({ finished: true }); });
  expect(screen.queryByText('Drawer')).toBeNull();
});

test('keeps the outgoing drawer visible until it closes, then opens the queued drawer', async () => {
  useUIStore.setState(useUIStore.getInitialState(), true);
  useUIStore.getState().setChannelsSheetOpen(true);
  const animations: Array<{ finish?: (result: { finished: boolean }) => void }> = [];
  jest.spyOn(Animated, 'parallel').mockImplementation(() => {
    const entry: { finish?: (result: { finished: boolean }) => void } = {};
    animations.push(entry);
    return { start: (callback) => { entry.finish = callback; }, stop: jest.fn(), reset: jest.fn() };
  });
  function Panel({ kind }: { kind: 'channels' | 'servers' }) {
    const open = useUIStore((s) => kind === 'channels' ? s.channelsSheetOpen : s.serverDrawerOpen);
    const closing = useUIStore((s) => s.closingDrawer === kind);
    const { mounted } = useDrawerTransition(open, 300, () => useUIStore.getState().finishDrawerClose(kind), closing);
    return mounted ? <Text>{kind}</Text> : null;
  }
  const screen = await render(<><Panel kind="channels" /><Panel kind="servers" /></>);
  await act(async () => { useUIStore.getState().setServerDrawerOpen(true); });
  expect(screen.getByText('channels')).toBeTruthy();
  expect(screen.queryByText('servers')).toBeNull();
  const exit = animations[animations.length - 1];
  await act(async () => { exit.finish?.({ finished: false }); });
  expect(screen.queryByText('servers')).toBeNull();
  await act(async () => { exit.finish?.({ finished: true }); });
  expect(screen.queryByText('channels')).toBeNull();
  expect(screen.getByText('servers')).toBeTruthy();
});
