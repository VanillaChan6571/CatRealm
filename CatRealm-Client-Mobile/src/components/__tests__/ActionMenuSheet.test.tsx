import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Platform, Pressable, Text } from 'react-native';
import { ActionMenuSheet } from '../ActionMenuSheet';

jest.mock('@/theme', () => ({ useTheme: () => ({ colors: {}, radius: { md: 10, xl: 24 }, shadow: { sheet: {} } }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../Text', () => ({ Text: jest.requireActual('react-native').Text }));
jest.mock('../Pressable', () => {
  const { Pressable: RNPressable } = jest.requireActual('react-native');
  return { Pressable: ({ haptic: _haptic, ...props }: Record<string, unknown>) => <RNPressable {...props} /> };
});

// The native modal stand-in: shows its children while visible and keeps its latest props, so a
// test can play the part of iOS reporting that the dismissal has finished.
const mockModal: { props: { visible?: boolean; onDismiss?: () => void } } = { props: {} };
jest.mock('react-native/Libraries/Modal/Modal', () => ({
  __esModule: true,
  default: (props: { visible?: boolean; onDismiss?: () => void; children?: unknown }) => {
    mockModal.props = props;
    return props.visible ? props.children : null;
  },
}));
const modal = () => mockModal.props;

const Icon = () => null;

function Harness({ onPick }: { onPick: () => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityLabel="Attach" onPress={() => setOpen(true)}><Text>Attach</Text></Pressable>
    <ActionMenuSheet
      open={open}
      onClose={() => setOpen(false)}
      items={[{ key: 'media', label: 'Photos & videos', icon: Icon, onPress: onPick }]}
    />
  </>;
}

const pickFromMenu = async (onPick: () => void) => {
  const screen = await render(<Harness onPick={onPick} />);
  await fireEvent.press(screen.getByLabelText('Attach'));
  await fireEvent.press(screen.getByLabelText('Photos & videos'));
  // Still closing: a picker presented now would sit on the closing modal and be torn down with it.
  expect(onPick).not.toHaveBeenCalled();
  await waitFor(() => expect(modal().visible).toBe(false));
  return screen;
};

test('on iOS a menu action waits until the native modal reports it has been dismissed', async () => {
  expect(Platform.OS).toBe('ios');
  const onPick = jest.fn();
  await pickFromMenu(onPick);
  expect(onPick).not.toHaveBeenCalled();
  await act(() => modal().onDismiss?.());
  expect(onPick).toHaveBeenCalledTimes(1);
  // A late duplicate dismissal does not run it twice.
  await act(() => modal().onDismiss?.());
  expect(onPick).toHaveBeenCalledTimes(1);
});

test('the action still runs if the modal never reports its dismissal', async () => {
  const onPick = jest.fn();
  await pickFromMenu(onPick);
  await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1), { timeout: 2000 });
});

test('closing the menu without choosing runs nothing', async () => {
  const onPick = jest.fn();
  const screen = await render(<Harness onPick={onPick} />);
  await fireEvent.press(screen.getByLabelText('Attach'));
  await fireEvent.press(screen.getByTestId('sheet-backdrop'));
  await waitFor(() => expect(modal().visible).toBe(false));
  await act(() => modal().onDismiss?.());
  expect(onPick).not.toHaveBeenCalled();
});
