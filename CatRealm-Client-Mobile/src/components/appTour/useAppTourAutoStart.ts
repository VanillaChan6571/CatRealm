import { useEffect } from 'react';
import { Alert } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import {
  decideAppTour,
  fetchAccountAppTourDone,
  hasDeviceSeenAppTour,
  markDeviceSeenAppTour,
  useAppTourStore,
} from '@/lib/appTour';

// Give the app a moment to finish launching (consent, banners) first.
const START_DELAY_MS = 2000;

/** Runs the tour for an account that never had it; offers it on a new device. */
export function useAppTourAutoStart() {
  const userId = useAuthStore((s) => s.user?.id);
  const isCentral = useAuthStore((s) => s.user?.accountType === 'central');
  const accountSwitching = useAuthStore((s) => s.accountSwitching);

  useEffect(() => {
    if (!userId || accountSwitching) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const deviceDone = await hasDeviceSeenAppTour(userId);
      const accountDone = isCentral ? await fetchAccountAppTourDone() : deviceDone;
      if (cancelled || accountDone === null) return; // Central unreachable: don't guess
      const decision = decideAppTour(accountDone, deviceDone);
      if (!decision) return;
      timer = setTimeout(() => {
        if (useAppTourStore.getState().open) return;
        if (decision === 'tour') {
          useAppTourStore.getState().start();
          return;
        }
        Alert.alert(
          'New device, quick tour?',
          "You've had the CatRealm tour before, but not on this device. Want a quick look around?",
          [
            { text: 'Skip', style: 'cancel', onPress: () => markDeviceSeenAppTour(userId) },
            { text: 'Take the tour', onPress: () => useAppTourStore.getState().start() },
          ],
          { cancelable: true, onDismiss: () => markDeviceSeenAppTour(userId) },
        );
      }, START_DELAY_MS);
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [userId, isCentral, accountSwitching]);
}
