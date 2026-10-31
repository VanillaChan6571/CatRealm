import { x25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@stablelib/hmac';
import { SHA256 } from '@stablelib/sha256';
import { createAuthenticatedApi } from '@/lib/api';
import { getLocalDeviceId, getLocalDmPrivateKey } from '@/lib/deviceIdentity';
import { base64ToBytes, bytesToBase64, utf8ToBytes } from '@/utils/dmCrypto';
import { useAuthStore } from '@/stores/authStore';

// A TOTP step-up proves account control. This one-time X25519 proof also
// establishes possession of the key Central previously registered for this device.
export async function approveSurvivingDevice(totpCode: string): Promise<void> {
  if (!/^\d{6}$/.test(totpCode)) throw new Error('Enter your six-digit 2FA code.');
  const accountId = useAuthStore.getState().user?.id;
  if (!accountId) throw new Error('Sign in before verifying this device.');
  const deviceId = await getLocalDeviceId();
  const privateKey = await getLocalDmPrivateKey();
  const api = createAuthenticatedApi();
  await api.post('/api/security/step-up', { totpCode });
  if (useAuthStore.getState().user?.id !== accountId) throw new Error('Account changed during verification.');
  const { data } = await api.post<{ challengeId: string; serverPublicKey: string }>(
    `/api/devices/${encodeURIComponent(deviceId)}/self-approval/start`,
  );
  const serverPublicKey = base64ToBytes(data.serverPublicKey);
  if (serverPublicKey.length !== 32) throw new Error('Central returned an invalid device challenge.');
  const shared = x25519.getSharedSecret(privateKey, serverPublicKey);
  const message = utf8ToBytes(`catrealm:device-self-trust:v1:${data.challengeId}:${deviceId}`);
  const proof = bytesToBase64(hmac(SHA256, shared, message));
  if (useAuthStore.getState().user?.id !== accountId) throw new Error('Account changed during verification.');
  await api.post(`/api/devices/${encodeURIComponent(deviceId)}/self-approval/complete`, {
    challengeId: data.challengeId,
    proof,
  });
}
