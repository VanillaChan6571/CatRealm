import { x25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@stablelib/hmac';
import { SHA256 } from '@stablelib/sha256';
import { createAuthenticatedApi } from '@/lib/api';
import { getLocalDeviceId, getLocalDmPrivateKey } from '@/lib/deviceIdentity';
import { base64ToBytes, bytesToBase64, utf8ToBytes } from '@/utils/dmCrypto';
import { useAuthStore } from '@/stores/authStore';

export type DeviceApprovalRequest = {
  id: string;
  requesterDeviceId: string;
  deviceName: string;
  platform: 'desktop' | 'web' | 'ios' | 'android';
  browserName: string | null;
  codeExpiresAt: number;
  expiresAt: number;
  createdAt: number;
  status: 'pending' | 'approved' | 'denied' | 'cancelled' | 'expired';
  code?: string;
};

export async function approveTrustedDeviceRequest(requestId: string, code: string): Promise<void> {
  const accountId = useAuthStore.getState().user?.id;
  if (!accountId) throw new Error('Sign in before approving another device.');
  const approverDeviceId = await getLocalDeviceId();
  const api = createAuthenticatedApi();
  const { data } = await api.post<{ challengeId: string; serverPublicKey: string }>(
    `/api/devices/approval-requests/${encodeURIComponent(requestId)}/proof/start`,
    { approverDeviceId },
  );
  const serverPublicKey = base64ToBytes(data.serverPublicKey);
  if (serverPublicKey.length !== 32) throw new Error('Central returned an invalid trusted-device challenge.');
  const shared = x25519.getSharedSecret(await getLocalDmPrivateKey(), serverPublicKey);
  const message = utf8ToBytes(`catrealm:device-approval:v1:${data.challengeId}:${requestId}:${approverDeviceId}`);
  const proof = bytesToBase64(hmac(SHA256, shared, message));
  if (useAuthStore.getState().user?.id !== accountId) throw new Error('Account changed during device approval.');
  await api.post(`/api/devices/approval-requests/${encodeURIComponent(requestId)}/approve`, {
    approverDeviceId,
    code,
    challengeId: data.challengeId,
    proof,
  });
}
