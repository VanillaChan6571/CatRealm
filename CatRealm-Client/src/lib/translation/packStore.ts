import { create } from 'zustand';
import { shutdownEngine } from './bergamotEngine';
import { PACK_LANGUAGES, type PackLanguage } from './languages';
import { packBytes, packFiles } from './models';
import { hasModelFile, hasPackRecord, installPackFiles, removePackFiles } from './modelStore';

/**
 * Install / update / remove state for each language pack. A pack is "installed" when every
 * pinned file is on disk; "outdated" when an older revision (or a partial download) is there
 * but the current pins aren't, which happens when packs.json moves a pack to a new revision.
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

async function diskState(lang: PackLanguage): Promise<PackState> {
  const present = await Promise.all(packFiles(lang).map((file) => hasModelFile(file)));
  if (present.every(Boolean)) return 'installed';
  return present.some(Boolean) || (await hasPackRecord(lang)) ? 'outdated' : 'missing';
}

let refreshing: Promise<void> | null = null;

const installedFrom = (packs: Record<PackLanguage, PackStatus>) =>
  PACK_LANGUAGES.filter((lang) => packs[lang].state === 'installed');

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
      // Every message row asks on mount; share one disk check.
      refreshing ??= Promise.all(PACK_LANGUAGES.map(diskState))
        .then((states) => {
          PACK_LANGUAGES.forEach((lang, i) => {
            // Leave an in-flight download alone; it reports its own outcome.
            if (get().packs[lang].state !== 'downloading') patch(lang, { state: states[i], error: null });
          });
          set({ checked: true });
        })
        .finally(() => { refreshing = null; });
      return refreshing;
    },

    install: async (lang) => {
      if (get().packs[lang].state === 'downloading') return;
      let loaded = 0;
      patch(lang, { state: 'downloading', loadedBytes: 0, error: null });
      try {
        await installPackFiles(lang, packFiles(lang), (bytes) => {
          loaded += bytes;
          patch(lang, { loadedBytes: Math.min(loaded, get().packs[lang].totalBytes) });
        });
        // A new revision may replace models the worker already loaded.
        shutdownEngine();
        patch(lang, { state: 'installed', loadedBytes: get().packs[lang].totalBytes });
      } catch (error) {
        patch(lang, { state: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    },

    remove: async (lang) => {
      if (get().packs[lang].state === 'downloading') return;
      await removePackFiles(lang, packFiles(lang));
      shutdownEngine();
      patch(lang, { state: 'missing', loadedBytes: 0, error: null });
    },
  };
});
