import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import packageJson from '../../package.json';
import { PRESERVED_CACHE_NAMES } from '../lib/radioCache';

interface VersionState {
  clientVersion: string;
  serverVersion: string | null;
  showUpdateBanner: boolean;
  lastChecked: number | null;

  setClientVersion: (version: string) => void;
  setServerVersion: (version: string) => void;
  checkVersion: (serverVersion: string) => void;
  dismissBanner: () => void;
  forceReload: () => Promise<void>;
}

const CLIENT_VERSION = packageJson.version;

export const useVersionStore = create<VersionState>()(
  persist(
    (set, get) => ({
      clientVersion: CLIENT_VERSION,
      serverVersion: null,
      showUpdateBanner: false,
      lastChecked: null,

      setClientVersion: (version: string) => {
        if (!version) return;
        set({ clientVersion: version });
        const currentServerVersion = get().serverVersion;
        if (currentServerVersion) {
          get().checkVersion(currentServerVersion);
        }
      },

      setServerVersion: (version: string) => {
        set({ serverVersion: version, lastChecked: Date.now() });
        get().checkVersion(version);
      },

      checkVersion: (serverVersion: string) => {
        const { clientVersion } = get();

        // Strip pre-release suffix before comparing (e.g. "1.6.10-dev.268" → "1.6.10")
        const parse = (v: string) => v.split('-')[0].split('.').map(Number);
        const srv = parse(serverVersion);
        const cli = parse(clientVersion);

        // Show banner only if server is strictly newer than client (numeric comparison)
        for (let i = 0; i < Math.max(srv.length, cli.length); i++) {
          const s = srv[i] ?? 0;
          const c = cli[i] ?? 0;
          if (s > c) { set({ showUpdateBanner: true }); return; }
          if (s < c) { set({ showUpdateBanner: false }); return; }
        }
        set({ showUpdateBanner: false });
      },

      dismissBanner: () => {
        set({ showUpdateBanner: false });
      },

      forceReload: async () => {
        // Unregister service workers first, then clear caches — both must finish
        // before navigating, otherwise the reload can still serve stale assets
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((r) => r.unregister()));
        }
        if ('caches' in window) {
          const names = await caches.keys();
          await Promise.all(names.filter((name) => !PRESERVED_CACHE_NAMES.has(name)).map((name) => caches.delete(name)));
        }
        // Navigate with a cache-bust param so the browser fetches fresh assets
        // rather than serving from disk cache (which location.reload() can do)
        window.location.href = `${window.location.origin}${window.location.pathname}?_v=${Date.now()}`;
      },
    }),
    {
      name: 'catrealm-version',
      partialize: (state) => ({
        serverVersion: state.serverVersion,
        lastChecked: state.lastChecked,
      }),
    }
  )
);
