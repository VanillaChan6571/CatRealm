import { describe, expect, it } from 'vitest';
import {
  decryptDM,
  decryptDMV2,
  encryptDM,
  encryptDMV2,
  getDMPayloadVersion,
  verifyDMV2Payload,
} from '../../messaging/crypto/dmCrypto';

describe('dm crypto payload versions', () => {
  it('keeps legacy v1 payloads readable', async () => {
    const payload = await encryptDM('legacy hello', 'ignored-sync-key', 'conversation-1');
    expect(getDMPayloadVersion(payload)).toBe(1);
    await expect(decryptDM(payload, 'ignored-sync-key', 'conversation-1')).resolves.toBe('legacy hello');
  });

  it('round-trips explicit v2 payloads with a conversation secret', async () => {
    const secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const payload = await encryptDMV2('real e2ee hello', secret, 'conversation-2', 3);
    expect(getDMPayloadVersion(payload)).toBe(2);
    expect(verifyDMV2Payload(payload)).toBe(true);
    await expect(decryptDMV2(payload, secret, 'conversation-2')).resolves.toBe('real e2ee hello');
  });
});
