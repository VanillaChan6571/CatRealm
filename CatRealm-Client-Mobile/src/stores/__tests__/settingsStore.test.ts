import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSettingsStore as store } from '../settingsStore';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(async () => {}) }));
jest.mock('@/lib/api', () => ({ createAuthenticatedApi: () => mockApi }));
jest.mock('../authStore', () => ({ useAuthStore: { getState: () => ({ user: { accountType: 'central' } }) } }));
jest.mock('@/i18n', () => ({ __esModule: true, default: { changeLanguage: jest.fn() } }));
const mockApi = { get: jest.fn(), put: jest.fn(async (_url: string, _payload: unknown) => {}) };
beforeEach(() => {
  jest.clearAllMocks(); store.setState(store.getInitialState(), true);
  mockApi.get.mockResolvedValue({ data: {} });
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
});
test.each([null, '{}', '{"theaterChatPreviews":"false"}'])('defaults chat previews on for missing/invalid old preferences %s', async (raw) => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(raw);
  await store.getState().hydrate();
  expect(store.getState().theaterChatPreviews).toBe(true);
});
test('explicit false persists across hydration without syncing this mobile preference to the server', async () => {
  store.getState().setTheaterChatPreviews(false);
  const raw = (AsyncStorage.setItem as jest.Mock).mock.calls.at(-1)[1];
  expect(JSON.parse(raw).theaterChatPreviews).toBe(false);
  expect(mockApi.put).not.toHaveBeenCalled();
  store.setState(store.getInitialState(), true);
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(raw);
  mockApi.get.mockResolvedValue({ data: { theaterChatPreviews: true } });
  await store.getState().hydrate();
  expect(store.getState().theaterChatPreviews).toBe(false);
  store.getState().setSoundSetting('soundAmbience', true);
  expect(mockApi.put.mock.calls[0][1]).not.toHaveProperty('theaterChatPreviews');
});
