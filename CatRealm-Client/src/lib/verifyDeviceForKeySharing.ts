import { startAuthentication } from '@simplewebauthn/browser';
import { createAuthenticatedApi } from './authApi';
import { getLocalDeviceId, type UserDevice } from './deviceIdentity';
import { completeHostedDeviceProof } from './hostedDeviceProof';

export async function verifyCurrentDeviceForKeySharing(): Promise<UserDevice> {
  const deviceId = getLocalDeviceId();
  const api = createAuthenticatedApi();
  let device: UserDevice;

  if (window.electron) {
    device = await completeHostedDeviceProof(api, deviceId);
  } else {
    const optionsRes = await api.post(`/api/devices/${deviceId}/proof/options`, {});
    const credential = await startAuthentication({ optionsJSON: optionsRes.data });
    const verifyRes = await api.post<{ device: UserDevice }>(`/api/devices/${deviceId}/proof/verify`, { credential });
    device = verifyRes.data.device;
  }

  return device;
}
