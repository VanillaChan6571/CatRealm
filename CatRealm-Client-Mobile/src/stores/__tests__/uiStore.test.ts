import { useUIStore } from '../uiStore';

beforeEach(() => useUIStore.setState(useUIStore.getInitialState(), true));

test('channel → server → channel waits for each outgoing animation', () => {
  const observed: boolean[] = [];
  const unsubscribe = useUIStore.subscribe((s) => observed.push(s.serverDrawerOpen && s.channelsSheetOpen));
  const ui = useUIStore.getState();
  ui.setChannelsSheetOpen(true);
  ui.setServerDrawerOpen(true);
  expect(useUIStore.getState()).toMatchObject({ serverDrawerOpen: false, channelsSheetOpen: false, closingDrawer: 'channels', pendingDrawer: 'servers' });
  ui.setChannelsSheetOpen(false); // Late outgoing dismissal must preserve the destination.
  ui.finishDrawerClose('servers'); // An unrelated completion cannot advance the transition.
  expect(useUIStore.getState().serverDrawerOpen).toBe(false);
  ui.finishDrawerClose('channels');
  expect(useUIStore.getState()).toMatchObject({ serverDrawerOpen: true, channelsSheetOpen: false });
  ui.setChannelsSheetOpen(true);
  expect(useUIStore.getState().channelsSheetOpen).toBe(false);
  ui.finishDrawerClose('servers');
  expect(useUIStore.getState()).toMatchObject({ serverDrawerOpen: false, channelsSheetOpen: true });
  unsubscribe();
  expect(observed).not.toContain(true);
});

test('rapid toggles update the queued destination before React renders', () => {
  const ui = useUIStore.getState();
  ui.setChannelsSheetOpen(true);
  ui.toggleServerDrawer();
  ui.toggleServerDrawer();
  expect(useUIStore.getState().pendingDrawer).toBeNull();
  ui.toggleServerDrawer();
  expect(useUIStore.getState()).toMatchObject({ serverDrawerOpen: false, pendingDrawer: 'servers' });
  ui.setChannelsSheetOpen(true);
  ui.finishDrawerClose('channels');
  expect(useUIStore.getState()).toMatchObject({ serverDrawerOpen: false, channelsSheetOpen: true });
});

test('closeAll cancels the queued destination without skipping the exit', () => {
  const ui = useUIStore.getState();
  ui.setChannelsSheetOpen(true);
  ui.setServerDrawerOpen(true);
  ui.closeAll();
  expect(useUIStore.getState()).toMatchObject({ closingDrawer: 'channels', pendingDrawer: null });
  ui.finishDrawerClose('channels');
  expect(useUIStore.getState()).toMatchObject({ serverDrawerOpen: false, channelsSheetOpen: false, closingDrawer: null });
});

test('handoff keeps the server drawer open until channels are ready', () => {
  const ui = useUIStore.getState();
  ui.setServerDrawerOpen(true);
  ui.handoffToChannels();
  expect(useUIStore.getState()).toMatchObject({ serverDrawerOpen: true, channelsSheetOpen: true, drawerHandoff: true });
  ui.clearDrawerHandoff();
  expect(useUIStore.getState()).toMatchObject({ serverDrawerOpen: false, channelsSheetOpen: true, drawerHandoff: false });
});

test('closing channels during a handoff releases both drawers', () => {
  const ui = useUIStore.getState();
  ui.setServerDrawerOpen(true);
  ui.handoffToChannels();
  ui.setChannelsSheetOpen(false);
  expect(useUIStore.getState()).toMatchObject({ serverDrawerOpen: false, channelsSheetOpen: false, drawerHandoff: false });
});
