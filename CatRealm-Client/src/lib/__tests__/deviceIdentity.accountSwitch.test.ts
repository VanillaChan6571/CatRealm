import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../authApi', () => ({ createAuthenticatedApi: vi.fn() }));

import { adoptCentralSessionDevice } from '../centralDeviceCredentials';
import { clearLocalDeviceIdentity, getLocalDeviceId, getLocalDmPrivateKey, getLocalNotificationPrivateKey } from '../deviceIdentity';

const DEVICE_A = 'device-aaaaaaaaaaaaaaaa';
const DEVICE_B = 'device-bbbbbbbbbbbbbbbb';

// Unsigned JWT carrying just the session's device id, as Central issues it.
function sessionToken(did: string) {
  const payload = btoa(JSON.stringify({ sub: 'user', type: 'central', did }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${payload}.signature`;
}

const asHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('device keys across account switches', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('gives each account its own device keys back when switching between them', () => {
    adoptCentralSessionDevice(sessionToken(DEVICE_A));
    const keyA = asHex(getLocalDmPrivateKey());
    const notificationA = asHex(getLocalNotificationPrivateKey());

    // Switch to account B: a different device id gets its own fresh key...
    adoptCentralSessionDevice(sessionToken(DEVICE_B));
    expect(getLocalDeviceId()).toBe(DEVICE_B);
    const keyB = asHex(getLocalDmPrivateKey());
    expect(keyB).not.toBe(keyA);

    // ...and switching back restores A's original keys instead of new ones.
    adoptCentralSessionDevice(sessionToken(DEVICE_A));
    expect(getLocalDeviceId()).toBe(DEVICE_A);
    expect(asHex(getLocalDmPrivateKey())).toBe(keyA);
    expect(asHex(getLocalNotificationPrivateKey())).toBe(notificationA);
  });

  it('keeps a pre-migration single-slot key with the device it belonged to', () => {
    localStorage.setItem('catrealm.device-id', DEVICE_A);
    const legacyKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
    localStorage.setItem('catrealm.device-dm-private-key', legacyKey);

    // Switching away before the key was ever read must not hand it to B.
    adoptCentralSessionDevice(sessionToken(DEVICE_B));
    expect(asHex(getLocalDmPrivateKey())).not.toBe('07'.repeat(32));
    expect(localStorage.getItem('catrealm.device-dm-private-key')).toBeNull();

    adoptCentralSessionDevice(sessionToken(DEVICE_A));
    expect(asHex(getLocalDmPrivateKey())).toBe('07'.repeat(32));
  });

  it('migrates the single-slot key in place when the device id is unchanged', () => {
    localStorage.setItem('catrealm.device-id', DEVICE_A);
    localStorage.setItem('catrealm.device-dm-private-key', btoa(String.fromCharCode(...new Uint8Array(32).fill(9))));
    expect(asHex(getLocalDmPrivateKey())).toBe('09'.repeat(32));
    expect(localStorage.getItem(`catrealm.device-dm-private-key.${DEVICE_A}`)).not.toBeNull();
    expect(localStorage.getItem('catrealm.device-dm-private-key')).toBeNull();
  });

  it('removing one account device preserves the shared proof secret and other device key', () => {
    localStorage.setItem('catrealm.device-session-secret', 'shared-proof');
    adoptCentralSessionDevice(sessionToken(DEVICE_A));
    getLocalDmPrivateKey();
    adoptCentralSessionDevice(sessionToken(DEVICE_B));
    const otherKey = asHex(getLocalDmPrivateKey());
    adoptCentralSessionDevice(sessionToken(DEVICE_A));
    clearLocalDeviceIdentity('alice');
    expect(localStorage.getItem('catrealm.device-session-secret')).toBe('shared-proof');
    adoptCentralSessionDevice(sessionToken(DEVICE_B));
    expect(asHex(getLocalDmPrivateKey())).toBe(otherKey);
  });

  it('preserves old plaintext DM keys even when sign-out markers match a removed device', () => {
    const oldKey = 'catrealm.dm-conversation-secret.conversation.1';
    const value = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
    localStorage.setItem(oldKey, value);
    localStorage.setItem('catrealm.dm-conversation-secret-owner', 'alice');
    localStorage.setItem('catrealm.dm-conversation-secret-device', DEVICE_A);
    adoptCentralSessionDevice(sessionToken(DEVICE_A));
    clearLocalDeviceIdentity('alice');
    expect(localStorage.getItem(oldKey)).toBe(value);
    adoptCentralSessionDevice(sessionToken(DEVICE_B));
    expect(localStorage.getItem(oldKey)).toBe(value);
  });
});
