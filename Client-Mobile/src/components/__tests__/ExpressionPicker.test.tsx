import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ExpressionPicker } from '../ExpressionPicker';

let mockWindow = { width: 1180, height: 820, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
jest.mock('@/lib/expressionCache', () => ({ getOrigin: (url: string) => url, normalizeExprName: (name: string) => name }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock('@/stores/serverStore', () => ({ useServerStore: (select: (state: unknown) => unknown) => select({ servers: [], activeServerId: null }) }));
jest.mock('../Sheet', () => ({ Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? children : null) }));
jest.mock('../GifPickerTab', () => ({ GifPickerTab: () => null }));

const renderPicker = () => render(<ExpressionPicker open onClose={jest.fn()} onSelect={jest.fn()} />);
const cellWidth = (screen: Awaited<ReturnType<typeof renderPicker>>) =>
  StyleSheet.flatten(screen.getByLabelText('😀').props.style).width;

test('a tablet gets a dense grid in a capped panel instead of 8 columns spread across the screen', async () => {
  mockWindow = { ...mockWindow, width: 1180 };
  const screen = await renderPicker();
  // 560pt panel, 8pt gutters: 12 columns of ~45pt.
  expect(cellWidth(screen)).toBeCloseTo(544 / 12);
});

test('a phone keeps its 8-column grid', async () => {
  mockWindow = { ...mockWindow, width: 390 };
  const screen = await renderPicker();
  expect(cellWidth(screen)).toBeCloseTo(374 / 8);
});

test('search finds emoji by name across every category and hides the category strip', async () => {
  const screen = await renderPicker();
  expect(screen.getByText('chat.emojiSmileys')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('chat.searchExpressions'), 'cat');
  expect(screen.getByLabelText('🐱')).toBeTruthy(); // Animals, not the selected Smileys category
  expect(screen.queryByLabelText('😀')).toBeNull();
  expect(screen.queryByText('chat.emojiSmileys')).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('chat.searchExpressions'), 'zzzqqq');
  expect(screen.getByText('chat.noResultsFound')).toBeTruthy();
});
