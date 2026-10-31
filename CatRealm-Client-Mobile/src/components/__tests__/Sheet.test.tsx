import { act, fireEvent, render as renderNative, waitFor } from '@testing-library/react-native';
import { useState, type ReactElement } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { Sheet } from '../Sheet';
import { OverlayProvider } from '../OverlayPortal';

const render = (element: ReactElement) => renderNative(element, { wrapper: OverlayProvider });

jest.mock('@/theme', () => ({ useTheme: () => ({ colors: {}, radius: { xl: 24 }, shadow: { sheet: {} } }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 20, left: 0, right: 0 }) }));

let mockWindowWidth = 1024;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWindowWidth, height: 768, scale: 2, fontScale: 1 }),
}));
beforeEach(() => { mockWindowWidth = 1024; });
afterEach(() => jest.restoreAllMocks());

test.each([
  { width: 1024, edge: 320, left: 320, panelWidth: 420 },
  { width: 600, edge: 320, left: 320, panelWidth: 280 },
  { width: 500, edge: 320, left: 220, panelWidth: 280 },
])('drawers extend from the list and fit a $width-point window', async ({ width, edge, left, panelWidth }) => {
  mockWindowWidth = width;
  const screen = await render(<Sheet open presentation="left" anchorRight={edge} onClose={jest.fn()}><Text>Editor</Text></Sheet>);
  const viewport = StyleSheet.flatten(screen.getByTestId('sheet-viewport').props.style);
  const panel = StyleSheet.flatten(screen.getByTestId('sheet-panel').props.style);
  expect(viewport.left).toBe(left);
  expect(viewport.overflow).toBe('hidden');
  expect(panel.width).toBe(panelWidth);
  expect(viewport.left + panel.width).toBeLessThanOrEqual(width);
  expect(StyleSheet.flatten(screen.getByTestId('sheet-backdrop').props.style).left).toBe(left);
  expect(screen.queryByTestId('sheet-modal')).toBeNull();
});

test('an open tablet editor updates in place from source-list taps and cleans up on close', async () => {
  function Harness() {
    const [selection, setSelection] = useState<string | null>('Alpha');
    return <>
      <Pressable accessibilityLabel="Beta options" onPress={() => setSelection('Beta')}><Text>Beta</Text></Pressable>
      <Sheet open={selection !== null} presentation="left" anchorRight={320} onClose={() => setSelection(null)}>
        <Text>{`Editing ${selection}`}</Text>
      </Sheet>
    </>;
  }
  const screen = await render(<Harness />);
  expect(screen.getByText('Editing Alpha')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Beta options'));
  expect(screen.getByText('Editing Beta')).toBeTruthy();
  expect(screen.queryByText('Editing Alpha')).toBeNull();
  expect(screen.queryByTestId('sheet-modal')).toBeNull();
  await fireEvent.press(screen.getByTestId('sheet-backdrop'));
  await waitFor(() => expect(screen.queryByTestId('sheet-panel')).toBeNull());
});

function ClosingHarness() {
  const [selection, setSelection] = useState<string | null>('Alpha');
  return <>
    <Pressable accessibilityLabel="Beta options" onPress={() => setSelection('Beta')}><Text>Beta</Text></Pressable>
    <Sheet open={selection !== null} presentation="left" anchorRight={320} onClose={() => setSelection(null)}>
      {selection ? <>
        <Text>{`Editing ${selection}`}</Text>
        <Pressable testID="editor-close" onPress={() => setSelection(null)}><Text>X</Text></Pressable>
      </> : null}
    </Sheet>
  </>;
}

function controlAnimations() {
  const completions: Array<(result: { finished: boolean }) => void> = [];
  jest.spyOn(Animated, 'parallel').mockImplementation(() => ({
    start: (callback) => { if (callback) completions.push(callback); },
    stop: jest.fn(), reset: jest.fn(),
  }));
  return completions;
}

test.each(['editor-close', 'sheet-backdrop'])('%s retains editor content until the closing animation finishes', async (target) => {
  const completions = controlAnimations();
  const screen = await render(<ClosingHarness />);
  await fireEvent.press(screen.getByTestId(target));
  expect(screen.getByTestId('sheet-panel')).toBeTruthy();
  expect(screen.getByText('Editing Alpha')).toBeTruthy();
  await act(() => completions[completions.length - 1]({ finished: true }));
  expect(screen.queryByTestId('sheet-panel')).toBeNull();
});

test('opening another server during dismissal cancels stale close completion', async () => {
  const completions = controlAnimations();
  const screen = await render(<ClosingHarness />);
  await fireEvent.press(screen.getByTestId('editor-close'));
  const finishOldClose = completions[completions.length - 1];
  await fireEvent.press(screen.getByLabelText('Beta options'));
  await act(() => finishOldClose({ finished: true }));
  expect(screen.getByText('Editing Beta')).toBeTruthy();
  expect(screen.getByTestId('sheet-panel')).toBeTruthy();
});

test('existing sheets still rise vertically and display the bottom-sheet handle', async () => {
  const screen = await render(<Sheet open onClose={jest.fn()}><Text>Editor</Text></Sheet>);
  const style = StyleSheet.flatten(screen.getByTestId('sheet-panel').props.style);
  expect(style.transform[0]).toHaveProperty('translateY');
  expect(screen.getByTestId('sheet-modal')).toBeTruthy();
  expect(screen.getByTestId('sheet-handle')).toBeTruthy();
});

test('left drawers animate horizontally, respect safe areas and omit the bottom-sheet handle', async () => {
  const screen = await render(<Sheet open presentation="left" onClose={jest.fn()}><Text>Editor</Text></Sheet>);
  const style = StyleSheet.flatten(screen.getByTestId('sheet-panel').props.style);
  expect(style.transform[0]).toHaveProperty('translateX');
  expect(style.paddingTop).toBe(24);
  expect(style.width).toBeLessThanOrEqual(420);
  expect(style.borderTopLeftRadius).toBe(0);
  expect(screen.queryByTestId('sheet-handle')).toBeNull();
});

test('bottom sheets keep their last row clear of the system navigation bar', async () => {
  const screen = await render(<Sheet open onClose={jest.fn()}><Text>Actions</Text></Sheet>);
  // Edge-to-edge modals draw under the nav bar; the mocked bottom inset is 20.
  expect(StyleSheet.flatten(screen.getByTestId('sheet-panel').props.style).paddingBottom).toBe(28);
});
