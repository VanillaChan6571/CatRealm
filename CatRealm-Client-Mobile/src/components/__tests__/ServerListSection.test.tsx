import { fireEvent, render } from '@testing-library/react-native';
import { ServerListSection } from '../ServerListSection';

const mockCreate = jest.fn();
const mockMove = jest.fn();
const mockRemove = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockToggle = jest.fn();
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
let mockIsTablet = false;
jest.mock('@/hooks/useDeviceLayout', () => ({ useDeviceLayout: () => ({ isTablet: mockIsTablet }) }));
const mockServers = ['Alpha', 'Beta', 'Gamma'].map((name) => ({ id: name, name, membersOnline: 3, mention: 0 }));
const mockFolders = [
  { id: 'friends', name: 'Friends', color: '#5865F2', isOpen: true, serverUrls: ['Alpha'] },
  { id: 'games', name: 'Games', color: '#23A559', isOpen: false, serverUrls: ['Beta'] },
];
jest.mock('@/stores/serverStore', () => ({
  useServerStore: (select: (s: unknown) => unknown) => select({
    servers: mockServers, serverFolders: mockFolders,
    serverLayout: [{ type: 'folder', folderId: 'friends' }, { type: 'folder', folderId: 'games' }, { type: 'server', url: 'Gamma' }],
    createFolder: mockCreate, addServerToFolder: mockMove, removeServerFromFolder: mockRemove,
    updateFolder: mockUpdate, deleteFolder: mockDelete, toggleFolder: mockToggle, reorderLayout: jest.fn(),
  }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, args?: { name?: string }) => args?.name ? `${key} ${args.name}` : key }) }));
jest.mock('@/lib/realmReadState', () => ({ syncRealmUnreadCounts: jest.fn(), useRealmUnreadStore: (select: (state: unknown) => unknown) => select({ byServer: {} }) }));
jest.mock('@/theme', () => ({ useTheme: () => ({ colors: {}, spacing: {}, radius: {} }) }));
jest.mock('lucide-react-native', () => ({
  ArrowUpDown: 'Icon', ChevronDown: 'Icon', ChevronRight: 'Icon', ChevronUp: 'Icon',
  Folder: 'Icon', FolderOpen: 'Icon', FolderPlus: 'Icon', MoreHorizontal: 'Icon', X: 'Icon', Trash2: 'Icon', Check: 'Icon',
}));
jest.mock('../Text', () => ({ Text: require('react-native').Text }));
jest.mock('../Pressable', () => ({ Pressable: require('react-native').Pressable }));
jest.mock('../ServerIcon', () => ({ ServerIcon: () => null }));
jest.mock('../IconBtn', () => ({ IconBtn: ({ accessibilityLabel, onPress, disabled }: { accessibilityLabel: string; onPress: () => void; disabled?: boolean }) =>
  require('react').createElement(require('react-native').Pressable, { accessibilityLabel, onPress, disabled }) }));
jest.mock('../Sheet', () => ({ Sheet: ({ open, children, presentation }: { open: boolean; children: unknown; presentation: string }) => open
  ? require('react').createElement(require('react-native').View, { testID: `editor-${presentation}` }, children) : null }));

beforeEach(() => { jest.clearAllMocks(); mockIsTablet = false; });
const setup = (onServerPress = jest.fn()) => render(<ServerListSection variant="panel" activeServerId="Alpha" onServerPress={onServerPress} />);

test.each([false, true])('server editing uses the correct presentation on tablet=%s', async (isTablet) => {
  mockIsTablet = isTablet;
  const screen = await setup();
  await fireEvent.press(screen.getByLabelText('folders.serverOptions Alpha'));
  expect(screen.getByTestId(isTablet ? 'editor-left' : 'editor-bottom')).toBeTruthy();
  await fireEvent.press(screen.getByText('folders.createFolder'));
  expect(screen.getByTestId(isTablet ? 'editor-left' : 'editor-bottom')).toBeTruthy();
});

test('visible server menu moves a grouped server without opening the server', async () => {
  const open = jest.fn();
  const screen = await setup(open);
  await fireEvent.press(screen.getByLabelText('folders.serverOptions Alpha'));
  await fireEvent.press(screen.getByText('folders.moveToFolder Games'));
  expect(mockMove).toHaveBeenCalledWith('Alpha', 'games');
  expect(open).not.toHaveBeenCalled();
  expect(screen.queryByText('folders.manageServer')).toBeNull();
});

test('new folder requires a name and selection, and supports multiple servers', async () => {
  const screen = await setup();
  await fireEvent.press(screen.getByText('folders.newFolder'));
  await fireEvent.press(screen.getByText('folders.saveSelection'));
  expect(mockCreate).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText('folders.folderName'), '  Weekend  ');
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Alpha' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Gamma' }));
  await fireEvent.press(screen.getByText('folders.saveSelection'));
  expect(mockCreate).toHaveBeenCalledWith(['Alpha', 'Gamma'], 'Weekend');
});

test('creating from a server preselects it, and cancelling does not mutate folders', async () => {
  const screen = await setup();
  await fireEvent.press(screen.getByLabelText('folders.serverOptions Alpha'));
  await fireEvent.press(screen.getByText('folders.createFolder'));
  expect(screen.getByRole('checkbox', { name: 'Alpha' }).props.accessibilityState.checked).toBe(true);
  await fireEvent.press(screen.getByLabelText('common.close'));
  expect(mockCreate).not.toHaveBeenCalled();
});

test('folder menu lets users add servers from another folder', async () => {
  const screen = await setup();
  await fireEvent.press(screen.getByLabelText('folders.folderOptions Friends'));
  await fireEvent.press(screen.getByText('folders.addServers'));
  expect(screen.queryByRole('checkbox', { name: 'Alpha' })).toBeNull();
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Beta' }));
  await fireEvent.press(screen.getByText('folders.saveSelection'));
  expect(mockMove).toHaveBeenCalledWith('Beta', 'friends');
});

test('server menu can return a server to the ungrouped list', async () => {
  const screen = await setup();
  await fireEvent.press(screen.getByLabelText('folders.serverOptions Alpha'));
  await fireEvent.press(screen.getByText('folders.removeFromFolder'));
  expect(mockRemove).toHaveBeenCalledWith('Alpha', 'friends');
});

test('folder settings retain rename and deletion', async () => {
  const screen = await setup();
  await fireEvent.press(screen.getByLabelText('folders.folderOptions Friends'));
  await fireEvent.changeText(screen.getByLabelText('folders.folderName'), 'Favorites');
  await fireEvent.press(screen.getByText('common.save'));
  expect(mockUpdate).toHaveBeenCalledWith('friends', { name: 'Favorites', color: '#5865F2' });
  await fireEvent.press(screen.getByLabelText('folders.folderOptions Games'));
  await fireEvent.press(screen.getByText('common.delete'));
  expect(mockDelete).toHaveBeenCalledWith('games');
});

test('another ellipsis swaps folder details without closing and resets unsaved fields', async () => {
  mockIsTablet = true;
  const screen = await setup();
  await fireEvent.press(screen.getByLabelText('folders.folderOptions Friends'));
  await fireEvent.changeText(screen.getByLabelText('folders.folderName'), 'Unsaved');
  await fireEvent.press(screen.getByLabelText('folders.folderOptions Games'));
  expect(screen.getByLabelText('folders.folderName').props.value).toBe('Games');
  expect(screen.getByTestId('editor-left')).toBeTruthy();
  await fireEvent.press(screen.getByText('common.save'));
  expect(mockUpdate).toHaveBeenCalledWith('games', { name: 'Games', color: '#23A559' });
});
