const mockGetState = jest.fn();
const mockExpire = jest.fn();

jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mockGetState() } }));
jest.mock('@/lib/centralDeviceCredentials', () => ({
  getCentralDeviceHeadersForUser: async () => ({
    'X-CatRealm-Device-Id': 'device-id', 'X-CatRealm-Device-Secret': 'device-secret',
  }),
}));
jest.mock('../accountSession', () => ({ captureAccountSession: jest.fn() }));

import axios from 'axios';
import { confirmOrExpireCentralSession } from '../api';

function unauthorized(token: string) {
  return {
    isAxiosError: true,
    response: { status: 401, data: { error: 'Invalid token' } },
    config: { headers: { Authorization: `Bearer ${token}` } },
  };
}

beforeEach(() => {
  jest.restoreAllMocks();
  mockExpire.mockClear();
  mockGetState.mockReturnValue({
    user: { id: 'account-a', accountType: 'central' }, token: 'new-token', expireCentralSession: mockExpire,
  });
});

test('a 401 from an older request does not expire the replacement session', async () => {
  const get = jest.spyOn(axios, 'get');
  await confirmOrExpireCentralSession(unauthorized('old-token'));
  expect(get).not.toHaveBeenCalled();
  expect(mockExpire).not.toHaveBeenCalled();
});

test('a verification started before account switch cannot expire the new account', async () => {
  let rejectVerification!: (error: unknown) => void;
  const get = jest.spyOn(axios, 'get').mockReturnValue(new Promise((_resolve, reject) => { rejectVerification = reject; }));
  const check = confirmOrExpireCentralSession(unauthorized('new-token'));
  await Promise.resolve();
  mockGetState.mockReturnValue({
    user: { id: 'account-b', accountType: 'central' }, token: 'account-b-token', expireCentralSession: mockExpire,
  });
  rejectVerification(unauthorized('new-token'));
  await check;
  expect(get).toHaveBeenCalledTimes(1);
  expect(mockExpire).not.toHaveBeenCalled();
});
