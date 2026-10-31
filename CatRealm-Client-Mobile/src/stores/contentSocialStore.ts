import { create } from 'zustand';
import { createApi } from '@/lib/api';
import { createAuthenticatedApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';

type NsfwPrefs = {
  allowNsfw: boolean;
  nsfwLewds: boolean;
  nsfwBlood: boolean;
  nsfwGore: boolean;
};

// The server stores DM/friend-request/domain prefs in the same record and PUT
// replaces it wholesale, so the full server object is kept and merged on save.
type PrefsResponse = Partial<NsfwPrefs> & Record<string, unknown>;

interface ContentSocialState extends NsfwPrefs {
  serverPrefs: PrefsResponse;
  loaded: boolean;
  loadPrefs: () => Promise<void>;
  savePrefs: (patch: Partial<NsfwPrefs>) => Promise<void>;
}

const pickNsfw = (s: NsfwPrefs): NsfwPrefs => ({
  allowNsfw: s.allowNsfw,
  nsfwLewds: s.nsfwLewds,
  nsfwBlood: s.nsfwBlood,
  nsfwGore: s.nsfwGore,
});

export const useContentSocialStore = create<ContentSocialState>((set, get) => ({
  allowNsfw: false,
  nsfwLewds: false,
  nsfwBlood: false,
  nsfwGore: false,
  serverPrefs: {},
  loaded: false,

  loadPrefs: async () => {
    const auth = useAuthStore.getState();
    const api = auth.user?.accountType === 'central' ? createAuthenticatedApi() : createApi();
    try {
      const res = await api.get<PrefsResponse>('/api/profile/content-social-preferences');
      const d = res.data ?? {};
      set({
        allowNsfw: !!d.allowNsfw,
        nsfwLewds: !!d.nsfwLewds,
        nsfwBlood: !!d.nsfwBlood,
        nsfwGore: !!d.nsfwGore,
        serverPrefs: d,
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },

  savePrefs: async (patch) => {
    const previous = pickNsfw(get());
    // Apply optimistically, roll back if the save fails.
    set(patch);
    // Without the full record, PUT would reset the non-NSFW prefs to defaults.
    if (Object.keys(get().serverPrefs).length === 0) {
      await get().loadPrefs();
      set(patch);
    }
    const payload = { ...get().serverPrefs, ...pickNsfw(get()) };
    const isCentral = useAuthStore.getState().user?.accountType === 'central';
    try {
      const res = await (isCentral ? createAuthenticatedApi() : createApi())
        .put<PrefsResponse>('/api/profile/content-social-preferences', payload);
      set({ serverPrefs: { ...payload, ...(res.data ?? {}) } });
      // Mirror to the active realm so its NSFW channel visibility matches (desktop does the same).
      if (isCentral && useAuthStore.getState().serverUrl) {
        createApi().put('/api/profile/content-social-preferences', payload).catch(() => {});
      }
    } catch {
      set(previous);
    }
  },
}));
