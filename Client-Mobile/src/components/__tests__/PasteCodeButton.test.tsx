import { act, fireEvent, render } from '@testing-library/react-native';
import CentralLoginScreen from '../../../app/(auth)/central-login';
import Verify2FAScreen from '../../../app/(auth)/verify-2fa';
import { PasteCodeButton } from '../PasteCodeButton';

const mockRead = jest.fn<Promise<string>, []>();
const mockLogin = jest.fn(async (_username: string, _code: string) => {});
let mockLoading = false;

jest.mock('expo-clipboard', () => ({ getStringAsync: () => mockRead() }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ username: 'nya' }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({ useTheme: () => ({ colors: {}, spacing: {}, radius: {} }) }));
jest.mock('../Pressable', () => ({ Pressable: require('react-native').Pressable }));
jest.mock('../Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/components', () => {
  const RN = require('react-native');
  return {
    AuthCard: RN.View, AuthScreenShell: RN.View, AuthScreenHeader: RN.View,
    AuthTabRow: RN.View, Text: RN.Text, Pressable: RN.Pressable,
  };
});
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (select: (state: unknown) => unknown) => select({
    centralLogin: mockLogin, loading: mockLoading, clearError: jest.fn(),
    user: null, token: null, error: null,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockRead.mockReset();
  mockLoading = false;
});

test.each([CentralLoginScreen, Verify2FAScreen])('pastes and submits the fresh code on %p', async (Screen) => {
  mockRead.mockResolvedValue(' 012 345\n');
  const screen = await render(<Screen />);
  if (Screen === CentralLoginScreen) {
    await fireEvent.changeText(screen.getByPlaceholderText('auth.usernamePlaceholder'), ' nya ');
  }
  const placeholder = Screen === CentralLoginScreen ? 'auth.twoFACodePlaceholder' : 'auth.sixDigitCodePlaceholder';
  await fireEvent.changeText(screen.getByPlaceholderText(placeholder), '999999');
  expect(mockRead).not.toHaveBeenCalled();
  await act(async () => { await fireEvent.press(screen.getByText('auth.pasteAndGo')); });
  expect(mockLogin).toHaveBeenCalledTimes(1);
  expect(mockLogin).toHaveBeenCalledWith('nya', '012345');
  expect(screen.getByPlaceholderText(placeholder).props.value).toBe('012345');
});

test.each(['', '12345', '1234567', 'code:123456'])('rejects invalid clipboard content %p without signing in', async (text) => {
  mockRead.mockResolvedValue(text);
  const screen = await render(<Verify2FAScreen />);
  await act(async () => { await fireEvent.press(screen.getByText('auth.pasteAndGo')); });
  expect(mockLogin).not.toHaveBeenCalled();
  expect(screen.getByText('auth.clipboardInvalidCode')).toBeTruthy();
});

test('explains denied clipboard access', async () => {
  mockRead.mockRejectedValue(new Error('denied'));
  const screen = await render(<Verify2FAScreen />);
  await act(async () => { await fireEvent.press(screen.getByText('auth.pasteAndGo')); });
  expect(mockLogin).not.toHaveBeenCalled();
  expect(screen.getByText('auth.clipboardReadFailed')).toBeTruthy();
});

test('does not read the clipboard without a username or while login is pending', async () => {
  const screen = await render(<CentralLoginScreen />);
  await fireEvent.press(screen.getByText('auth.pasteAndGo'));
  expect(mockRead).not.toHaveBeenCalled();
  mockLoading = true;
  const verification = await render(<Verify2FAScreen />);
  await fireEvent.press(verification.getByText('auth.pasteAndGo'));
  expect(mockRead).not.toHaveBeenCalled();
});

test('ignores repeated taps and does not submit after leaving the screen', async () => {
  let resolveRead!: (value: string) => void;
  mockRead.mockReturnValue(new Promise((resolve) => { resolveRead = resolve; }));
  const onCode = jest.fn(async () => {});
  const screen = await render(<PasteCodeButton onCode={onCode} />);
  await act(async () => {
    await fireEvent.press(screen.getByText('auth.pasteAndGo'));
    await fireEvent.press(screen.getByText('auth.pasteAndGo'));
  });
  expect(mockRead).toHaveBeenCalledTimes(1);
  await screen.unmount();
  await act(async () => { resolveRead('123456'); });
  expect(onCode).not.toHaveBeenCalled();
});
