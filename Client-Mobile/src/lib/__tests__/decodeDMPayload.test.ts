import { createDMKeyBatchLoader, decodeDMPayload } from '../decodeDMPayload';
import { loadConversationSecretForCurrentDevice } from '../dmKeyStore';
import { decryptDM, decryptDMV2 } from '@/utils/dmCrypto';

jest.mock('../dmKeyStore', () => ({ loadConversationSecretForCurrentDevice: jest.fn() }));
jest.mock('@/utils/dmCrypto', () => ({
  getDMPayloadVersion: (payload: string) => JSON.parse(payload).v ?? 1,
  decryptDM: jest.fn(async () => 'legacy text'),
  decryptDMV2: jest.fn(async () => 'current text'),
}));
const loadKey = jest.mocked(loadConversationSecretForCurrentDevice);
beforeEach(() => { jest.clearAllMocks(); loadKey.mockResolvedValue('test-conversation-secret'); });

test('loads the requested conversation key even when the account sync key is absent', async () => {
  const payload = JSON.stringify({ v: 2, kid: 3 });
  await expect(decodeDMPayload(payload, null, 'conversation')).resolves.toBe('current text');
  expect(loadKey).toHaveBeenCalledWith('conversation', 3);
  expect(decryptDMV2).toHaveBeenCalledWith(payload, 'test-conversation-secret', 'conversation');
  expect(decryptDM).not.toHaveBeenCalled();
});

test('does not fall back to legacy decryption when the conversation key is unavailable', async () => {
  loadKey.mockResolvedValue(null);
  await expect(decodeDMPayload('{"v":2,"kid":1}', 'account-key', 'conversation')).rejects.toThrow('No v2 DM key');
  expect(decryptDM).not.toHaveBeenCalled();
  expect(decryptDMV2).not.toHaveBeenCalled();
});

test('propagates a temporary key retrieval failure without declaring key loss', async () => {
  const failure = new Error('Temporary network failure');
  loadKey.mockRejectedValue(failure);
  await expect(decodeDMPayload('{"v":2,"kid":1}', null, 'conversation')).rejects.toBe(failure);
});

test('a page of encrypted messages makes one missing-key request', async () => {
  loadKey.mockResolvedValue(null);
  const loadOnce = createDMKeyBatchLoader();
  for (let index = 0; index < 50; index += 1) {
    await expect(decodeDMPayload('{"v":2,"kid":1}', null, 'conversation', loadOnce)).rejects.toThrow('No v2 DM key');
  }
  expect(loadKey).toHaveBeenCalledTimes(1);
});

test('a rate-limited key lookup is not repeated for every message in the page', async () => {
  const failure = { response: { status: 429 } };
  loadKey.mockRejectedValue(failure);
  const loadOnce = createDMKeyBatchLoader();
  for (let index = 0; index < 50; index += 1) {
    await expect(decodeDMPayload('{"v":2,"kid":1}', null, 'conversation', loadOnce)).rejects.toBe(failure);
  }
  expect(loadKey).toHaveBeenCalledTimes(1);
});

test('preserves legacy decryption and its existing sync-key check', async () => {
  await expect(decodeDMPayload('{"v":1}', 'account-key', 'conversation')).resolves.toBe('legacy text');
  expect(decryptDM).toHaveBeenCalledWith('{"v":1}', 'account-key', 'conversation');
  await expect(decodeDMPayload('{"v":1}', null, 'conversation')).rejects.toThrow('No sync key');
  expect(loadKey).not.toHaveBeenCalled();
});
