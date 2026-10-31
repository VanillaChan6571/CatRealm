import { useAuthStore } from '@/stores/authStore';

let generation = 0;

/** Invalidate asynchronous work even when signing back into the same account. */
export function invalidateAccountSession() {
  generation += 1;
}

export function captureAccountSession() {
  const snapshot = useAuthStore.getState();
  const capturedGeneration = generation;
  return {
    ...snapshot,
    isCurrent: () => {
      const current = useAuthStore.getState();
      return generation === capturedGeneration
        && current.user?.id === snapshot.user?.id
        && current.token === snapshot.token
        && current.syncKey === snapshot.syncKey;
    },
  };
}
