import { Linking } from 'react-native';
import { AUTH_BASE, createAuthenticatedApi } from '@/lib/api';
import { getLocalDeviceId } from '@/lib/deviceIdentity';
import { captureAccountSession } from '@/lib/accountSession';

export async function verifyCurrentDeviceForKeySharing() {
  const session = captureAccountSession();
  if (!session.user || session.user.accountType !== 'central') throw new Error('Sign in to verify this device.');
  const deviceId = await getLocalDeviceId();
  if (!session.isCurrent()) throw new Error('Account changed.');
  const api = createAuthenticatedApi();
  const start = await api.post('/api/security/webauthn/desktop/device-protection/start', { deviceId });
  if (!session.isCurrent()) throw new Error('Account changed.');
  const flowId = String(start.data.flowId || '');
  const hostedUrl = new URL(String(start.data.url || ''), AUTH_BASE).toString();
  if (!await Linking.canOpenURL(hostedUrl)) throw new Error('This device cannot open the CatRealm passkey page.');
  await Linking.openURL(hostedUrl);

  const startedAt = Date.now();
  while (Date.now() - startedAt < 10 * 60 * 1000) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (!session.isCurrent()) throw new Error('Account changed.');
    const status = await api.get(`/api/security/webauthn/desktop/device-protection/${encodeURIComponent(flowId)}/status`);
    if (status.data.status === 'complete') {
      if (!status.data.device) throw new Error('Device verification completed without device details.');
      return status.data.device;
    }
    if (status.data.status === 'failed') throw new Error(status.data.error || 'Device verification failed.');
  }
  throw new Error('Device verification timed out. Return here and try again.');
}
