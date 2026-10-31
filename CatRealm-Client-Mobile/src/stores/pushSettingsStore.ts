import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createAuthenticatedApi } from '@/lib/api';
import { captureAccountSession } from '@/lib/accountSession';

export type MuteScope = 'dm' | 'group' | 'server';

export interface MuteEntry {
  scope: MuteScope;
  targetId: string;
  mutedAt: number;
}

export interface PushGlobalPrefs {
  notifServers: boolean;
  notifDMs: boolean;
  notifFriendRequests: boolean;
  pushWhenOnline: boolean;
}

const DEFAULT_GLOBAL_PREFS: PushGlobalPrefs = {
  notifServers: true,
  notifDMs: true,
  notifFriendRequests: true,
  pushWhenOnline: false,
};

const pushPrefsCacheKey = (userId: string) => `catrealm.push.global-prefs.v1:${userId}`;

interface PushSettingsState {
  mutes: MuteEntry[];
  loaded: boolean;
  globalPrefs: PushGlobalPrefs;
  globalPrefsLoaded: boolean;
  reset: () => void;
  hydrate: () => Promise<void>;
  isMuted: (scope: MuteScope, targetId: string) => boolean;
  setMute: (scope: MuteScope, targetId: string, muted: boolean) => Promise<void>;
  loadGlobalPrefs: () => Promise<void>;
  saveGlobalPref: (key: keyof PushGlobalPrefs, value: boolean) => Promise<void>;
}

const EMPTY_MUTES: MuteEntry[] = [];

async function readCachedPrefs(userId: string): Promise<PushGlobalPrefs | null> {
  try {
    const raw = await AsyncStorage.getItem(pushPrefsCacheKey(userId));
    if (!raw) return null;
    return { ...DEFAULT_GLOBAL_PREFS, ...(JSON.parse(raw) as Partial<PushGlobalPrefs>) };
  } catch {
    return null;
  }
}

async function writeCachedPrefs(userId: string, prefs: PushGlobalPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(pushPrefsCacheKey(userId), JSON.stringify(prefs));
  } catch { /* non-fatal */ }
}

export const usePushSettingsStore = create<PushSettingsState>((set, get) => ({
  mutes: EMPTY_MUTES,
  loaded: false,
  globalPrefs: { ...DEFAULT_GLOBAL_PREFS },
  globalPrefsLoaded: false,
  reset: () => set({ mutes: EMPTY_MUTES, loaded: false, globalPrefs: { ...DEFAULT_GLOBAL_PREFS }, globalPrefsLoaded: false }),

  hydrate: async () => {
    if (get().loaded) return;
    const session = captureAccountSession();
    try {
      const api = createAuthenticatedApi();
      const res = await api.get<MuteEntry[]>('/api/push/mutes');
      if (session.isCurrent()) set({ mutes: Array.isArray(res.data) ? res.data : EMPTY_MUTES, loaded: true });
    } catch {
      if (session.isCurrent()) set({ loaded: true });
    }
  },

  isMuted: (scope, targetId) => {
    return get().mutes.some((m) => m.scope === scope && m.targetId === targetId);
  },

  setMute: async (scope, targetId, muted) => {
    set((state) => {
      if (muted) {
        const exists = state.mutes.some((m) => m.scope === scope && m.targetId === targetId);
        if (exists) return state;
        return {
          mutes: [
            ...state.mutes,
            { scope, targetId, mutedAt: Math.floor(Date.now() / 1000) },
          ],
        };
      }
      return { mutes: state.mutes.filter((m) => !(m.scope === scope && m.targetId === targetId)) };
    });

    try {
      const api = createAuthenticatedApi();
      await api.put('/api/push/mutes', { scope, targetId, muted });
    } catch {
      set({ loaded: false });
      await get().hydrate();
    }
  },

  loadGlobalPrefs: async () => {
    if (get().globalPrefsLoaded) return;
    const session = captureAccountSession();
    const userId = session.user?.id;
    if (!userId) return;
    // Show cached value immediately so toggles don't flash the default while fetching.
    const cached = await readCachedPrefs(userId);
    if (!session.isCurrent()) return;
    if (cached) set({ globalPrefs: cached });
    try {
      const api = createAuthenticatedApi();
      const res = await api.get<PushGlobalPrefs>('/api/push/global-prefs');
      const prefs = { ...DEFAULT_GLOBAL_PREFS, ...res.data };
      if (!session.isCurrent()) return;
      set({ globalPrefs: prefs, globalPrefsLoaded: true });
      void writeCachedPrefs(userId, prefs);
    } catch {
      // Fall back to cached (already applied above) or defaults.
      if (session.isCurrent()) set({ globalPrefs: cached ?? { ...DEFAULT_GLOBAL_PREFS }, globalPrefsLoaded: true });
    }
  },

  saveGlobalPref: async (key, value) => {
    const session = captureAccountSession();
    const userId = session.user?.id;
    if (!userId) return;
    // Optimistic update + persist to local cache immediately so a rollback
    // restores the new value (not server defaults) if the API is temporarily down.
    const next = { ...get().globalPrefs, [key]: value };
    set({ globalPrefs: next });
    void writeCachedPrefs(userId, next);
    try {
      const api = createAuthenticatedApi();
      await api.put('/api/push/global-prefs', { [key]: value });
    } catch {
      if (!session.isCurrent()) return;
      // API failed — reload from server, but the local cache already has the
      // new value so the user won't see the toggle snap back during the session.
      set({ globalPrefsLoaded: false });
      await get().loadGlobalPrefs();
    }
  },
}));
