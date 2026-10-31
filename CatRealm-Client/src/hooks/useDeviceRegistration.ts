import { useEffect } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { useAuthStore } from '../stores/authStore';
import { registerCurrentDevice } from '../lib/deviceIdentity';
import { createAuthenticatedApi } from '../lib/authApi';
import { completeHostedDeviceProof } from '../lib/hostedDeviceProof';
import { syncKnownConversationKeys } from '../messaging/crypto/dmKeyStore';

const LAUNCH_PROOF_SESSION_PREFIX = 'catrealm.launch-proof.';

export function useDeviceRegistration() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!token || user?.accountType !== 'central') return;
    void registerCurrentDevice()
      .then(async (device) => {
        if (
          !device.proofRequiredOnLaunch
          || device.deviceSecurity === 'software_protected'
          || typeof sessionStorage === 'undefined'
        ) {
          return;
        }
        const sessionKey = `${LAUNCH_PROOF_SESSION_PREFIX}${device.id}`;
        if (sessionStorage.getItem(sessionKey) === '1') return;
        const api = createAuthenticatedApi();
        if (window.electron) {
          await completeHostedDeviceProof(api, device.id);
        } else {
          const optionsRes = await api.post(`/api/devices/${device.id}/proof/options`, {});
          const credential = await startAuthentication({ optionsJSON: optionsRes.data });
          await api.post(`/api/devices/${device.id}/proof/verify`, { credential });
        }
        sessionStorage.setItem(sessionKey, '1');
        await syncKnownConversationKeys();
      })
      .catch(() => {});
  }, [token, user?.accountType, user?.id]);
}
