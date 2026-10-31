import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AddServerScreen from '../../../app/(app)/add-server';
import DiscoverServersScreen from '../../../app/(app)/discover-servers';

const mockJoin = jest.fn(async () => true);
const mockOpen = jest.fn();
const mockLookup = jest.fn();
const mockFetch = jest.fn();
let mockCentral = true;
let mockServers: { id: string; name: string }[] = [];

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock('lucide-react-native', () => ({ ChevronLeft: 'Icon', SquarePlus: 'Icon', Search: 'Icon' }));
jest.mock('@/components', () => {
  const RN = require('react-native');
  return { Text: RN.Text, Pressable: RN.Pressable, Avatar: RN.View, FadeInImage: RN.View, ImagePlaceholder: RN.View };
});
jest.mock('@/stores/authStore', () => ({ useAuthStore: (select: (s: unknown) => unknown) => select({ user: { accountType: mockCentral ? 'central' : 'local' } }) }));
jest.mock('@/stores/serverStore', () => ({
  useServerStore: (select: (s: unknown) => unknown) => select({ servers: mockServers }),
  normalizeServerUrl: (url: string) => url.replace(/\/+$/, ''),
}));
jest.mock('@/hooks/useJoinServer', () => ({ useJoinServer: () => ({ join: mockJoin, joiningKey: null, error: null, clearError: jest.fn() }) }));
jest.mock('@/hooks/useOpenServer', () => ({ useOpenServer: () => mockOpen }));
jest.mock('@/utils/mediaUrl', () => ({ resolveMediaUrl: (v: string | null) => v }));
jest.mock('@/lib/serverDirectory', () => ({
  ...jest.requireActual('@/lib/serverDirectory'),
  lookupInvite: (...args: unknown[]) => mockLookup(...args),
  fetchDiscovery: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock('@/lib/api', () => ({ createAuthenticatedApi: jest.fn() }));

beforeEach(() => { jest.clearAllMocks(); mockCentral = true; mockServers = []; });

describe('Add Server', () => {
  test('an address joins directly', async () => {
    const screen = await render(<AddServerScreen />);
    await fireEvent.changeText(screen.getByLabelText('joinServers.addHint'), 'realm.example.com');
    await act(async () => { fireEvent.press(screen.getByText('joinServers.continue')); });
    expect(mockJoin).toHaveBeenCalledWith({ serverUrl: 'realm.example.com' });
    expect(mockLookup).not.toHaveBeenCalled();
  });

  test('an invite link shows the server first, then joins with its code', async () => {
    mockLookup.mockResolvedValue({ code: 'AbC123', serverUrl: 'https://cozy.invalid', serverName: 'Cozy Realm', memberCount: 12 });
    const screen = await render(<AddServerScreen />);
    await fireEvent.changeText(screen.getByLabelText('joinServers.addHint'), 'https://catrealm.app/invite/AbC123');
    await act(async () => { fireEvent.press(screen.getByText('joinServers.continue')); });
    expect(mockLookup).toHaveBeenCalledWith('AbC123');
    expect(screen.getByText('Cozy Realm')).toBeTruthy();
    expect(mockJoin).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByText('joinServers.join')); });
    expect(mockJoin).toHaveBeenCalledWith({ serverUrl: 'https://cozy.invalid', inviteCode: 'AbC123' });
  });

  test('a bad invite is explained', async () => {
    mockLookup.mockRejectedValue(new Error('That invite does not exist.'));
    const screen = await render(<AddServerScreen />);
    await fireEvent.changeText(screen.getByLabelText('joinServers.addHint'), 'catrealm.app/invite/NOPE99');
    await act(async () => { fireEvent.press(screen.getByText('joinServers.continue')); });
    expect(screen.getByText('That invite does not exist.')).toBeTruthy();
  });

  test('local accounts are told why they cannot add servers', async () => {
    mockCentral = false;
    const screen = await render(<AddServerScreen />);
    expect(screen.getByText('joinServers.centralOnly')).toBeTruthy();
    expect(screen.queryByLabelText('joinServers.addHint')).toBeNull();
  });
});

describe('Discover Servers', () => {
  const entry = (name: string, serverUrl: string) => ({
    serverUrl, inviteCode: `${name}-code`, inviteUrl: '', serverName: name, serverDescription: `${name} desc`,
    serverIcon: null, serverBanner: null, memberCount: 3,
  });

  test('lists public realms; joined ones open, others join with their invite', async () => {
    mockServers = [{ id: 'https://mine.invalid', name: 'Mine' }];
    mockFetch.mockResolvedValue([entry('Mine', 'https://mine.invalid'), entry('Cozy', 'https://cozy.invalid')]);
    const screen = await render(<DiscoverServersScreen />);
    await waitFor(() => expect(screen.getByText('Cozy desc')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByLabelText('joinServers.join Cozy')); });
    expect(mockJoin).toHaveBeenCalledWith({ serverUrl: 'https://cozy.invalid', inviteCode: 'Cozy-code' });
    await act(async () => { fireEvent.press(screen.getByLabelText('joinServers.open Mine')); });
    expect(mockOpen).toHaveBeenCalledWith(mockServers[0]);
  });

  test('search is sent to Central after a pause', async () => {
    jest.useFakeTimers();
    try {
      mockFetch.mockResolvedValue([]);
      const screen = await render(<DiscoverServersScreen />);
      await act(async () => { jest.advanceTimersByTime(0); });
      await fireEvent.changeText(screen.getByLabelText('joinServers.searchPlaceholder'), 'cats');
      await act(async () => { jest.advanceTimersByTime(400); });
      expect(mockFetch).toHaveBeenLastCalledWith('cats');
      expect(screen.getByText('joinServers.noMatches')).toBeTruthy();
    } finally { jest.useRealTimers(); }
  });
});
