import type { AxiosInstance } from 'axios';
import type { UserDevice } from './deviceIdentity';
import { AUTH_BASE } from './authApi';

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 120;

/**
 * Complete a device proof on CatRealm's HTTPS origin. Packaged desktop apps
 * run from file://, so WebAuthn cannot use auth.catrealm.app as an RP ID from
 * inside the main renderer.
 */
export async function completeHostedDeviceProof(api: AxiosInstance, deviceId: string): Promise<UserDevice> {
  const startRes = await api.post('/api/security/webauthn/desktop/device-protection/start', { deviceId });
  const flowId = String(startRes.data.flowId || '');
  const hostedUrl = new URL(String(startRes.data.url || ''), AUTH_BASE).toString();
  const openResult = window.electron?.openPasskeyWindow
    ? await window.electron.openPasskeyWindow(hostedUrl)
    : { ok: false, message: 'Open the CatRealm passkey window to continue.' };

  if (!openResult.ok) {
    throw new Error(openResult.message || 'Open the CatRealm passkey window to continue.');
  }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
    const statusRes = await api.get(
      `/api/security/webauthn/desktop/device-protection/${encodeURIComponent(flowId)}/status`,
    );
    if (statusRes.data.status === 'complete') {
      if (!statusRes.data.device) throw new Error('Device verification completed without device details.');
      return statusRes.data.device as UserDevice;
    }
    if (statusRes.data.status === 'failed') {
      throw new Error(statusRes.data.error || 'Device verification failed.');
    }
  }

  throw new Error('Device verification timed out. Start again if the passkey window is still open.');
}
