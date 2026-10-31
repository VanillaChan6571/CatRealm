import { create } from 'zustand';
import { createApi } from '../lib/api';
import { createAuthenticatedApi } from '../lib/authApi';
import { useAuthStore } from './authStore';
import { normalizeAllowedDomains } from '../utils/domainAllowlist';

type ContentSocialPrefsResponse = {
  allowNsfw?: boolean;
  nsfwLewds?: boolean;
  nsfwBlood?: boolean;
  nsfwGore?: boolean;
  customAllowedDomains?: string[];
};

interface ContentSocialState {
  allowNsfw: boolean;
  nsfwLewds: boolean;
  nsfwBlood: boolean;
  nsfwGore: boolean;
  customAllowedDomains: string[];
  loaded: boolean;
  setPrefs: (prefs: Partial<ContentSocialPrefsResponse>) => void;
  loadPrefs: () => Promise<void>;
}

export const useContentSocialStore = create<ContentSocialState>((set) => ({
  // Default to permissive until server prefs are loaded.
  allowNsfw: true,
  nsfwLewds: true,
  nsfwBlood: true,
  nsfwGore: true,
  customAllowedDomains: [],
  loaded: false,

  setPrefs: (prefs) =>
    set((state) => ({
      ...state,
      allowNsfw: prefs.allowNsfw ?? state.allowNsfw,
      nsfwLewds: prefs.nsfwLewds ?? state.nsfwLewds,
      nsfwBlood: prefs.nsfwBlood ?? state.nsfwBlood,
      nsfwGore: prefs.nsfwGore ?? state.nsfwGore,
      customAllowedDomains: prefs.customAllowedDomains
        ? normalizeAllowedDomains(prefs.customAllowedDomains)
        : state.customAllowedDomains,
      loaded: true,
    })),

  loadPrefs: async () => {
    const authState = useAuthStore.getState();
    if (!authState.serverUrl && authState.user?.accountType !== 'central') return;
    try {
      // NSFW channel visibility is server-side, so prefer active server prefs when connected.
      const api = authState.serverUrl
        ? createApi()
        : (authState.user?.accountType === 'central' ? createAuthenticatedApi() : createApi());
      const res = await api.get<ContentSocialPrefsResponse>('/api/profile/content-social-preferences');
      const data = res.data || {};
      set({
        allowNsfw: !!data.allowNsfw,
        nsfwLewds: !!data.nsfwLewds,
        nsfwBlood: !!data.nsfwBlood,
        nsfwGore: !!data.nsfwGore,
        customAllowedDomains: normalizeAllowedDomains(data.customAllowedDomains),
        loaded: true,
      });
    } catch {
      // Keep current values on fetch failure.
    }
  },
}));
