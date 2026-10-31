/**
 * Server store — list of CatRealm servers the user belongs to + active one.
 * Mirrors CatRealm-Client/src/stores/serverStore.ts (trimmed to the surface
 * the mobile shell needs today).
 */

import { create } from 'zustand';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import type { Channel, Category, Role, OnlineUser } from '@/types';
import { AUTH_BASE, confirmOrExpireCentralSession, createAuthenticatedApi, setActiveServerGetter } from '@/lib/api';
import { resolveMediaUrl } from '@/utils/mediaUrl';
import { useAuthStore } from '@/stores/authStore';
import { readServerList, syncGuardedServerList, type RemoteList } from '@/lib/guardedServerSync';
import type { SyncedServerEntry, SyncedServerFolder, ServerLayoutItem } from '@/utils/serverSyncCrypto';
import { debugLog } from '@/lib/debugLog';
import { captureAccountSession } from '@/lib/accountSession';
import { selectMobileRealmView } from '@/lib/realmPlatformView';

export type ServerFolder = SyncedServerFolder;
export type { ServerLayoutItem };

export interface MobileServer {
  id: string;
  name: string;
  url: string;
  /** Per-server token for central accounts (empty string for local accounts). */
  token: string;
  iconUrl?: string | null;
  bannerUrl?: string | null;
  membersOnline: number;
  /** Notification counts roll up into the bottom-tab badge. */
  unread: number;
  mention: number;
  realmTrust?: RealmTrustRecord;
}

interface RealmIdentity {
  realmInstanceId: string;
  realmPublicKeyPem: string;
  realmKeyFingerprint: string;
}

export interface RealmTrustRecord {
  state: 'trusted' | 'changed' | 'unverified' | 'error';
  approvedIdentity?: { realmInstanceId: string; realmKeyFingerprint: string };
  seenIdentity?: { realmInstanceId: string; realmKeyFingerprint: string };
  approvedAt?: number;
  lastSeenAt?: number;
  lastError?: string;
}

type ServerSyncStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'missing-key' | 'decrypt-error' | 'error';

const ACTIVE_SERVER_STORAGE_PREFIX = 'catrealm.mobile.active-server-id.v1:';
const LAYOUT_STORAGE_PREFIX = 'catrealm.mobile.server-layout.v1:';
const FOLDERS_STORAGE_PREFIX = 'catrealm.mobile.server-folders.v1:';

function activeServerStorageKey(userId: string): string {
  return `${ACTIVE_SERVER_STORAGE_PREFIX}${userId}`;
}

function layoutStorageKey(userId: string): string {
  return `${LAYOUT_STORAGE_PREFIX}${userId}`;
}

function foldersStorageKey(userId: string): string {
  return `${FOLDERS_STORAGE_PREFIX}${userId}`;
}

function deriveLayoutFromServers(servers: { id: string }[]): ServerLayoutItem[] {
  return servers.map((s) => ({ type: 'server', url: s.id }));
}

/**
 * Remove duplicates: servers that appear in folders must not also be top-level,
 * and must not appear in more than one folder. Drops empty folders and layout
 * references to servers/folders that no longer exist. Mirrors the desktop client.
 */
function sanitizeLayoutAndFolders(
  layout: ServerLayoutItem[],
  folders: ServerFolder[],
  knownUrls: Set<string>,
): { layout: ServerLayoutItem[]; folders: ServerFolder[] } {
  const inFolder = new Set<string>();
  const cleanFolders = folders
    .map((f) => {
      const uniqueUrls: string[] = [];
      for (const url of f.serverUrls) {
        if (knownUrls.has(url) && !inFolder.has(url)) {
          inFolder.add(url);
          uniqueUrls.push(url);
        }
      }
      return { ...f, serverUrls: uniqueUrls };
    })
    .filter((f) => f.serverUrls.length > 0);

  const seen = new Set<string>();
  const cleanLayout = layout.filter((item) => {
    if (item.type === 'server') {
      if (!knownUrls.has(item.url) || inFolder.has(item.url) || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    }
    const exists = cleanFolders.some((f) => f.id === item.folderId);
    if (!exists || seen.has(item.folderId)) return false;
    seen.add(item.folderId);
    return true;
  });

  // Append any known server not yet placed (new servers from central sync).
  for (const url of knownUrls) {
    if (!inFolder.has(url) && !seen.has(url)) {
      cleanLayout.push({ type: 'server', url });
      seen.add(url);
    }
  }
  // Ensure every non-empty folder has a layout entry.
  for (const folder of cleanFolders) {
    if (!seen.has(folder.id)) {
      cleanLayout.push({ type: 'folder', folderId: folder.id });
      seen.add(folder.id);
    }
  }

  return { layout: cleanLayout, folders: cleanFolders };
}

async function syncServersToAuth(
  servers: SyncedServerEntry[],
  layout: ServerLayoutItem[],
  folders: ServerFolder[],
  authState: ReturnType<typeof captureAccountSession>,
) {
  if (!authState.isCurrent()) return;
  if (authState.user?.accountType !== 'central' || !authState.syncKey || !authState.token) return;
  const api = createAuthenticatedApi();
  try {
    await syncGuardedServerList(api, { servers, layout, folders }, authState.syncKey, [], authState.isCurrent);
    debugLog('serverStore', 'syncServersToAuth', { servers: servers.length, folders: folders.length });
  } catch (error) {
    debugLog('serverStore', 'syncServersToAuth:error', { message: String(error) });
  }
}

const SERVER_SYNC_DEBOUNCE_MS = 2000;
let pendingServerSync: { servers: SyncedServerEntry[]; layout: ServerLayoutItem[]; folders: ServerFolder[] } | null = null;
let serverSyncTimer: ReturnType<typeof setTimeout> | null = null;
let serverSyncQueue = Promise.resolve();

function scheduleServersSync(
  servers: SyncedServerEntry[],
  layout: ServerLayoutItem[],
  folders: ServerFolder[],
) {
  const session = captureAccountSession();
  pendingServerSync = { servers, layout, folders };
  if (serverSyncTimer) clearTimeout(serverSyncTimer);
  serverSyncTimer = setTimeout(() => {
    serverSyncTimer = null;
    const next = pendingServerSync;
    pendingServerSync = null;
    if (next) serverSyncQueue = serverSyncQueue.then(() => syncServersToAuth(next.servers, next.layout, next.folders, session));
  }, SERVER_SYNC_DEBOUNCE_MS);
}

async function getRealmAssertion(serverUrl: string): Promise<string> {
  const url = new URL(serverUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Central accounts require a realm with a public HTTPS address.');
  }
  const response = await createAuthenticatedApi().post('/api/login/realm-assertion', { serverUrl: url.origin });
  if (typeof response.data?.token !== 'string' || response.data.audience !== url.origin) {
    throw new Error('Invalid realm authorization response.');
  }
  return response.data.token;
}

export function cancelPendingServerSync() {
  if (serverSyncTimer) clearTimeout(serverSyncTimer);
  serverSyncTimer = null;
  pendingServerSync = null;
}

async function persistLayoutLocally(layout: ServerLayoutItem[], folders: ServerFolder[]) {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  try {
    await AsyncStorage.multiSet([
      [layoutStorageKey(userId), JSON.stringify(layout)],
      [foldersStorageKey(userId), JSON.stringify(folders)],
    ]);
  } catch {
    // best-effort cache only
  }
}

const DEFAULT_FOLDER_COLOR = '#5865F2';

export interface ServerState {
  servers: MobileServer[];
  serverLayout: ServerLayoutItem[];
  serverFolders: ServerFolder[];
  /** Untouched decrypted entries preserved for lossless write-back to Central. */
  rawSyncedServers: SyncedServerEntry[];
  serverSyncStatus: ServerSyncStatus;
  serverSyncMessage: string | null;
  activeServerId: string | null;
  channels: Record<string, Channel[]>; // keyed by serverId
  categories: Record<string, Category[]>;
  roles: Record<string, Role[]>;
  onlineUsers: Record<string, OnlineUser[]>;

  byId: (id: string) => MobileServer | undefined;
  setServers: (servers: MobileServer[]) => void;
  setActiveServer: (id: string | null) => Promise<void>;
  setChannels: (serverId: string, channels: Channel[]) => void;
  setCategories: (serverId: string, categories: Category[]) => void;
  setRoles: (serverId: string, roles: Role[]) => void;
  setOnlineUsers: (serverId: string, users: OnlineUser[]) => void;
  hydrate: (userId: string) => Promise<void>;
  fetchServersForCentral: () => Promise<void>;
  /**
   * Join a realm with the Central account and add it to the synced list
   * (desktop parity). Resolves to the server id; throws a user-facing Error.
   */
  addServer: (url: string, options?: { inviteCode?: string | null }) => Promise<string>;
  verifyRealmTrust: (serverId: string, forceApproval?: boolean) => Promise<void>;
  applyCentralMentionSummary: (mentionsByRealm: Record<string, number>) => void;

  // --- Layout & folder management (synced back to Central) ---
  reorderLayout: (layout: ServerLayoutItem[]) => void;
  createFolder: (serverIds: string[], name?: string) => string;
  deleteFolder: (folderId: string) => void;
  updateFolder: (folderId: string, updates: Partial<Pick<ServerFolder, 'name' | 'color' | 'serverUrls'>>) => void;
  addServerToFolder: (serverId: string, folderId: string) => void;
  removeServerFromFolder: (serverId: string, folderId: string) => void;
  toggleFolder: (folderId: string) => void;
  collapseAllFolders: () => void;
}

export const useServerStore = create<ServerState>((set, get) => ({
  servers: [],
  serverLayout: [],
  serverFolders: [],
  rawSyncedServers: [],
  serverSyncStatus: 'idle',
  serverSyncMessage: null,
  activeServerId: null,
  channels: {},
  categories: {},
  roles: {},
  onlineUsers: {},

  byId: (id) => get().servers.find((s) => s.id === id),

  setServers: (servers) => {
    debugLog('serverStore', 'setServers', { count: servers.length, ids: servers.map((s) => s.id) });
    set((state) => ({
      servers,
      // Keep sync banner in sync with the actual list when external callers replace the list.
      serverSyncStatus: servers.length > 0 ? 'ready' : (state.serverSyncStatus === 'loading' ? 'loading' : 'idle'),
      serverSyncMessage:
        servers.length > 0
          ? `Loaded ${servers.length} synced server${servers.length === 1 ? '' : 's'}.`
          : (state.serverSyncStatus === 'loading' ? state.serverSyncMessage : null),
    }));
  },
  setActiveServer: async (id) => {
    const userId = useAuthStore.getState().user?.id;
    if (userId) {
      if (id) await AsyncStorage.setItem(activeServerStorageKey(userId), id);
      else await AsyncStorage.removeItem(activeServerStorageKey(userId));
    }
    debugLog('serverStore', 'setActiveServer', { next: id, prev: get().activeServerId });
    set({ activeServerId: id });
  },
  setChannels: (serverId, list) => {
    debugLog('serverStore', 'setChannels', {
      serverId,
      count: list.length,
      ids: list.map((ch) => ch.id),
    });
    set((s) => ({ channels: { ...s.channels, [serverId]: list } }));
  },
  setCategories: (serverId, list) => {
    debugLog('serverStore', 'setCategories', {
      serverId,
      count: list.length,
      ids: list.map((cat) => cat.id),
    });
    set((s) => ({ categories: { ...s.categories, [serverId]: list } }));
  },
  setRoles: (serverId, list) => set((s) => ({ roles: { ...s.roles, [serverId]: list } })),
  setOnlineUsers: (serverId, users) =>
    set((s) => ({ onlineUsers: { ...s.onlineUsers, [serverId]: users } })),

  hydrate: async (userId) => {
    try {
      const [[, raw], [, layoutRaw], [, foldersRaw]] = await AsyncStorage.multiGet([
        activeServerStorageKey(userId),
        layoutStorageKey(userId),
        foldersStorageKey(userId),
      ]);
      debugLog('serverStore', 'hydrate:activeServer', { userId, value: raw || null });
      let serverLayout: ServerLayoutItem[] = [];
      let serverFolders: ServerFolder[] = [];
      try {
        if (layoutRaw) serverLayout = JSON.parse(layoutRaw);
        if (foldersRaw) serverFolders = JSON.parse(foldersRaw);
      } catch {
        serverLayout = [];
        serverFolders = [];
      }
      set({ activeServerId: raw || null, serverLayout, serverFolders });
    } catch {
      debugLog('serverStore', 'hydrate:activeServer:error', { userId });
      set({ activeServerId: null });
    }
  },

  fetchServersForCentral: async () => {
    const authState = captureAccountSession();
    if (authState.user?.accountType !== 'central' || !authState.token || !authState.syncKey) {
      set({
        servers: [],
        serverSyncStatus: 'missing-key',
        serverSyncMessage: 'Central session is missing a sync key. Sign out and sign in again.',
      });
      return;
    }

    set({ serverSyncStatus: 'loading', serverSyncMessage: null });
    try {
      const res = await createAuthenticatedApi().get<RemoteList>('/api/servers?protocol=2');
      if (!authState.isCurrent()) return;
      const decrypted = await readServerList(res.data, authState.syncKey);
      if (!authState.isCurrent()) return;
      if (!decrypted) {
        set({
          servers: [],
          serverSyncStatus: 'decrypt-error',
          serverSyncMessage: 'Could not decrypt the synced server list with this session key.',
        });
        return;
      }

      const syncedServers = decrypted?.servers ?? [];
      if (syncedServers.length === 0) {
        set({
          servers: [],
          serverSyncStatus: 'empty',
          serverSyncMessage: 'The synced server list is empty.',
        });
        return;
      }

      const refreshedServers = await refreshCentralServerTokens(syncedServers, authState);
      if (!authState.isCurrent()) return;
      const mobileView = selectMobileRealmView(
        refreshedServers,
        decrypted.layout,
        decrypted.folders,
      );
      const servers = mobileView.servers.map(toMobileServer);
      const knownUrls = new Set(servers.map((s) => s.id));
      const rawLayout = mobileView.layout ?? deriveLayoutFromServers(servers);
      const { layout: serverLayout, folders: serverFolders } = sanitizeLayoutAndFolders(
        rawLayout,
        mobileView.folders ?? [],
        knownUrls,
      );
      const storedActiveServerId = get().activeServerId;
      const activeServerId = storedActiveServerId ? mobileView.rename(storedActiveServerId) : null;
      const activeServerStillExists = activeServerId
        ? servers.some((server) => server.id === activeServerId)
        : false;
      set({
        servers,
        serverLayout,
        serverFolders,
        rawSyncedServers: refreshedServers,
        serverSyncStatus: 'ready',
        serverSyncMessage: `Loaded ${servers.length} synced server${servers.length === 1 ? '' : 's'}.`,
      });
      void persistLayoutLocally(serverLayout, serverFolders);
      if (activeServerStillExists && activeServerId !== storedActiveServerId) {
        void get().setActiveServer(activeServerId);
      } else if (!activeServerStillExists) {
        void get().setActiveServer(servers[0]?.id ?? null);
      }
      servers.forEach((server) => void get().verifyRealmTrust(server.id));
    } catch (error) {
      if (!authState.isCurrent()) return;
      const status = axios.isAxiosError(error) ? error.response?.status : null;
      if (status === 401) {
        await confirmOrExpireCentralSession(error);
      }
      set({
        serverSyncStatus: 'error',
        serverSyncMessage: status === 401
          ? 'Central session expired. Please sign in again.'
          : status
            ? `Could not fetch synced servers from Central. HTTP ${status}.`
            : 'Could not fetch synced servers from Central.',
      });
    }
  },

  addServer: async (url, options = {}) => {
    const auth = captureAccountSession();
    if (auth.user?.accountType !== 'central' || !auth.token) {
      throw new Error('Adding servers needs a Central account.');
    }
    const serverUrl = normalizeServerUrl(url);
    if (!serverUrl) throw new Error('Enter a server address.');

    // Already joined: just switch to it.
    if (get().servers.some((server) => server.id === serverUrl)) {
      await get().setActiveServer(serverUrl);
      return serverUrl;
    }

    let info: NonNullable<SyncedServerEntry['info']> & { name?: string | null };
    try {
      info = (await axios.get(`${serverUrl}/api/server`, { timeout: 10_000 })).data ?? {};
    } catch (error) {
      if (axios.isAxiosError(error) && !error.response) {
        throw new Error(serverUrl.startsWith('http://')
          ? 'Could not reach this server. iOS only allows secure (https) servers.'
          : 'Could not reach this server. Check the address and that it is online.');
      }
      throw new Error('That address did not answer like a CatRealm server.');
    }
    if (!auth.isCurrent()) throw new Error('Your account changed while joining. Try again.');

    let serverToken: string;
    try {
      const assertion = await getRealmAssertion(serverUrl);
      if (!auth.isCurrent()) throw new Error('Your account changed while joining. Try again.');
      const res = await axios.post(`${serverUrl}/api/auth/central`, {
        token: assertion,
        inviteCode: options.inviteCode || undefined,
      }, { timeout: 10_000 });
      serverToken = res.data?.token;
      if (!serverToken) throw new Error('The server did not return a session.');
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        const serverError = error.response.data?.error;
        if (isRemovedFromServerMessage(serverError)) throw new Error('You were removed from this server.');
        throw new Error(typeof serverError === 'string' && serverError
          ? serverError
          : 'This server is decentralized only. Sign in to it directly with a local account.');
      }
      if (axios.isAxiosError(error) && !error.response) {
        throw new Error('Reached the server, but signing in to it failed. Try again.');
      }
      throw error instanceof Error ? error : new Error('Failed to join this server.');
    }
    if (!auth.isCurrent()) throw new Error('Your account changed while joining. Try again.');

    const entry: SyncedServerEntry = {
      url: serverUrl,
      name: info.name ?? 'Server',
      icon: info.serverIcon ? resolveMediaUrl(info.serverIcon, serverUrl) : null,
      token: serverToken,
      info,
      realmTrust: { state: 'unverified' },
    };
    const server = toMobileServer(entry);
    set((state) => ({
      rawSyncedServers: [...state.rawSyncedServers.filter((e) => normalizeServerUrl(e.url) !== serverUrl), entry],
      servers: [...state.servers.filter((s) => s.id !== serverUrl), server],
      serverLayout: [...state.serverLayout.filter((item) => item.type !== 'server' || item.url !== serverUrl), { type: 'server', url: serverUrl }],
      serverSyncStatus: 'ready',
      serverSyncMessage: null,
    }));
    // Persist locally and write the encrypted list back to Central (guarded merge).
    commitLayoutChange(get);
    void syncCentralProfileToServer(serverUrl, serverToken);
    void get().verifyRealmTrust(serverUrl);
    await get().setActiveServer(serverUrl);
    return serverUrl;
  },

  verifyRealmTrust: async (serverId, forceApproval = false) => {
    const server = get().servers.find((entry) => entry.id === serverId);
    const auth = captureAccountSession();
    const centralApi = createAuthenticatedApi();
    if (!server || auth.user?.accountType !== 'central' || !auth.token || !server.token) return;
    try {
      const identityRes = await axios.get<RealmIdentity>(`${server.url}/api/server/identity`, {
        headers: { 'X-CatRealm-Client': 'mobile' },
      });
      if (!auth.isCurrent()) return;
      const seenIdentity = {
        realmInstanceId: identityRes.data.realmInstanceId,
        realmKeyFingerprint: identityRes.data.realmKeyFingerprint,
      };
      const approvedIdentity = server.realmTrust?.approvedIdentity;
      const changed = !!approvedIdentity && (
        approvedIdentity.realmInstanceId !== seenIdentity.realmInstanceId
        || approvedIdentity.realmKeyFingerprint !== seenIdentity.realmKeyFingerprint
      );
      if (changed && !forceApproval) {
        set((state) => ({
          servers: state.servers.map((entry) => entry.id === serverId
            ? {
                ...entry,
                realmTrust: {
                  ...entry.realmTrust,
                  state: 'changed',
                  approvedIdentity,
                  seenIdentity,
                  lastSeenAt: Date.now(),
                },
              }
            : entry),
        }));
        return;
      }
      if (
        !forceApproval
        && approvedIdentity
        && approvedIdentity.realmInstanceId === seenIdentity.realmInstanceId
        && approvedIdentity.realmKeyFingerprint === seenIdentity.realmKeyFingerprint
        && server.realmTrust?.state === 'trusted'
      ) {
        set((state) => ({
          servers: state.servers.map((entry) => entry.id === serverId
            ? {
                ...entry,
                realmTrust: {
                  ...entry.realmTrust!,
                  seenIdentity,
                  lastSeenAt: Date.now(),
                },
              }
            : entry),
        }));
        return;
      }
      const realmApi = axios.create({
        baseURL: server.url,
        headers: { Authorization: `Bearer ${server.token}`, 'X-CatRealm-Client': 'mobile' },
      });
      const attestation = (await realmApi.post('/api/server/identity/attestation', {})).data;
      if (!auth.isCurrent()) return;
      const grant = (await centralApi.post('/api/notifications/realm-grants', {
        realmUrl: server.url,
        attestation,
      })).data;
      if (!auth.isCurrent()) return;
      await realmApi.post('/api/server/notification-grants', {
        grantId: grant.id,
        centralUserId: grant.centralUserId,
        grant,
      });
      if (!auth.isCurrent()) return;
      set((state) => ({
        servers: state.servers.map((entry) => entry.id === serverId
          ? {
              ...entry,
              realmTrust: {
                state: 'trusted',
                approvedIdentity: seenIdentity,
                seenIdentity,
                approvedAt: Date.now(),
                lastSeenAt: Date.now(),
              },
            }
          : entry),
      }));
    } catch (error) {
      if (!auth.isCurrent()) return;
      const message = axios.isAxiosError(error)
        ? String(error.response?.data?.error ?? error.message)
        : error instanceof Error ? error.message : 'Realm trust verification failed';
      set((state) => ({
        servers: state.servers.map((entry) => entry.id === serverId
          ? {
              ...entry,
              realmTrust: {
                ...entry.realmTrust,
                state: entry.realmTrust?.state === 'changed' ? 'changed' : 'error',
                lastError: message,
                lastSeenAt: Date.now(),
              },
            }
          : entry),
      }));
    }
  },
  applyCentralMentionSummary: (mentionsByRealm) =>
    set((state) => ({
      servers: state.servers.map((server) => ({
        ...server,
        mention: mentionsByRealm[server.url] ?? 0,
      })),
    })),

  // --- Layout & folder management ---

  reorderLayout: (newLayout) => {
    set({ serverLayout: newLayout });
    commitLayoutChange(get);
  },

  createFolder: (serverIds, name) => {
    const { servers, serverFolders, serverLayout } = get();
    serverIds = [...new Set(serverIds)].filter((id) => servers.some((server) => server.id === id));
    if (!serverIds.length) return '';
    // Creating a folder is also a move: a server must belong to only one folder.
    const remainingFolders = serverFolders.map((folder) => ({
      ...folder,
      serverUrls: folder.serverUrls.filter((id) => !serverIds.includes(id)),
    })).filter((folder) => folder.serverUrls.length > 0);
    const removedFolderIds = new Set(serverFolders.filter((folder) =>
      !remainingFolders.some((remaining) => remaining.id === folder.id),
    ).map((folder) => folder.id));
    const folderName = name?.trim() || `Folder ${serverFolders.length + 1}`;
    const folderId = randomUUID();
    const newFolder: ServerFolder = {
      id: folderId,
      name: folderName,
      color: DEFAULT_FOLDER_COLOR,
      serverUrls: [...serverIds],
      isOpen: true,
    };

    // Insert folder where the first folded server sat; drop those servers from top-level.
    let insertIndex: number | null = null;
    const filteredLayout: ServerLayoutItem[] = [];
    for (const item of serverLayout) {
      if ((item.type === 'server' && serverIds.includes(item.url)) ||
          (item.type === 'folder' && removedFolderIds.has(item.folderId))) {
        if (insertIndex === null) insertIndex = filteredLayout.length;
      } else {
        filteredLayout.push(item);
      }
    }
    const insertAt = insertIndex ?? filteredLayout.length;
    filteredLayout.splice(insertAt, 0, { type: 'folder', folderId });

    set({ serverFolders: [...remainingFolders, newFolder], serverLayout: filteredLayout });
    commitLayoutChange(get);
    return folderId;
  },

  deleteFolder: (folderId) => {
    set((s) => {
      const folder = s.serverFolders.find((f) => f.id === folderId);
      if (!folder) return s;
      const newLayout: ServerLayoutItem[] = [];
      for (const item of s.serverLayout) {
        if (item.type === 'folder' && item.folderId === folderId) {
          for (const url of folder.serverUrls) newLayout.push({ type: 'server', url });
        } else {
          newLayout.push(item);
        }
      }
      return {
        serverFolders: s.serverFolders.filter((f) => f.id !== folderId),
        serverLayout: newLayout,
      };
    });
    commitLayoutChange(get);
  },

  updateFolder: (folderId, updates) => {
    set((s) => ({
      serverFolders: s.serverFolders.map((f) => (f.id === folderId ? { ...f, ...updates } : f)),
    }));
    commitLayoutChange(get);
  },

  addServerToFolder: (serverId, folderId) => {
    if (!get().serverFolders.some((folder) => folder.id === folderId) ||
        !get().servers.some((server) => server.id === serverId)) return;
    set((s) => {
      let newLayout = s.serverLayout.filter(
        (item) => !(item.type === 'server' && item.url === serverId),
      );
      const newFolders = s.serverFolders.map((f) => {
        if (f.id === folderId) {
          return f.serverUrls.includes(serverId) ? f : { ...f, serverUrls: [...f.serverUrls, serverId] };
        }
        return { ...f, serverUrls: f.serverUrls.filter((u) => u !== serverId) };
      });
      const emptyFolderIds = new Set(
        newFolders.filter((f) => f.id !== folderId && f.serverUrls.length === 0).map((f) => f.id),
      );
      if (emptyFolderIds.size > 0) {
        newLayout = newLayout.filter((item) => !(item.type === 'folder' && emptyFolderIds.has(item.folderId)));
      }
      return {
        serverLayout: newLayout,
        serverFolders: newFolders.filter((f) => f.serverUrls.length > 0 || f.id === folderId),
      };
    });
    commitLayoutChange(get);
  },

  removeServerFromFolder: (serverId, folderId) => {
    if (!get().serverFolders.some((folder) => folder.id === folderId && folder.serverUrls.includes(serverId))) return;
    set((s) => {
      const folder = s.serverFolders.find((f) => f.id === folderId);
      if (!folder) return s;
      const newServerUrls = folder.serverUrls.filter((u) => u !== serverId);

      if (newServerUrls.length === 0) {
        const folderIdx = s.serverLayout.findIndex(
          (item) => item.type === 'folder' && item.folderId === folderId,
        );
        const newLayout = s.serverLayout.filter(
          (item) => !(item.type === 'folder' && item.folderId === folderId),
        );
        const insertAt = folderIdx !== -1 ? folderIdx : newLayout.length;
        newLayout.splice(insertAt, 0, { type: 'server', url: serverId });
        return {
          serverFolders: s.serverFolders.filter((f) => f.id !== folderId),
          serverLayout: newLayout,
        };
      }

      const folderIdx = s.serverLayout.findIndex(
        (item) => item.type === 'folder' && item.folderId === folderId,
      );
      const newLayout = [...s.serverLayout];
      const insertAt = folderIdx !== -1 ? folderIdx + 1 : newLayout.length;
      newLayout.splice(insertAt, 0, { type: 'server', url: serverId });
      return {
        serverFolders: s.serverFolders.map((f) =>
          f.id === folderId ? { ...f, serverUrls: newServerUrls } : f,
        ),
        serverLayout: newLayout,
      };
    });
    commitLayoutChange(get);
  },

  toggleFolder: (folderId) => {
    set((s) => ({
      serverFolders: s.serverFolders.map((f) => (f.id === folderId ? { ...f, isOpen: !f.isOpen } : f)),
    }));
    commitLayoutChange(get);
  },

  collapseAllFolders: () => {
    set((s) => ({ serverFolders: s.serverFolders.map((f) => ({ ...f, isOpen: false })) }));
    commitLayoutChange(get);
  },
}));

/** `example.com/` → `https://example.com`; keeps an explicit scheme. */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function isRemovedFromServerMessage(message: unknown): boolean {
  return typeof message === 'string' && /removed from (this )?server/i.test(message);
}

/** Best-effort: give a newly joined realm the Central avatar/banner (desktop parity). */
async function syncCentralProfileToServer(serverUrl: string, serverToken: string) {
  const user = useAuthStore.getState().user;
  if (user?.accountType !== 'central') return;
  const headers = { Authorization: `Bearer ${serverToken}` };
  const avatarUrl = user.avatar ? resolveMediaUrl(user.avatar, AUTH_BASE) : null;
  const bannerUrl = user.banner ? resolveMediaUrl(user.banner, AUTH_BASE) : null;
  let serverAvatar: string | null = null;
  let serverAvatarOverride: boolean | null = null;
  let serverBanner: string | null = null;
  try {
    const profile = (await axios.get(`${serverUrl}/api/profile/me`, { headers })).data;
    serverAvatar = typeof profile?.avatar === 'string' ? profile.avatar : null;
    serverAvatarOverride = typeof profile?.avatar_override === 'boolean' ? profile.avatar_override : null;
    serverBanner = typeof profile?.banner === 'string' ? profile.banner : null;
  } catch { /* fall through to best-effort sync */ }
  // Keep a realm-specific upload the user set on that server.
  const hasLocalAvatar = serverAvatar?.startsWith('/uploads/avatars/')
    && !/^\/uploads\/avatars\/default(?:-v2)?\.jpg$/i.test(serverAvatar);
  if (avatarUrl && !(serverAvatarOverride ?? hasLocalAvatar)) {
    await axios.post(`${serverUrl}/api/profile/me/avatar-url`, { url: avatarUrl }, { headers }).catch(() => {});
  }
  if (bannerUrl && !serverBanner?.startsWith('/uploads/banners/')) {
    await axios.post(`${serverUrl}/api/profile/me/banner-url`, { url: bannerUrl }, { headers }).catch(() => {});
  }
}

/** Persist layout/folders locally and schedule an encrypted write-back to Central. */
function commitLayoutChange(get: () => ServerState) {
  const { serverLayout, serverFolders, rawSyncedServers } = get();
  void persistLayoutLocally(serverLayout, serverFolders);
  scheduleServersSync(rawSyncedServers, serverLayout, serverFolders);
}

async function refreshCentralServerTokens(
  servers: SyncedServerEntry[],
  auth: ReturnType<typeof captureAccountSession>,
): Promise<SyncedServerEntry[]> {
  return Promise.all(
    servers.map(async (entry) => {
      if (!entry.url) return entry;
      try {
        if (!auth.isCurrent()) return entry;
        const assertion = await getRealmAssertion(entry.url.replace(/\/+$/, ''));
        if (!auth.isCurrent()) return entry;
        const res = await axios.post<{ token: string }>(
          `${entry.url.replace(/\/+$/, '')}/api/auth/central`,
          { token: assertion },
          {
            headers: { 'X-CatRealm-Client': 'mobile' },
            timeout: 15000,
          },
        );
        return { ...entry, token: res.data.token };
      } catch {
        return entry;
      }
    }),
  );
}

function toMobileServer(entry: SyncedServerEntry): MobileServer {
  const url = entry.url.replace(/\/+$/, '');
  return {
    id: url,
    name: entry.info?.name ?? entry.name ?? 'Server',
    url,
    token: entry.token ?? '',
    iconUrl: entry.info?.serverIcon ?? entry.icon ?? null,
    bannerUrl: entry.info?.serverBanner ?? null,
    membersOnline: entry.info?.userCount ?? 0,
    unread: 0,
    mention: 0,
    realmTrust: entry.realmTrust ?? { state: 'unverified' },
  };
}

setActiveServerGetter(() => {
  const state = useServerStore.getState();
  if (!state.activeServerId) return null;
  const server = state.byId(state.activeServerId);
  if (!server?.url || !server.token) return null;
  return { url: server.url, token: server.token };
});
