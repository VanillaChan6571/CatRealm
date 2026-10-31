/**
 * DM pins — an ordered list of pinned direct-message conversations that sorts to
 * the top of the Chats inbox. Synced across devices (and with the desktop
 * taskbar DM pins) via Central `/api/user-settings/pinned-dms`. Central accounts
 * only; DMs are a Central feature. Falls back to a local AsyncStorage cache for
 * instant/offline render.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAuthenticatedApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { debugLog } from '@/lib/debugLog';

export interface PinnedDm {
  otherUserId: string;
  username: string;
  avatar: string | null;
}

const STORAGE_PREFIX = 'catrealm.mobile.pinned-dms.v1:';

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function isCentral(): boolean {
  return useAuthStore.getState().user?.accountType === 'central';
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_DEBOUNCE_MS = 1200;

async function pushPinsToCentral(pins: PinnedDm[]) {
  if (!isCentral()) return;
  try {
    await createAuthenticatedApi().put('/api/user-settings/pinned-dms', { pins });
    debugLog('dmPinStore', 'pushPinsToCentral', { count: pins.length });
  } catch (error) {
    debugLog('dmPinStore', 'pushPinsToCentral:error', { message: String(error) });
  }
}

function schedulePush(pins: PinnedDm[]) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void pushPinsToCentral(pins);
  }, SYNC_DEBOUNCE_MS);
}

async function persistLocal(pins: PinnedDm[]) {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  try {
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(pins));
  } catch {
    // best-effort cache
  }
}

interface DmPinState {
  pinnedDms: PinnedDm[];
  pinnedIds: Set<string>;
  hydrated: boolean;
  isPinned: (otherUserId: string) => boolean;
  togglePin: (dm: PinnedDm) => void;
  hydrate: () => Promise<void>;
  reset: () => void;
}

function withIds(pins: PinnedDm[]): { pinnedDms: PinnedDm[]; pinnedIds: Set<string> } {
  return { pinnedDms: pins, pinnedIds: new Set(pins.map((p) => p.otherUserId)) };
}

export const useDmPinStore = create<DmPinState>((set, get) => ({
  pinnedDms: [],
  pinnedIds: new Set<string>(),
  hydrated: false,

  isPinned: (otherUserId) => get().pinnedIds.has(otherUserId),

  togglePin: (dm) => {
    const { pinnedDms } = get();
    const exists = pinnedDms.some((p) => p.otherUserId === dm.otherUserId);
    const next = exists
      ? pinnedDms.filter((p) => p.otherUserId !== dm.otherUserId)
      : [...pinnedDms, { otherUserId: dm.otherUserId, username: dm.username, avatar: dm.avatar ?? null }];
    set(withIds(next));
    void persistLocal(next);
    schedulePush(next);
  },

  hydrate: async () => {
    const userId = useAuthStore.getState().user?.id;
    // Local cache first for instant paint.
    if (userId) {
      try {
        const raw = await AsyncStorage.getItem(storageKey(userId));
        if (raw) set({ ...withIds(JSON.parse(raw) as PinnedDm[]) });
      } catch {
        // ignore malformed cache
      }
    }
    // Central is the source of truth across devices.
    if (!isCentral()) {
      set({ hydrated: true });
      return;
    }
    try {
      const res = await createAuthenticatedApi().get<{ pins: PinnedDm[] }>('/api/user-settings/pinned-dms');
      const pins = Array.isArray(res.data?.pins) ? res.data.pins : [];
      const localPins = get().pinnedDms;
      if (pins.length === 0 && localPins.length > 0) {
        // Central has no record yet — seed it from this device rather than
        // wiping locally-created pins on first run.
        set({ hydrated: true });
        schedulePush(localPins);
      } else {
        set({ ...withIds(pins), hydrated: true });
        void persistLocal(pins);
      }
    } catch (error) {
      debugLog('dmPinStore', 'hydrate:error', { message: String(error) });
      set({ hydrated: true });
    }
  },

  reset: () => {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    set({ pinnedDms: [], pinnedIds: new Set<string>(), hydrated: false });
  },
}));
