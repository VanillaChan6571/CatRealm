const mockGet = jest.fn();
jest.mock('@/lib/api', () => ({
  AUTH_BASE: 'https://auth.example.test',
  createAuthenticatedApi: () => ({ get: mockGet }),
}));
jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/serverStore', () => ({ useServerStore: jest.fn() }));

import { loadPersonalExpressionLookup } from '../expressionCache';

const fetchSpy = jest.fn();
beforeEach(() => {
  mockGet.mockReset();
  fetchSpy.mockReset();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

test('your Central personal expressions load through the device-bound client, not a bare token', async () => {
  // Central refuses a bare bearer token (401): its sessions are bound to the device.
  mockGet.mockResolvedValue({
    data: {
      emotes: [],
      'anim-emotes': [{ name: 'squishy', owner_id: 'me', absolute_url: 'https://auth.example.test/u/squishy.gif' }],
      stickers: [{ name: 'reactive-idle', owner_id: 'me', absolute_url: 'https://auth.example.test/u/idle.png' }],
      'anim-stickers': [],
    },
  });
  const lookup = await loadPersonalExpressionLookup('https://auth.example.test', 'token');
  expect(mockGet).toHaveBeenCalledWith('/api/profile/personal-expressions/manifest');
  expect(fetchSpy).not.toHaveBeenCalled();
  const entries = [...(lookup?.values() ?? [])];
  expect(entries.map((entry) => [entry.name, entry.source])).toEqual([
    ['squishy', 'personal'],
    ['reactive-idle', 'personal'],
  ]);
});

test('a self-hosted realm account still fetches its personal set from that realm with its token', async () => {
  fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ emotes: [], 'anim-emotes': [], stickers: [], 'anim-stickers': [] }) });
  await loadPersonalExpressionLookup('https://realm.example.test', 'realm-token');
  expect(mockGet).not.toHaveBeenCalled();
  expect(fetchSpy).toHaveBeenCalledWith(
    'https://realm.example.test/api/profile/personal-expressions/manifest',
    expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer realm-token' }) }),
  );
});
