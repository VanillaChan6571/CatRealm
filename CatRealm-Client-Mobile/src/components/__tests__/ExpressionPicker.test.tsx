import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ExpressionPicker } from '../ExpressionPicker';
import { placePanel } from '../ExpressionPanel';

let mockWindow = { width: 390, height: 844, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
jest.mock('@/lib/expressionCache', () => ({ getOrigin: (url: string) => url, normalizeExprName: (name: string) => name }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({ useTheme: () => ({ colors: {}, radius: { sm: 6, lg: 14 }, shadow: { sheet: {} } }) }));
// Realm list order: Beta above Alpha, so the tablet column must list Beta first.
const mockServers = [
  { id: 'alpha', name: 'Alpha', url: 'https://alpha.test' },
  { id: 'beta', name: 'Beta', url: 'https://beta.test' },
];
jest.mock('@/stores/serverStore', () => ({
  useServerStore: (select: (state: unknown) => unknown) => select({
    servers: mockServers,
    activeServerId: null,
    serverLayout: [{ type: 'server', url: 'beta' }, { type: 'server', url: 'alpha' }],
    serverFolders: [],
  }),
}));
jest.mock('lucide-react-native', () => ({ Clock: 'Icon' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../GifPickerTab', () => ({ GifPickerTab: () => null }));
jest.mock('../ServerIcon', () => ({ ServerIcon: () => null }));
jest.mock('../OverlayPortal', () => ({ OverlayPortal: ({ children }: { children: React.ReactNode }) => children }));

const PHONE = { width: 390, height: 844, scale: 2, fontScale: 1 };
const TABLET = { width: 1180, height: 820, scale: 2, fontScale: 1 };
const alphaEmote = { name: 'alphablob', emote: 'https://alpha.test/a.png', origin: 'https://alpha.test' };
const betaEmote = { name: 'betablob', emote: 'https://beta.test/b.png', origin: 'https://beta.test' };

const renderPicker = (onSelect = jest.fn(), serverUrl: string | null = null) => render(
  <ExpressionPicker
    open
    onClose={jest.fn()}
    onSelect={onSelect}
    serverUrl={serverUrl}
    expressionLookup={new Map([['alphablob', alphaEmote], ['betablob', betaEmote]]) as never}
    canLoadExpressions
  />,
);
const cellWidth = (screen: Awaited<ReturnType<typeof renderPicker>>) =>
  StyleSheet.flatten(screen.getByLabelText('😀').props.style).width;

beforeEach(() => { mockWindow = PHONE; });

test('a phone gets the compact panel: full width, icon-only sources and a 7-wide emoji grid', async () => {
  const screen = await renderPicker();
  expect(screen.getByTestId('expression-panel')).toBeTruthy();
  // Icon-only: the source is named for screen readers; the only "Beta" text is its grid heading.
  expect(screen.getByLabelText('Beta')).toBeTruthy();
  expect(screen.getAllByText('Beta')).toHaveLength(1);
  expect(screen.queryByText('Alpha')).toBeNull();
  await fireEvent.press(screen.getByLabelText('chat.defaultEmoji'));
  // 390pt window less 8pt gutters, the 56pt source column and 10pt grid padding; 7 cells, 4pt gaps.
  expect(cellWidth(screen)).toBeCloseTo((390 - 16 - 56 - 20 - 4 * 6) / 7);
});

test('search finds emoji by name across every category and hides the category strip', async () => {
  const screen = await renderPicker();
  await fireEvent.press(screen.getByLabelText('chat.defaultEmoji'));
  expect(screen.getAllByText('chat.emojiSmileys').length).toBeGreaterThan(0);
  await fireEvent.changeText(screen.getByLabelText('chat.searchExpressions'), 'cat');
  expect(screen.getByLabelText('🐱')).toBeTruthy(); // Animals, not the selected Smileys category
  expect(screen.queryByLabelText('😀')).toBeNull();
  expect(screen.queryAllByText('chat.emojiSmileys')).toHaveLength(0);
  await fireEvent.changeText(screen.getByLabelText('chat.searchExpressions'), 'zzzqqq');
  expect(screen.getByText('chat.noResultsFound')).toBeTruthy();
});

test('a tablet gets the desktop panel: tabs, realms in realm-list order, then Default at the very bottom', async () => {
  mockWindow = TABLET;
  const screen = await renderPicker();
  expect(screen.getByTestId('expression-panel')).toBeTruthy();
  expect(screen.getByText('chat.emojisTab')).toBeTruthy();
  expect(screen.getByText('chat.stickersTab')).toBeTruthy();
  const column = screen.getAllByRole('button').map((row) => row.props.accessibilityLabel)
    .filter((label) => ['Alpha', 'Beta', 'chat.defaultEmoji'].includes(label));
  expect(column).toEqual(['Beta', 'Alpha', 'chat.defaultEmoji']);
  await fireEvent.press(screen.getByLabelText('chat.defaultEmoji'));
  // 540pt panel less the 140pt source column and 10pt gutters, 8 cells with 4pt gaps.
  expect(cellWidth(screen)).toBeCloseTo((380 - 4 * 7) / 8);
});

test('the tablet panel opens on the current realm\'s emotes', async () => {
  mockWindow = TABLET;
  const screen = await renderPicker(jest.fn(), 'https://alpha.test');
  expect(screen.getByLabelText('alphablob')).toBeTruthy();
  expect(screen.queryByLabelText('betablob')).toBeNull();
});

test('a realm without emotes opens the tablet panel on the top realm in the column', async () => {
  mockWindow = TABLET;
  const screen = await renderPicker(jest.fn(), 'https://gamma.test');
  expect(screen.getByLabelText('betablob')).toBeTruthy();
});

test('picking a realm in the tablet source column shows and inserts its emotes', async () => {
  mockWindow = TABLET;
  const onSelect = jest.fn();
  const screen = await renderPicker(onSelect, 'https://beta.test');
  await fireEvent.press(screen.getByLabelText('Alpha'));
  await fireEvent.press(screen.getByLabelText('alphablob'));
  expect(onSelect.mock.calls[0][0]).toBe(':alphablob:');
});

test('the tablet panel opens above its button, right edges aligned, and stays on screen', () => {
  // Button at x 900-940, top 700, in a 1180×820 window.
  expect(placePanel({ x: 900, y: 700, width: 40, height: 40 }, 1180, 820, 540)).toEqual({ left: 400, bottom: 128 });
  // A button near the left edge clamps the panel to the 12pt gutter.
  expect(placePanel({ x: 20, y: 700, width: 40, height: 40 }, 1180, 820, 540)?.left).toBe(12);
  // No button (reactions): no placement, so the panel is centred.
  expect(placePanel(null, 1180, 820, 540)).toBeNull();
});
