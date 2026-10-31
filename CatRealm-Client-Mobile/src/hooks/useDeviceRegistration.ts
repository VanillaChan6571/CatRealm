import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { registerCurrentDevice } from '@/lib/deviceIdentity';
import { registerPushToken, registerVoipPushToken } from '@/lib/pushNotifications';
import { secureStorage, StorageKeys } from '@/lib/storage';

const RETRY_DELAYS_MS = [0, 2000, 10000];

export function useDeviceRegistration() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const accountSwitching = useAuthStore((s) => s.accountSwitching);

  useEffect(() => {
    if (!token || accountSwitching || user?.accountType !== 'central') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const attempt = async (index: number) => {
      if (cancelled) return;
      try {
        const deviceId = await registerCurrentDevice();
        const [pushToken, voipToken] = await Promise.all([
          secureStorage.get(StorageKeys.pushToken),
          secureStorage.get(StorageKeys.voipPushToken),
        ]);
        if (cancelled || useAuthStore.getState().user?.id !== user.id) return;
        if (pushToken) await registerPushToken(pushToken, deviceId);
        if (voipToken) await registerVoipPushToken(voipToken, deviceId);
      } catch (error) {
        console.warn('[Devices] Mobile registration failed:', error);
        const nextDelay = RETRY_DELAYS_MS[index + 1];
        if (!cancelled && nextDelay != null) {
          timer = setTimeout(() => void attempt(index + 1), nextDelay);
        }
      }
    };

    timer = setTimeout(() => void attempt(0), RETRY_DELAYS_MS[0]);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token, accountSwitching, user?.accountType, user?.id]);
}
