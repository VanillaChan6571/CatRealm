import { x25519 } from '@noble/curves/ed25519.js';
import { createAuthenticatedApi } from './authApi';
import { getLocalDeviceId, getLocalDmPrivateKey } from './deviceIdentity';
import { base64ToBytes, bytesToBase64 } from '../messaging/crypto/base64';
import { useAuthStore } from '../stores/authStore';

export async function approveSurvivingDevice(totpCode: string): Promise<void> {
  if (!/^\d{6}$/.test(totpCode)) throw new Error('Enter your six-digit 2FA code.');
  const accountId = useAuthStore.getState().user?.id;
  if (!accountId) throw new Error('Sign in before verifying this device.');
  const deviceId = getLocalDeviceId();
  const privateKey = getLocalDmPrivateKey();
  const api = createAuthenticatedApi();
  await api.post('/api/security/step-up', { totpCode });
  if (useAuthStore.getState().user?.id !== accountId) throw new Error('Account changed during verification.');
  const { data } = await api.post<{ challengeId: string; serverPublicKey: string }>(
    `/api/devices/${encodeURIComponent(deviceId)}/self-approval/start`,
  );
  const serverPublicKey = base64ToBytes(data.serverPublicKey);
  if (serverPublicKey.length !== 32) throw new Error('Central returned an invalid device challenge.');
  const shared = x25519.getSharedSecret(privateKey, serverPublicKey);
  const key = await crypto.subtle.importKey('raw', shared as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const message = new TextEncoder().encode(`catrealm:device-self-trust:v1:${data.challengeId}:${deviceId}`);
  const proof = bytesToBase64(new Uint8Array(await crypto.subtle.sign('HMAC', key, message)));
  if (useAuthStore.getState().user?.id !== accountId) throw new Error('Account changed during verification.');
  await api.post(`/api/devices/${encodeURIComponent(deviceId)}/self-approval/complete`, { challengeId: data.challengeId, proof });
}
