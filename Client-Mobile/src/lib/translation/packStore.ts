import { create } from 'zustand';
import { PACK_LANGUAGES, type PackLanguage } from './languages';
import { packBytes, packFiles } from './models';
import { installPackOnDevice, isEngineAttached, onEngineProgress, packStateOnDevice, removePackOnDevice } from './engine';

/**
 * Install / update / remove state for each language pack, as in the desktop client. Files live
 * in the translation WebView's IndexedDB, so every check goes through the engine. A pack is
 * "installed" when every pinned file is on the device; "outdated" when an older revision (or a
 * partial download) is there but the current pins aren't.
 */
export type PackState = 'missing' | 'installed' | 'outdated' | 'downloading' | 'error';

export type PackStatus = {
  state: PackState;
  loadedBytes: number;
  totalBytes: number;
  error: string | null;
};

type PackStoreState = {
  packs: Record<PackLanguage, PackStatus>;
  /** Packs usable for translation right now. */
  installed: PackLanguage[];
  checked: boolean;
  refresh: () => Promise<void>;
  install: (lang: PackLanguage) => Promise<void>;
  remove: (lang: PackLanguage) => Promise<void>;
};

const initialPacks = Object.fromEntries(
  PACK_LANGUAGES.map((lang) => [lang, { state: 'missing', loadedBytes: 0, totalBytes: packBytes(lang), error: null }]),
) as Record<PackLanguage, PackStatus>;

const installedFrom = (packs: Record<PackLanguage, PackStatus>) =>
  PACK_LANGUAGES.filter((lang) => packs[lang].state === 'installed');

let refreshing: Promise<void> | null = null;

export const useTranslationPacks = create<PackStoreState>((set, get) => {
  const patch = (lang: PackLanguage, status: Partial<PackStatus>) => {
    const packs = { ...get().packs, [lang]: { ...get().packs[lang], ...status } };
    const installed = installedFrom(packs);
    // Keep the array identity stable unless membership changed, so subscribers don't churn.
    set({ packs, installed: installed.join() === get().installed.join() ? get().installed : installed });
  };

  return {
    packs: initialPacks,
    installed: [],
    checked: false,

    refresh: () => {
      if (!isEngineAttached()) return Promise.resolve();
      // Every message row asks on mount; share one check.
      refreshing ??= Promise.all(PACK_LANGUAGES.map((lang) => packStateOnDevice(lang, packFiles(lang))))
        .then((states) => {
          PACK_LANGUAGES.forEach((lang, i) => {
            // Leave an in-flight download alone; it reports its own outcome.
            if (get().packs[lang].state !== 'downloading') patch(lang, { state: states[i], error: null });
          });
          set({ checked: true });
        })
        .catch(() => { /* engine restarted; the next mount asks again */ })
        .finally(() => { refreshing = null; });
      return refreshing;
    },

    install: async (lang) => {
      if (get().packs[lang].state === 'downloading') return;
      let loaded = 0;
      patch(lang, { state: 'downloading', loadedBytes: 0, error: null });
      const stopListening = onEngineProgress((progressLang, bytes) => {
        if (progressLang !== lang) return;
        loaded += bytes;
        patch(lang, { loadedBytes: Math.min(loaded, get().packs[lang].totalBytes) });
      });
      try {
        await installPackOnDevice(lang, packFiles(lang));
        patch(lang, { state: 'installed', loadedBytes: get().packs[lang].totalBytes });
      } catch (error) {
        patch(lang, { state: 'error', error: error instanceof Error ? error.message : String(error) });
      } finally {
        stopListening();
      }
    },

    remove: async (lang) => {
      if (get().packs[lang].state === 'downloading') return;
      await removePackOnDevice(lang, packFiles(lang));
      patch(lang, { state: 'missing', loadedBytes: 0, error: null });
    },
  };
});
