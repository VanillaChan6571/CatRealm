/**
 * Cross-device DM pin sync. Bridges the local taskbar `pinnedStore` (DM-type
 * pins) with Central `/api/user-settings/pinned-dms`, so a DM pinned on desktop
 * or mobile is pinned everywhere. Central accounts only.
 *
 * Kept out of `pinnedStore` to avoid a circular import with `authStore` (which
 * already imports `pinnedStore`).
 */

import { usePinnedStore, type PinnedItem } from '../stores/pinnedStore';
import { useAuthStore } from '../stores/authStore';
import { createAuthenticatedApi } from './authApi';

interface SyncedDmPin {
  otherUserId: string;
  username: string;
  avatar: string | null;
}

let initialized = false;
let hydrated = false;
let lastSig = '';
let lastCount = 0;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
const PUSH_DEBOUNCE_MS = 1200;

function isCentral(): boolean {
  return useAuthStore.getState().user?.accountType === 'central';
}

function dmPinsOf(items: PinnedItem[]): SyncedDmPin[] {
  return items
    .filter((i): i is Extract<PinnedItem, { type: 'dm' }> => i.type === 'dm')
    .map((i) => ({ otherUserId: i.otherUserId, username: i.username, avatar: i.avatar }));
}

function signatureOf(pins: SyncedDmPin[]): string {
  return JSON.stringify(pins.map((p) => p.otherUserId));
}

async function pushToCentral(pins: SyncedDmPin[]) {
  if (!isCentral()) return;
  try {
    await createAuthenticatedApi().put('/api/user-settings/pinned-dms', { pins });
  } catch {
    // ignore sync errors; local state stays authoritative until next change
  }
}

function schedulePush(pins: SyncedDmPin[]) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushToCentral(pins);
  }, PUSH_DEBOUNCE_MS);
}

/** Pull the canonical DM pin list from Central and reconcile into pinnedStore. */
export async function hydrateDmPinsFromCentral() {
  if (isCentral()) {
    try {
      const res = await createAuthenticatedApi().get<{ pins: SyncedDmPin[]; stored?: boolean }>('/api/user-settings/pinned-dms');
      const pins = Array.isArray(res.data?.pins) ? res.data.pins : [];
      const localDm = dmPinsOf(usePinnedStore.getState().pinnedItems);
      if (pins.length === 0 && localDm.length > 0 && !res.data?.stored) {
        // Central has no record yet — seed it from this device rather than
        // wiping the user's existing local pins on first run. A stored empty
        // list means everything was unpinned and must not be re-seeded.
        void pushToCentral(localDm);
      } else {
        usePinnedStore.getState().setDmPins(pins);
      }
    } catch {
      // offline / not yet stored — keep whatever the local persist restored
    }
  }
  hydrated = true;
  const current = dmPinsOf(usePinnedStore.getState().pinnedItems);
  lastSig = signatureOf(current);
  lastCount = current.length;
}

/** Subscribe to local DM pin changes and push them to Central (once). */
export function initDmPinSync() {
  if (initialized) return;
  initialized = true;
  usePinnedStore.subscribe((state) => {
    const pins = dmPinsOf(state.pinnedItems);
    const sig = signatureOf(pins);
    if (sig === lastSig) return;
    lastSig = sig;
    const countChanged = pins.length !== lastCount;
    lastCount = pins.length;
    // Don't echo the locally-restored state back before the first central pull.
    if (!hydrated) return;
    if (countChanged) {
      // Pin/unpin: push now so a reload right after can't restore the old list.
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = null;
      void pushToCentral(pins);
    } else {
      schedulePush(pins); // reorder: debounce drag churn
    }
  });
}
