import { x25519 } from '@noble/curves/ed25519.js';
import { createAuthenticatedApi } from './authApi';
import { getLocalDeviceId, getLocalDmPrivateKey, type UserDevice } from './deviceIdentity';
import { base64ToBytes, bytesToBase64 } from '../messaging/crypto/base64';
import { useAuthStore } from '../stores/authStore';

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

export async function approveTrustedDeviceRequest(requestId: string, code: string): Promise<UserDevice> {
  const accountId = useAuthStore.getState().user?.id;
  if (!accountId) throw new Error('Sign in before approving another device.');
  const approverDeviceId = getLocalDeviceId();
  const api = createAuthenticatedApi();
  const { data } = await api.post<{ challengeId: string; serverPublicKey: string }>(
    `/api/devices/approval-requests/${encodeURIComponent(requestId)}/proof/start`,
    { approverDeviceId },
  );
  const serverPublicKey = base64ToBytes(data.serverPublicKey);
  if (serverPublicKey.length !== 32) throw new Error('Central returned an invalid trusted-device challenge.');
  const shared = x25519.getSharedSecret(getLocalDmPrivateKey(), serverPublicKey);
  const key = await crypto.subtle.importKey('raw', shared as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const message = new TextEncoder().encode(`catrealm:device-approval:v1:${data.challengeId}:${requestId}:${approverDeviceId}`);
  const proof = bytesToBase64(new Uint8Array(await crypto.subtle.sign('HMAC', key, message)));
  if (useAuthStore.getState().user?.id !== accountId) throw new Error('Account changed during device approval.');
  const response = await api.post<{ device: UserDevice }>(
    `/api/devices/approval-requests/${encodeURIComponent(requestId)}/approve`,
    { approverDeviceId, code, challengeId: data.challengeId, proof },
  );
  return response.data.device;
}
