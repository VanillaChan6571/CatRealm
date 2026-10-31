import { create } from 'zustand';
import { createAuthenticatedApi } from '../lib/authApi';

export interface PushGlobalPrefs {
  notifServers: boolean;
  notifDMs: boolean;
  notifFriendRequests: boolean;
  pushWhenOnline: boolean;
}

const DEFAULT_PREFS: PushGlobalPrefs = {
  notifServers: true,
  notifDMs: true,
  notifFriendRequests: true,
  pushWhenOnline: false,
};

interface PushSettingsState {
  prefs: PushGlobalPrefs;
  loaded: boolean;
  load: () => Promise<void>;
  savePref: (key: keyof PushGlobalPrefs, value: boolean) => Promise<void>;
}

export const usePushSettingsStore = create<PushSettingsState>((set, get) => ({
  prefs: { ...DEFAULT_PREFS },
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    try {
      const api = createAuthenticatedApi();
      const res = await api.get<PushGlobalPrefs>('/api/push/global-prefs');
      set({ prefs: { ...DEFAULT_PREFS, ...res.data }, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  savePref: async (key, value) => {
    set((s) => ({ prefs: { ...s.prefs, [key]: value } }));
    try {
      const api = createAuthenticatedApi();
      await api.put('/api/push/global-prefs', { [key]: value });
    } catch {
      set({ loaded: false });
      await get().load();
    }
  },
}));
