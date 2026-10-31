import { create } from 'zustand';
import axios from 'axios';
import type { ServerInfo, Channel, Category, Message, OnlineUser, Thread } from '../types';
import { useAuthStore, setOnLogoutCallback, setUpdateServerTokenCallback } from './authStore';
import { useChannelStore } from './channelStore';
import { useMessageStore } from './messageStore';
import { usePresenceStore } from './presenceStore';
import { useThreadStore } from './threadStore';
import { useDMStore } from './dmStore';
import { useGroupChatStore } from './groupChatStore';
import { useFriendStore } from './friendStore';
import { connectSocket, disconnectSocket, getSocket, setActiveSocketUrl, updateSocketAuthToken } from '../lib/socket';
import { setActiveServerGetter, setServerTokenRefresher } from '../lib/api';
import {
  saveServers, loadServers, clearServers, saveActiveServerUrl, loadActiveServerUrl,
  saveServerLayout, loadServerLayout, saveServerFolders, loadServerFolders, decodeToken,
} from '../utils/token';
import { AUTH_BASE, createAuthenticatedApi, refreshCentralSessionIfNeeded } from '../lib/authApi';
import { resolveAvatarUrl } from '../utils/avatar';
import { readServerList, syncGuardedServerList } from '../lib/guardedServerSync';
import { useUIStore } from './uiStore';
import { createApi } from '../lib/api';
import { attachRealmSocketRecovery } from '../lib/realmSocketRecovery';
import { getServerAvatarOverride } from '../lib/serverProfileAvatar';
import { httpRealmGatewayApplies, httpRealmGatewayEnabled, resolveHttpRealm, savedRealmHttpOrigin, selectRealmsForPlatform } from '../lib/httpRealmGateway';

export interface ServerEntry {
  url: string;
  originalHttpOrigin?: string;
  name: string;
  icon?: string;
  token: string;
  info: ServerInfo;
  prefs?: ServerPrefs;
  realmTrust?: RealmTrustRecord;
}

export interface RealmIdentity {
  realmInstanceId: string;
  realmPublicKeyPem: string;
  realmKeyFingerprint: string;
}

export type RealmTrustState = 'trusted' | 'changed' | 'unverified' | 'error';

export interface RealmTrustRecord {
  state: RealmTrustState;
  approvedIdentity?: Pick<RealmIdentity, 'realmInstanceId' | 'realmKeyFingerprint'>;
  seenIdentity?: Pick<RealmIdentity, 'realmInstanceId' | 'realmKeyFingerprint'>;
  approvedAt?: number;
  lastSeenAt?: number;
  lastError?: string;
}

export interface ServerFolder {
  id: string;
  name: string;
  color: string;
  serverUrls: string[];
  isOpen: boolean;
}

export type ServerLayoutItem =
  | { type: 'server'; url: string }
  | { type: 'folder'; folderId: string };

export interface ServerSnapshot {
  channels: Channel[];
  categories: Category[];
  activeChannelId: string | null;
  messagesByChannel: Record<string, Message[]>;
  messagesByThread: Record<string, Message[]>;
  onlineUsers: OnlineUser[];
  allMembers: OnlineUser[];
  threadsByChannel: Record<string, Thread[]>;
  prefsByChannel: Record<string, { muted: boolean; lastReadAt: number }>;
  unreadByChannel: Record<string, number>;
  mentionByChannel: Record<string, number>;
  channelListFetchedAt?: number | null;
  categoryListFetchedAt?: number | null;
}

export type ServerBadgeMode = 'mentions-only' | 'all';
export type ServerMentionScope = 'everyone' | 'user';

export interface ServerPrefs {
  muted: boolean;
  badgeMode: ServerBadgeMode;
  mentionScope: ServerMentionScope;
}

const DEFAULT_SERVER_PREFS: ServerPrefs = {
  muted: false,
  badgeMode: 'all',
  mentionScope: 'everyone',
};

function isRemovedFromServerMessage(message: unknown): boolean {
  return typeof message === 'string' && /removed from (this )?server/i.test(message);
}

export function normalizeServerPrefs(prefs?: Partial<ServerPrefs> | null): ServerPrefs {
  return {
    muted: prefs?.muted ?? DEFAULT_SERVER_PREFS.muted,
    badgeMode: prefs?.badgeMode ?? DEFAULT_SERVER_PREFS.badgeMode,
    mentionScope: prefs?.mentionScope ?? DEFAULT_SERVER_PREFS.mentionScope,
  };
}

interface ServerState {
  servers: ServerEntry[];
  activeServerUrl: string | null;
  snapshots: Record<string, ServerSnapshot>;
  serverStatus: Record<string, 'connected' | 'reconnecting' | 'disconnected' | 'idle'>;
  serverLayout: ServerLayoutItem[];
  serverFolders: ServerFolder[];

  addServer: (url: string, options?: { inviteCode?: string | null }) => Promise<void>;
  reconnectThroughHttpGateway: (url: string) => Promise<void>;
  removeServer: (url: string, reason: 'user' | 'membership') => void;
  switchServer: (url: string) => void;
  goHome: () => void;
  saveSnapshot: (url: string) => void;
  restoreSnapshot: (url: string) => void;
  persistServers: () => void;
  loadPersistedServers: () => void;
  setServerStatus: (url: string, status: 'connected' | 'reconnecting' | 'disconnected' | 'idle') => void;
  updateServerToken: (url: string, token: string) => void;
  setServerPrefs: (url: string, prefs: Partial<ServerPrefs>) => void;
  getServerPrefs: (url: string) => ServerPrefs;
  markServerAsRead: (url: string) => Promise<void>;
  verifyRealmTrust: (url: string, forceApproval?: boolean) => Promise<void>;
  applyCentralMentionSummary: (mentionsByChannel: Record<string, number>) => void;
  logoutCleanup: (keepServers: boolean) => void;
  reset: () => void;

  reorderLayout: (newLayout: ServerLayoutItem[]) => void;
  createFolder: (serverUrls: string[], name?: string) => string;
  deleteFolder: (folderId: string) => void;
  updateFolder: (folderId: string, updates: Partial<Pick<ServerFolder, 'name' | 'color' | 'serverUrls'>>) => void;
  addServerToFolder: (serverUrl: string, folderId: string) => void;
  removeServerFromFolder: (serverUrl: string, folderId: string) => void;
  toggleFolder: (folderId: string) => void;
  collapseAllFolders: () => void;
  markFolderAsRead: (folderId: string) => Promise<void>;
}

function buildServerStatus(servers: ServerEntry[]) {
  return servers.reduce<Record<string, 'connected' | 'reconnecting' | 'disconnected' | 'idle'>>((acc, s) => {
    acc[s.url] = 'idle';
    return acc;
  }, {});
}

function deriveLayoutFromServers(servers: ServerEntry[]): ServerLayoutItem[] {
  return servers.map((s) => ({ type: 'server', url: s.url }));
}

function shouldDebugPresenceServerStore(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('catrealm:debug-presence') === '1';
  } catch {
    return false;
  }
}

function logServerPresenceDebug(action: 'saveSnapshot' | 'restoreSnapshot' | 'switchServer', payload: Record<string, unknown>) {
  if (!shouldDebugPresenceServerStore()) return;
  console.debug('[presence-debug] server-store', { action, ...payload });
}

// Remove duplicates: servers that appear in folders must not also be in the top-level layout,
// and servers must not appear in more than one folder. Cleans up any corruption from old bugs.
function sanitizeLayoutAndFolders(
  layout: ServerLayoutItem[],
  folders: ServerFolder[]
): { layout: ServerLayoutItem[]; folders: ServerFolder[] } {
  const inFolder = new Set<string>();
  const cleanFolders = folders.map((f) => {
    const uniqueUrls: string[] = [];
    for (const url of f.serverUrls) {
      if (!inFolder.has(url)) {
        inFolder.add(url);
        uniqueUrls.push(url);
      }
    }
    return { ...f, serverUrls: uniqueUrls };
  }).filter((f) => f.serverUrls.length > 0);

  const seenLayoutItems = new Set<string>();
  const cleanLayout = layout.filter((item) => {
    if (item.type === 'server') {
      if (inFolder.has(item.url) || seenLayoutItems.has(item.url)) return false;
      seenLayoutItems.add(item.url);
      return true;
    }
    if (item.type === 'folder') {
      const exists = cleanFolders.some((f) => f.id === item.folderId);
      if (!exists || seenLayoutItems.has(item.folderId)) return false;
      seenLayoutItems.add(item.folderId);
      return true;
    }
    return false;
  });

  return { layout: cleanLayout, folders: cleanFolders };
}

// Synced entries this client hides because another URL represents the same
// realm here (gateway copy on desktop, direct HTTP copy on the web). Keyed by
// the visible URL so removing a realm also removes its hidden copies.
const hiddenRealmAliases = new Map<string, string[]>();

function addHiddenRealmAlias(visibleUrl: string, hiddenUrl: string) {
  const aliases = hiddenRealmAliases.get(visibleUrl) ?? [];
  if (!aliases.includes(hiddenUrl)) hiddenRealmAliases.set(visibleUrl, [...aliases, hiddenUrl]);
}

function applyRealmPlatformView(
  servers: ServerEntry[],
  layout: ServerLayoutItem[] | null | undefined,
  folders: ServerFolder[] | null | undefined,
) {
  const { servers: visible, renamed } = selectRealmsForPlatform(servers);
  hiddenRealmAliases.clear();
  for (const [hiddenUrl, visibleUrl] of renamed) addHiddenRealmAlias(visibleUrl, hiddenUrl);
  const rename = (url: string) => renamed.get(url) ?? url;
  return {
    servers: visible,
    layout: layout?.map((item) => item.type === 'server' ? { ...item, url: rename(item.url) } : item) ?? null,
    folders: folders?.map((folder) => ({ ...folder, serverUrls: folder.serverUrls.map(rename) })) ?? null,
    rename,
  };
}

type SetServerStatusFn = (url: string, status: 'connected' | 'reconnecting' | 'disconnected' | 'idle') => void;
const socketStatusHandlers = new Map<string, {
  socket: NonNullable<ReturnType<typeof getSocket>>;
  accountId: string | undefined;
  dispose: () => void;
}>();

export function attachServerSocketStatusHandlers(
  serverUrl: string,
  socket: ReturnType<typeof getSocket> extends infer T ? Exclude<T, null> : never,
  setServerStatus: SetServerStatusFn
) {
  const existingHandlers = socketStatusHandlers.get(serverUrl);
  const accountId = useAuthStore.getState().user?.id;
  if (existingHandlers?.socket === socket && existingHandlers.accountId === accountId) return;
  existingHandlers?.dispose();
  const dispose = attachRealmSocketRecovery(socket, {
    refreshToken: () => refreshServerToken(serverUrl),
    isCurrent: () => getSocket(serverUrl) === socket
      && useAuthStore.getState().user?.id === accountId
      && useServerStore.getState().servers.some(entry => entry.url === serverUrl),
    setStatus: status => setServerStatus(serverUrl, status),
  });
  socketStatusHandlers.set(serverUrl, { socket, accountId, dispose });
  if (socket.connected) setServerStatus(serverUrl, 'connected');
}

function connectBackgroundServerSockets(servers: ServerEntry[], setServerStatus: SetServerStatusFn) {
  const isSecureContext = typeof window !== 'undefined' && window.location.protocol === 'https:';
  for (const entry of servers) {
    if (isSecureContext && entry.url.startsWith('http://')) {
      setServerStatus(entry.url, 'disconnected');
      continue;
    }
    let socket = getSocket(entry.url);
    if (!socket?.connected) {
      setServerStatus(entry.url, 'reconnecting');
      socket = connectSocket(entry.url, entry.token);
    } else {
      setServerStatus(entry.url, 'connected');
    }
    if (socket) {
      attachServerSocketStatusHandlers(entry.url, socket, setServerStatus);
    }
  }
}

type ServerSyncJob = {
  servers: ServerEntry[];
  layout: ServerLayoutItem[];
  folders: ServerFolder[];
  accountId: string;
  syncKey: string;
  generation: number;
  removals: Map<string, number>;
};
let syncGeneration = 0;
let removalSequence = 0;
const explicitServerRemovals = new Map<string, number>();

async function syncServersToAuth(job: ServerSyncJob) {
  const isCurrent = () => {
    const auth = useAuthStore.getState();
    return syncGeneration === job.generation && auth.user?.accountType === 'central'
      && auth.user.id === job.accountId && auth.syncKey === job.syncKey && !!auth.token;
  };
  if (!isCurrent() || typeof crypto === 'undefined' || !crypto.subtle) return;
  try {
    const api = createAuthenticatedApi();
    api.defaults.timeout = 10_000;
    const synced = await syncGuardedServerList(api, job, job.syncKey,
      [...job.removals.keys()], isCurrent);
    if (synced) {
      for (const [url, sequence] of job.removals) {
        if (explicitServerRemovals.get(url) === sequence) explicitServerRemovals.delete(url);
      }
    }
  } catch {
    // Keep explicit removal intents for the next sync; never retry as an
    // unguarded replacement when central rejects or cannot read the list.
  }
}

const SERVER_SYNC_DEBOUNCE_MS = 2000;
let pendingServerSync: ServerSyncJob | null = null;
let serverSyncTimer: ReturnType<typeof setTimeout> | null = null;
let serverSyncQueue = Promise.resolve();
let serverListRetryTimer: ReturnType<typeof setTimeout> | null = null;
let serverListLoadSequence = 0;

function clearServerListRetry() {
  if (serverListRetryTimer) clearTimeout(serverListRetryTimer);
  serverListRetryTimer = null;
}

function cancelServerSync() {
  syncGeneration++;
  serverListLoadSequence++;
  clearServerListRetry();
  explicitServerRemovals.clear();
  pendingServerSync = null;
  if (serverSyncTimer) clearTimeout(serverSyncTimer);
  serverSyncTimer = null;
}

function scheduleServersSync(
  servers: ServerEntry[],
  layout: ServerLayoutItem[],
  folders: ServerFolder[]
) {
  const auth = useAuthStore.getState();
  if (auth.user?.accountType !== 'central' || !auth.syncKey || !auth.token) return;
  pendingServerSync = {
    servers, layout, folders, accountId: auth.user.id, syncKey: auth.syncKey,
    generation: syncGeneration, removals: new Map(explicitServerRemovals),
  };
  if (serverSyncTimer) {
    clearTimeout(serverSyncTimer);
  }
  serverSyncTimer = setTimeout(() => {
    serverSyncTimer = null;
    const nextSync = pendingServerSync;
    pendingServerSync = null;
    if (!nextSync) return;
    // Serialize local writes; central's revision check handles other devices.
    serverSyncQueue = serverSyncQueue.then(() => syncServersToAuth(nextSync));
  }, SERVER_SYNC_DEBOUNCE_MS);
}

async function fetchServersFromAuth(syncKey: string) {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  try {
    const res = await createAuthenticatedApi().get('/api/servers?protocol=2');
    return await readServerList(res.data, syncKey);
  } catch {
    return null;
  }
}

async function getRealmAssertion(serverUrl: string): Promise<string> {
  const url = new URL(serverUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Central accounts require a realm with a public HTTPS address.');
  }
  const response = await createAuthenticatedApi().post('/api/login/realm-assertion', { serverUrl: url.origin });
  if (typeof response.data?.token !== 'string' || response.data.audience !== url.origin) throw new Error('Invalid realm authorization response');
  return response.data.token;
}

async function refreshCentralServerTokens(servers: ServerEntry[]): Promise<ServerEntry[]> {
  return Promise.all(
    servers.map(async (entry) => {
      try {
        const assertion = await getRealmAssertion(entry.url);
        const authRes = await axios.post(`${entry.url}/api/auth/central`, { token: assertion });
        return { ...entry, token: authRes.data.token as string };
      } catch {
        return entry;
      }
    })
  );
}

export async function syncCentralProfileToServer(serverUrl: string, serverToken: string) {
  const user = useAuthStore.getState().user;
  if (user?.accountType !== 'central') return;

  const avatarUrl = user.avatar ? resolveAvatarUrl(user.avatar, AUTH_BASE) : null;
  const bannerUrl = user.banner ? resolveAvatarUrl(user.banner, AUTH_BASE) : null;
  let hasServerAvatarOverride = false;
  let serverProfileBanner: string | null = null;

  try {
    const profileRes = await axios.get(`${serverUrl}/api/profile/me`, {
      headers: { Authorization: `Bearer ${serverToken}` },
    });
    hasServerAvatarOverride = !!getServerAvatarOverride(profileRes.data ?? {});
    serverProfileBanner = typeof profileRes.data?.banner === 'string' ? profileRes.data.banner : null;
  } catch {
    // If we cannot read server profile, fall back to best-effort sync and ignore errors below.
  }

  const hasServerBannerOverride = !!serverProfileBanner && serverProfileBanner.startsWith('/uploads/banners/');

  try {
    if (avatarUrl && !hasServerAvatarOverride) {
      await axios.post(`${serverUrl}/api/profile/me/avatar-url`, { url: avatarUrl }, {
        headers: { Authorization: `Bearer ${serverToken}` },
      });
    }
  } catch {
    // ignore sync errors
  }

  try {
    if (bannerUrl && !hasServerBannerOverride) {
      await axios.post(`${serverUrl}/api/profile/me/banner-url`, { url: bannerUrl }, {
        headers: { Authorization: `Bearer ${serverToken}` },
      });
    }
  } catch {
    // ignore sync errors
  }
}

export async function syncCentralProfileToJoinedServers(): Promise<void> {
  const servers = useServerStore.getState().servers;
  await Promise.allSettled(servers.map((server) => syncCentralProfileToServer(server.url, server.token)));
}

function identitySummary(identity: RealmIdentity) {
  return {
    realmInstanceId: identity.realmInstanceId,
    realmKeyFingerprint: identity.realmKeyFingerprint,
  };
}

function sameRealmIdentity(
  a?: Pick<RealmIdentity, 'realmInstanceId' | 'realmKeyFingerprint'>,
  b?: Pick<RealmIdentity, 'realmInstanceId' | 'realmKeyFingerprint'>,
) {
  return !!a && !!b
    && a.realmInstanceId === b.realmInstanceId
    && a.realmKeyFingerprint === b.realmKeyFingerprint;
}

export const useServerStore = create<ServerState>((set, get) => ({
  servers: [],
  activeServerUrl: null,
  snapshots: {},
  serverStatus: {},
  serverLayout: [],
  serverFolders: [],

  addServer: async (url: string, options = {}) => {
    const requestedUrl = url.replace(/\/+$/, '');
    const requestedWasHttp = /^http:\/\//i.test(requestedUrl);
    let serverUrl = requestedUrl;
    let originalHttpOrigin: string | undefined;
    const isSecureContext = typeof window !== 'undefined' && window.location.protocol === 'https:';
    if (!/^https?:\/\//i.test(serverUrl)) {
      serverUrl = `${isSecureContext ? 'https' : 'http'}://${serverUrl}`;
    } else if (isSecureContext) {
      if (requestedWasHttp && httpRealmGatewayEnabled()) {
        const resolved = await resolveHttpRealm(requestedUrl);
        serverUrl = resolved.gatewayOrigin;
        originalHttpOrigin = resolved.realmOrigin;
      } else {
        serverUrl = serverUrl.replace(/^http:\/\//i, 'https://');
      }
    }

    // Check if already added
    if (get().servers.some((s) => s.url === serverUrl)) {
      get().switchServer(serverUrl);
      return;
    }

    // Fetch server info
    let info: ServerInfo;
    try {
      const infoRes = await axios.get(`${serverUrl}/api/server`);
      info = infoRes.data;
    } catch (err) {
      if (axios.isAxiosError(err) && !err.response) {
        if (isSecureContext && requestedWasHttp && !httpRealmGatewayEnabled()) {
          throw new Error(
            'This server appears to be HTTP-only. catrealm.app is HTTPS and cannot connect to HTTP servers. Enable HTTPS on that server or use the desktop app.'
          );
        }
        if (isSecureContext && serverUrl.startsWith('https://')) {
          throw new Error(
            'Could not reach this server over HTTPS. Check SSL certificate, port forwarding, and firewall settings.'
          );
        }
      }
      throw err;
    }

    // Exchange a short-lived assertion intended only for this realm.
    const realmAssertion = await getRealmAssertion(serverUrl);
    let serverToken: string;
    try {
      const authRes = await axios.post(`${serverUrl}/api/auth/central`, {
        token: realmAssertion,
        inviteCode: options.inviteCode || undefined,
      });
      serverToken = authRes.data.token;
      useAuthStore.getState().applyServerAuthRefresh({
        serverUrl,
        token: serverToken,
        user: authRes.data.user,
      });
    } catch (err) {
      if (axios.isAxiosError(err) && !err.response) {
        if (isSecureContext && requestedWasHttp && !httpRealmGatewayEnabled()) {
          throw new Error(
            'Connected to invite metadata, but central auth to this server failed because it is HTTP-only from an HTTPS page.'
          );
        }
        if (isSecureContext && requestedWasHttp && httpRealmGatewayEnabled()) {
          throw new Error('The HTTP realm gateway reached this server, but Central sign-in failed. Check that the realm is updated and can reach bridge.catrealm.app.');
        }
        if (isSecureContext && serverUrl.startsWith('https://')) {
          throw new Error(
            'Server reached, but central authentication over HTTPS failed. Verify reverse proxy and TLS config.'
          );
        }
      }
      if (axios.isAxiosError(err) && err.response?.status === 403) {
        const serverError = err.response.data?.error;
        if (isRemovedFromServerMessage(serverError)) {
          throw new Error('You were removed from this server.');
        }
        throw new Error(
          serverError || 'Server your attempting to connect to is Decentralized Only, login/register directly with that server.'
        );
      }
      throw err;
    }

    const entry: ServerEntry = {
      url: serverUrl,
      originalHttpOrigin,
      name: info.name,
      icon: info.serverIcon
        ? (String(info.serverIcon).startsWith('http') ? info.serverIcon : `${serverUrl}${info.serverIcon}`)
        : undefined,
      token: serverToken,
      info,
      prefs: DEFAULT_SERVER_PREFS,
      realmTrust: { state: 'unverified' },
    };

    explicitServerRemovals.delete(serverUrl);

    set((s) => ({
      servers: [...s.servers, entry],
      serverStatus: { ...s.serverStatus, [serverUrl]: 'reconnecting' },
      serverLayout: [...s.serverLayout, { type: 'server', url: serverUrl }],
    }));

    // Sync central avatar/banner to server (best-effort)
    await syncCentralProfileToServer(serverUrl, serverToken);
    void get().verifyRealmTrust(serverUrl);

    get().persistServers();
    get().switchServer(serverUrl);
  },

  reconnectThroughHttpGateway: async (url: string) => {
    const entry = get().servers.find((server) => server.url === url);
    const auth = useAuthStore.getState();
    const sessionId = typeof auth.token === 'string' ? decodeToken(auth.token)?.sid : null;
    const httpOrigin = entry && savedRealmHttpOrigin(entry.url);
    if (!entry || !httpOrigin || !httpRealmGatewayApplies() || auth.user?.accountType !== 'central') {
      throw new Error('This saved realm cannot use the HTTP gateway.');
    }

    const resolved = await resolveHttpRealm(httpOrigin);
    const approvedIdentity = entry.realmTrust?.approvedIdentity;
    if (approvedIdentity && !sameRealmIdentity(approvedIdentity, resolved)) {
      throw new Error('This realm’s identity changed. Review its identity before connecting.');
    }
    const assertion = await getRealmAssertion(resolved.gatewayOrigin);
    let infoRes;
    let authRes;
    try {
      [infoRes, authRes] = await Promise.all([
        axios.get<ServerInfo>(`${resolved.gatewayOrigin}/api/server`),
        axios.post(`${resolved.gatewayOrigin}/api/auth/central`, { token: assertion }),
      ]);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(String(error.response?.data?.error || error.message));
      }
      throw error;
    }
    const token = authRes.data?.token;
    if (typeof token !== 'string' || !token) throw new Error('The realm did not return a sign-in token.');
    const currentAuth = useAuthStore.getState();
    const currentSessionId = typeof currentAuth.token === 'string' ? decodeToken(currentAuth.token)?.sid : null;
    if (currentAuth.user?.id !== auth.user.id || currentAuth.user?.accountType !== 'central'
      || currentAuth.syncKey !== auth.syncKey || !currentAuth.token
      || (sessionId && currentSessionId
        ? sessionId !== currentSessionId : currentAuth.token !== auth.token)
      || !get().servers.some((server) => server.url === url)) {
      throw new Error('The account or saved realm changed while connecting.');
    }

    const gatewayUrl = resolved.gatewayOrigin;
    socketStatusHandlers.get(url)?.dispose();
    socketStatusHandlers.delete(url);
    disconnectSocket(url);
    if (get().activeServerUrl === url) get().goHome();
    // Desktop clients still connect to the direct entry, so hide it here
    // instead of removing it from the synced list.
    addHiddenRealmAlias(gatewayUrl, url);
    for (const alias of hiddenRealmAliases.get(url) ?? []) addHiddenRealmAlias(gatewayUrl, alias);
    hiddenRealmAliases.delete(url);
    if (get().servers.some((server) => server.url === gatewayUrl)) {
      set((state) => {
        const serverStatus = { ...state.serverStatus };
        const snapshots = { ...state.snapshots };
        delete serverStatus[url];
        delete snapshots[url];
        return {
          servers: state.servers.filter((server) => server.url !== url),
          serverStatus,
          snapshots,
          serverLayout: state.serverLayout.filter((item) => item.type !== 'server' || item.url !== url),
          serverFolders: state.serverFolders.map((folder) => ({
            ...folder, serverUrls: folder.serverUrls.filter((serverUrl) => serverUrl !== url),
          })).filter((folder) => folder.serverUrls.length > 0),
        };
      });
      get().persistServers();
      get().switchServer(gatewayUrl);
      return;
    }
    serverListLoadSequence++;
    clearServerListRetry();
    const nextEntry: ServerEntry = {
      ...entry,
      url: gatewayUrl,
      originalHttpOrigin: resolved.realmOrigin,
      token,
      name: infoRes.data.name || entry.name,
      icon: infoRes.data.serverIcon
        ? (String(infoRes.data.serverIcon).startsWith('http')
          ? String(infoRes.data.serverIcon) : `${gatewayUrl}${infoRes.data.serverIcon}`)
        : undefined,
      info: infoRes.data,
    };
    set((state) => {
      const { [url]: oldStatus, ...serverStatus } = state.serverStatus;
      const { [url]: oldSnapshot, ...snapshots } = state.snapshots;
      if (oldSnapshot) snapshots[gatewayUrl] = oldSnapshot;
      return {
        servers: state.servers.map((server) => server.url === url ? nextEntry : server),
        serverStatus: { ...serverStatus, [gatewayUrl]: 'reconnecting' },
        snapshots,
        serverLayout: state.serverLayout.map((item) => item.type === 'server' && item.url === url
          ? { ...item, url: gatewayUrl } : item),
        serverFolders: state.serverFolders.map((folder) => ({
          ...folder, serverUrls: folder.serverUrls.map((serverUrl) => serverUrl === url ? gatewayUrl : serverUrl),
        })),
      };
    });
    get().persistServers();
    get().switchServer(gatewayUrl);
    void get().verifyRealmTrust(gatewayUrl);
  },

  removeServer: (url, reason) => {
    // Require the caller to identify a real removal, never infer one from an
    // offline status, token error, or a shorter list snapshot.
    if (reason !== 'user' && reason !== 'membership') return;
    if (useAuthStore.getState().user?.accountType === 'central') {
      explicitServerRemovals.set(url, ++removalSequence);
      for (const alias of hiddenRealmAliases.get(url) ?? []) {
        explicitServerRemovals.set(alias, ++removalSequence);
      }
    }
    hiddenRealmAliases.delete(url);
    socketStatusHandlers.get(url)?.dispose();
    socketStatusHandlers.delete(url);
    const { activeServerUrl } = get();
    if (activeServerUrl === url) {
      get().goHome();
    }
    disconnectSocket(url);
    set((s) => {
      // Find folders that will become empty after removing this server
      const emptyFolderIds = new Set(
        s.serverFolders
          .filter((f) => f.serverUrls.length === 1 && f.serverUrls[0] === url)
          .map((f) => f.id)
      );
      const newFolders = s.serverFolders
        .map((f) => ({ ...f, serverUrls: f.serverUrls.filter((u) => u !== url) }))
        .filter((f) => f.serverUrls.length > 0);
      const newLayout = s.serverLayout.filter((item) => {
        if (item.type === 'server' && item.url === url) return false;
        if (item.type === 'folder' && emptyFolderIds.has(item.folderId)) return false;
        return true;
      });
      const { [url]: _status, ...restStatus } = s.serverStatus;
      const { [url]: _snap, ...restSnapshots } = s.snapshots;
      return {
        servers: s.servers.filter((sv) => sv.url !== url),
        serverStatus: restStatus,
        snapshots: restSnapshots,
        serverLayout: newLayout,
        serverFolders: newFolders,
      };
    });
    get().persistServers();
  },

  switchServer: (url: string) => {
    const candidate = get().servers.find((server) => server.url === url);
    if (candidate?.realmTrust?.state === 'changed') {
      useUIStore.getState().setRealmTrustPromptUrl(url);
      return;
    }
    logServerPresenceDebug('switchServer', {
      from: get().activeServerUrl,
      to: url,
      hasSnapshot: !!get().snapshots[url],
    });
    const isSecureContext = typeof window !== 'undefined' && window.location.protocol === 'https:';
    if (isSecureContext && url.startsWith('http://')) {
      useUIStore.getState().setSslBlockedServerUrl(url);
      useUIStore.getState().setConnectionStatus('disconnected');
      return;
    }
    const { activeServerUrl } = get();
    if (activeServerUrl === url) return;

    useUIStore.getState().setSslBlockedServerUrl(null);

    // Save snapshot of current server (socket stays alive)
    if (activeServerUrl) {
      get().saveSnapshot(activeServerUrl);
    }

    // Reset UI stores
    useChannelStore.getState().reset();
    useMessageStore.getState().reset();
    usePresenceStore.getState().reset();
    useThreadStore.getState().reset();

    // Restore snapshot if exists
    if (get().snapshots[url]) {
      get().restoreSnapshot(url);
    }

    // Set active
    set({ activeServerUrl: url });
    setActiveSocketUrl(url);
    saveActiveServerUrl(url);

    // Find entry and connect socket (reuse if already connected)
    const entry = get().servers.find((s) => s.url === url);
    if (entry) {
      // Update authStore with server info for components that read from it
      useAuthStore.setState({
        serverUrl: url,
        serverInfo: entry.info,
      });

      // Fetch a fresh server info snapshot on switch so icon/banner/name stay current.
      void axios.get(`${url}/api/server`)
        .then((res) => {
          const freshInfo: ServerInfo = res.data;
          set((s) => ({
            servers: s.servers.map((sv) => (
              sv.url === url
                ? {
                    ...sv,
                    name: freshInfo.name || sv.name,
                    icon: freshInfo.serverIcon
                      ? (String(freshInfo.serverIcon).startsWith('http') ? freshInfo.serverIcon : `${url}${freshInfo.serverIcon}`)
                      : undefined,
                    info: freshInfo,
                  }
                : sv
            )),
          }));
          if (get().activeServerUrl === url) {
            useAuthStore.setState({ serverInfo: freshInfo });
          }
        })
        .catch(() => {});

      // Best-effort sync central avatar/banner on switch
      void syncCentralProfileToServer(url, entry.token);
      // Only connect if not already connected
      const existingSocket = getSocket(url);
      const socket = existingSocket?.connected ? existingSocket : connectSocket(url, entry.token);
      attachServerSocketStatusHandlers(url, socket, get().setServerStatus);

      // Restore cached viewable channels immediately, then revalidate only if
      // stale/missing. Explicit admin and permission events still force refresh.
      void useChannelStore.getState().refreshChannelsIfStale();
      void useChannelStore.getState().refreshCategoriesIfStale().catch(() => {});
    }
  },

  goHome: () => {
    useUIStore.getState().setSslBlockedServerUrl(null);
    const { activeServerUrl } = get();
    if (activeServerUrl) {
      get().saveSnapshot(activeServerUrl);
    }

    // Reset UI stores (keep presence cached, socket stays alive)
    useChannelStore.getState().reset();
    useMessageStore.getState().reset();
    useThreadStore.getState().reset();

    set({ activeServerUrl: null });
    setActiveSocketUrl(null);
    saveActiveServerUrl(null);

    // Clear server-specific state from authStore
    useAuthStore.setState({
      serverUrl: null,
      serverInfo: null,
    });
  },

  saveSnapshot: (url: string) => {
    const channelSnap = useChannelStore.getState().getSnapshot();
    const messageSnap = useMessageStore.getState().getSnapshot();
    const presenceSnap = usePresenceStore.getState().getSnapshot();
    const threadSnap = useThreadStore.getState().getSnapshot();

    const snapshot: ServerSnapshot = {
      channels: channelSnap.channels,
      categories: channelSnap.categories,
      activeChannelId: channelSnap.activeChannelId,
      prefsByChannel: channelSnap.prefsByChannel,
      unreadByChannel: channelSnap.unreadByChannel,
      mentionByChannel: channelSnap.mentionByChannel,
      channelListFetchedAt: channelSnap.channelListFetchedAt,
      categoryListFetchedAt: channelSnap.categoryListFetchedAt,
      messagesByChannel: messageSnap.messagesByChannel,
      messagesByThread: messageSnap.messagesByThread,
      onlineUsers: presenceSnap.onlineUsers,
      allMembers: presenceSnap.allMembers,
      threadsByChannel: threadSnap.threadsByChannel,
    };

    logServerPresenceDebug('saveSnapshot', {
      url,
      onlineUsersCount: snapshot.onlineUsers.length,
      allMembersCount: snapshot.allMembers.length,
      onlineUsersWithActivity: snapshot.onlineUsers.filter((user) => !!user.activityType && !!user.activityText).length,
      allMembersWithActivity: snapshot.allMembers.filter((user) => !!user.activityType && !!user.activityText).length,
    });

    set((s) => ({
      snapshots: { ...s.snapshots, [url]: snapshot },
    }));
  },

  restoreSnapshot: (url: string) => {
    const snapshot = get().snapshots[url];
    if (!snapshot) return;

    logServerPresenceDebug('restoreSnapshot', {
      url,
      onlineUsersCount: snapshot.onlineUsers.length,
      allMembersCount: snapshot.allMembers.length,
      onlineUsersWithActivity: snapshot.onlineUsers.filter((user) => !!user.activityType && !!user.activityText).length,
      allMembersWithActivity: snapshot.allMembers.filter((user) => !!user.activityType && !!user.activityText).length,
    });

    useChannelStore.getState().loadSnapshot({
      channels: snapshot.channels,
      categories: snapshot.categories,
      activeChannelId: snapshot.activeChannelId,
      prefsByChannel: snapshot.prefsByChannel,
      unreadByChannel: snapshot.unreadByChannel,
      mentionByChannel: snapshot.mentionByChannel,
      channelListFetchedAt: snapshot.channelListFetchedAt ?? null,
      categoryListFetchedAt: snapshot.categoryListFetchedAt ?? null,
    });

    useMessageStore.getState().loadSnapshot({
      messagesByChannel: snapshot.messagesByChannel,
      messagesByThread: snapshot.messagesByThread,
    });

    usePresenceStore.getState().loadSnapshot({
      onlineUsers: snapshot.onlineUsers,
      allMembers: snapshot.allMembers ?? [],
    });

    useThreadStore.getState().loadSnapshot({
      threadsByChannel: snapshot.threadsByChannel,
    });
  },

  persistServers: () => {
    const { servers, serverLayout, serverFolders } = get();
    saveServers(servers);
    saveServerLayout(serverLayout);
    saveServerFolders(serverFolders);
    scheduleServersSync(servers, serverLayout, serverFolders);
  },

  loadPersistedServers: () => {
    clearServerListRetry();
    const loadSequence = ++serverListLoadSequence;
    const authState = useAuthStore.getState();
    const generation = syncGeneration;
    const sessionId = typeof authState.token === 'string' ? decodeToken(authState.token)?.sid : null;
    const isCurrent = () => {
      const auth = useAuthStore.getState();
      const currentSessionId = typeof auth.token === 'string' ? decodeToken(auth.token)?.sid : null;
      return generation === syncGeneration && auth.user?.id === authState.user?.id
        && loadSequence === serverListLoadSequence && auth.syncKey === authState.syncKey
        && auth.user?.accountType === authState.user?.accountType
        && !!auth.token && (sessionId && currentSessionId
          ? sessionId === currentSessionId : auth.token === authState.token);
    };
    const isCentralUser = authState.user?.accountType === 'central' && !!authState.token;
    const localView = applyRealmPlatformView(isCentralUser ? [] : loadServers(),
      loadServerLayout(), loadServerFolders());
    const localServers = localView.servers;
    if (localServers.length > 0) {
      const storedLayout = localView.layout;
      const storedFolders = localView.folders ?? [];
      const rawLayout = storedLayout ?? deriveLayoutFromServers(localServers);
      const { layout: serverLayout, folders: serverFolders } = sanitizeLayoutAndFolders(rawLayout, storedFolders);
      set({
        servers: localServers,
        serverStatus: buildServerStatus(localServers),
        serverLayout,
        serverFolders,
      });
      if (isCentralUser) {
        connectBackgroundServerSockets(localServers, get().setServerStatus);
      }
      const storedActive = loadActiveServerUrl();
      const lastActive = storedActive && localView.rename(storedActive);
      if (lastActive && localServers.some((s) => s.url === lastActive)) {
        const isSecureContext = typeof window !== 'undefined' && window.location.protocol === 'https:';
        if (isSecureContext && lastActive.startsWith('http://')) {
          useUIStore.getState().setSslBlockedServerUrl(lastActive);
        } else {
          get().switchServer(lastActive);
        }
      }
    }

    if (authState.user?.accountType === 'central' && authState.syncKey && authState.token) {
      // Never reuse cached local server list between different central accounts.
      clearServers();
      void fetchServersFromAuth(authState.syncKey).then((remoteData) => {
        if (!isCurrent()) return;
        if (remoteData === null) {
          // A failed sync request is not an authoritative empty realm list.
          // Retry independently of the DM socket; it may stay connected while
          // the realm list was temporarily unavailable during startup.
          serverListRetryTimer = setTimeout(() => {
            serverListRetryTimer = null;
            if (isCurrent()) get().loadPersistedServers();
          }, 15_000);
          return;
        }

        const remoteView = applyRealmPlatformView(remoteData.servers, remoteData.layout, remoteData.folders);
        const { servers: remoteServers, layout, folders } = remoteView;

        if (remoteServers.length === 0) {
          set({ servers: [], serverStatus: {}, serverLayout: [], serverFolders: [] });
          return;
        }

        void refreshCentralServerTokens(remoteServers).then((freshServers) => {
          if (!isCurrent()) return;
          const rawLayout = layout ?? deriveLayoutFromServers(freshServers);
          const rawFolders = folders ?? [];
          const { layout: serverLayout, folders: serverFolders } = sanitizeLayoutAndFolders(rawLayout, rawFolders);
          set({
            servers: freshServers,
            serverStatus: buildServerStatus(freshServers),
            serverLayout,
            serverFolders,
          });
          saveServers(freshServers);
          saveServerLayout(serverLayout);
          saveServerFolders(serverFolders);
          connectBackgroundServerSockets(freshServers, get().setServerStatus);
          freshServers.forEach((server) => void get().verifyRealmTrust(server.url));

          const storedActive = loadActiveServerUrl();
          const lastActive = storedActive && remoteView.rename(storedActive);
          if (lastActive && freshServers.some((s) => s.url === lastActive)) {
            const isSecureContext = typeof window !== 'undefined' && window.location.protocol === 'https:';
            if (isSecureContext && lastActive.startsWith('http://')) {
              useUIStore.getState().setSslBlockedServerUrl(lastActive);
            } else {
              get().switchServer(lastActive);
            }
          }
        });
      });
    }
  },

  setServerStatus: (url, status) => {
    const actualStatus = status !== 'connected' && getSocket(url)?.connected ? 'connected' : status;
    set((s) => ({
      serverStatus: { ...s.serverStatus, [url]: actualStatus },
    }));
  },

  updateServerToken: (url, token) => {
    updateSocketAuthToken(url, token);
    set((s) => ({
      servers: s.servers.map((sv) => (sv.url === url ? { ...sv, token } : sv)),
    }));
    get().persistServers();
  },

  setServerPrefs: (url, prefs) => {
    set((s) => ({
      servers: s.servers.map((sv) => {
        if (sv.url !== url) return sv;
        const nextPrefs = normalizeServerPrefs({ ...sv.prefs, ...prefs });
        return { ...sv, prefs: nextPrefs };
      }),
    }));
    get().persistServers();
  },

  getServerPrefs: (url) => {
    const entry = get().servers.find((s) => s.url === url);
    return normalizeServerPrefs(entry?.prefs);
  },

  markServerAsRead: async (url) => {
    const now = Math.floor(Date.now() / 1000);
    const state = get();
    if (state.activeServerUrl === url) {
      const channelState = useChannelStore.getState();
      const channels = channelState.channels;
      await Promise.all(
        channels.map((ch) => channelState.setChannelPrefs(ch.id, { lastReadAt: now }))
      );
      channels.forEach((ch) => channelState.resetCounts(ch.id));
      return;
    }

    const entry = state.servers.find((s) => s.url === url);
    if (!entry) return;

    set((s) => {
      const snap = s.snapshots[url];
      if (!snap) return s;
      const nextPrefs: Record<string, { muted: boolean; lastReadAt: number }> = { ...snap.prefsByChannel };
      Object.keys(nextPrefs).forEach((channelId) => {
        nextPrefs[channelId] = { ...nextPrefs[channelId], lastReadAt: now };
      });
      return {
        snapshots: {
          ...s.snapshots,
          [url]: {
            ...snap,
            prefsByChannel: nextPrefs,
            unreadByChannel: Object.fromEntries(Object.keys(snap.unreadByChannel).map((k) => [k, 0])),
            mentionByChannel: Object.fromEntries(Object.keys(snap.mentionByChannel).map((k) => [k, 0])),
          },
        },
      };
    });

    try {
      const api = createApi(entry.url, entry.token);
      const res = await api.get('/api/channels');
      const channels: Channel[] = res.data;
      await Promise.all(
        channels.map((ch) => api.patch(`/api/channels/${ch.id}/prefs`, { lastReadAt: now }))
      );
    } catch {
      // best-effort only
    }
  },

  verifyRealmTrust: async (url, forceApproval = false) => {
    const entry = get().servers.find((server) => server.url === url);
    const authState = useAuthStore.getState();
    if (!entry || authState.user?.accountType !== 'central' || !authState.token || !entry.token) return;
    try {
      const identityRes = await axios.get<RealmIdentity>(`${url}/api/server/identity`);
      const identity = identityRes.data;
      const seenIdentity = identitySummary(identity);
      const approvedIdentity = entry.realmTrust?.approvedIdentity;
      if (approvedIdentity && !sameRealmIdentity(approvedIdentity, seenIdentity) && !forceApproval) {
        disconnectSocket(url);
        if (get().activeServerUrl === url) get().goHome();
        set((state) => ({
          servers: state.servers.map((server) => server.url === url
            ? {
                ...server,
                realmTrust: {
                  ...server.realmTrust,
                  state: 'changed',
                  approvedIdentity,
                  seenIdentity,
                  lastSeenAt: Date.now(),
                },
              }
            : server),
        }));
        get().persistServers();
        return;
      }
      if (!forceApproval && sameRealmIdentity(approvedIdentity, seenIdentity) && entry.realmTrust?.state === 'trusted') {
        set((state) => ({
          servers: state.servers.map((server) => server.url === url
            ? {
                ...server,
                realmTrust: {
                  ...server.realmTrust!,
                  seenIdentity,
                  lastSeenAt: Date.now(),
                },
              }
            : server),
        }));
        get().persistServers();
        return;
      }

      const realmApi = createApi(url, entry.token);
      const attestation = (await realmApi.post('/api/server/identity/attestation', {})).data;
      const grant = (await createAuthenticatedApi().post('/api/notifications/realm-grants', {
        realmUrl: url,
        attestation,
      })).data;
      await realmApi.post('/api/server/notification-grants', {
        grantId: grant.id,
        centralUserId: grant.centralUserId,
        grant,
      });
      set((state) => ({
        servers: state.servers.map((server) => server.url === url
          ? {
              ...server,
              realmTrust: {
                state: 'trusted',
                approvedIdentity: seenIdentity,
                seenIdentity,
                approvedAt: Date.now(),
                lastSeenAt: Date.now(),
              },
            }
          : server),
      }));
      get().persistServers();
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? String(error.response?.data?.error ?? error.message)
        : error instanceof Error ? error.message : 'Realm trust verification failed';
      set((state) => ({
        servers: state.servers.map((server) => server.url === url
          ? {
              ...server,
              realmTrust: {
                ...server.realmTrust,
                state: server.realmTrust?.state === 'changed' ? 'changed' : 'error',
                lastError: message,
                lastSeenAt: Date.now(),
              },
            }
          : server),
      }));
      get().persistServers();
    }
  },

  applyCentralMentionSummary: (mentionsByChannel) => {
    const activeUrl = get().activeServerUrl;
    if (activeUrl) {
      const activePrefix = `${activeUrl}:`;
      const activeMentions: Record<string, number> = {};
      for (const [key, count] of Object.entries(mentionsByChannel)) {
        if (!key.startsWith(activePrefix)) continue;
        activeMentions[key.slice(activePrefix.length)] = count;
      }
      useChannelStore.setState((state) => ({
        mentionByChannel: {
          ...Object.fromEntries(Object.keys(state.mentionByChannel).map((channelId) => [channelId, 0])),
          ...activeMentions,
        },
      }));
    }

    set((state) => {
      const snapshots = { ...state.snapshots };
      for (const server of state.servers) {
        const snapshot = snapshots[server.url];
        if (!snapshot) continue;
        const prefix = `${server.url}:`;
        const nextMentionByChannel = {
          ...Object.fromEntries(Object.keys(snapshot.mentionByChannel).map((channelId) => [channelId, 0])),
        };
        for (const [key, count] of Object.entries(mentionsByChannel)) {
          if (!key.startsWith(prefix)) continue;
          nextMentionByChannel[key.slice(prefix.length)] = count;
        }
        snapshots[server.url] = {
          ...snapshot,
          mentionByChannel: nextMentionByChannel,
        };
      }
      return { snapshots };
    });
  },

  reset: () => {
    cancelServerSync();
    for (const handlers of socketStatusHandlers.values()) handlers.dispose();
    socketStatusHandlers.clear();
    set({ servers: [], activeServerUrl: null, snapshots: {}, serverStatus: {}, serverLayout: [], serverFolders: [] });
    setActiveSocketUrl(null);
    saveActiveServerUrl(null);
  },

  logoutCleanup: (keepServers) => {
    cancelServerSync();
    if (!keepServers) {
      get().reset();
      return;
    }
    // Keep server list, just clear active connection and snapshots
    set((s) => ({
      activeServerUrl: null,
      snapshots: {},
      serverStatus: Object.fromEntries(Object.keys(s.serverStatus).map((k) => [k, 'idle'])),
    }));
    disconnectSocket();
    setActiveSocketUrl(null);
    saveActiveServerUrl(null);
  },

  // --- Layout & folder methods ---

  reorderLayout: (newLayout) => {
    set({ serverLayout: newLayout });
    get().persistServers();
  },

  createFolder: (serverUrls, name) => {
    const { serverFolders, serverLayout } = get();
    const folderName = name ?? `Folder ${serverFolders.length + 1}`;
    const folderId = crypto.randomUUID();
    const newFolder: ServerFolder = {
      id: folderId,
      name: folderName,
      color: '#5865F2',
      serverUrls,
      isOpen: true,
    };

    // Insert folder at the position of the first server being folded; remove those servers from top-level layout
    let insertIndex: number | null = null;
    const filteredLayout: ServerLayoutItem[] = [];
    for (const item of serverLayout) {
      if (item.type === 'server' && serverUrls.includes(item.url)) {
        if (insertIndex === null) {
          insertIndex = filteredLayout.length;
        }
        // Skip — server moves into the folder
      } else {
        filteredLayout.push(item);
      }
    }
    const insertAt = insertIndex !== null ? insertIndex : filteredLayout.length;
    filteredLayout.splice(insertAt, 0, { type: 'folder', folderId });

    set((s) => ({
      serverFolders: [...s.serverFolders, newFolder],
      serverLayout: filteredLayout,
    }));
    get().persistServers();
    return folderId;
  },

  deleteFolder: (folderId) => {
    set((s) => {
      const folder = s.serverFolders.find((f) => f.id === folderId);
      if (!folder) return s;
      // Replace folder in layout with its servers
      const newLayout: ServerLayoutItem[] = [];
      for (const item of s.serverLayout) {
        if (item.type === 'folder' && item.folderId === folderId) {
          for (const url of folder.serverUrls) {
            newLayout.push({ type: 'server', url });
          }
        } else {
          newLayout.push(item);
        }
      }
      return {
        serverFolders: s.serverFolders.filter((f) => f.id !== folderId),
        serverLayout: newLayout,
      };
    });
    get().persistServers();
  },

  updateFolder: (folderId, updates) => {
    set((s) => ({
      serverFolders: s.serverFolders.map((f) =>
        f.id === folderId ? { ...f, ...updates } : f
      ),
    }));
    get().persistServers();
  },

  addServerToFolder: (serverUrl, folderId) => {
    set((s) => {
      // Remove server from top-level layout
      let newLayout = s.serverLayout.filter(
        (item) => !(item.type === 'server' && item.url === serverUrl)
      );
      // Add to target folder; remove from any other folder; delete folders that become empty
      const newFolders = s.serverFolders
        .map((f) => {
          if (f.id === folderId) {
            return f.serverUrls.includes(serverUrl) ? f : { ...f, serverUrls: [...f.serverUrls, serverUrl] };
          }
          return { ...f, serverUrls: f.serverUrls.filter((u) => u !== serverUrl) };
        });
      // Remove now-empty folders (except target) from layout and folder list
      const emptyFolderIds = new Set(
        newFolders.filter((f) => f.id !== folderId && f.serverUrls.length === 0).map((f) => f.id)
      );
      if (emptyFolderIds.size > 0) {
        newLayout = newLayout.filter((item) => !(item.type === 'folder' && emptyFolderIds.has(item.folderId)));
      }
      return {
        serverLayout: newLayout,
        serverFolders: newFolders.filter((f) => f.serverUrls.length > 0 || f.id === folderId),
      };
    });
    get().persistServers();
  },

  removeServerFromFolder: (serverUrl, folderId) => {
    set((s) => {
      const folder = s.serverFolders.find((f) => f.id === folderId);
      if (!folder) return s;

      const newServerUrls = folder.serverUrls.filter((u) => u !== serverUrl);

      if (newServerUrls.length === 0) {
        // Delete folder; replace folder entry in layout with the server
        const folderIdx = s.serverLayout.findIndex(
          (item) => item.type === 'folder' && item.folderId === folderId
        );
        const newLayout = s.serverLayout.filter(
          (item) => !(item.type === 'folder' && item.folderId === folderId)
        );
        const insertAt = folderIdx !== -1 ? folderIdx : newLayout.length;
        newLayout.splice(insertAt, 0, { type: 'server', url: serverUrl });
        return {
          serverFolders: s.serverFolders.filter((f) => f.id !== folderId),
          serverLayout: newLayout,
        };
      }

      // Place server back in layout after the folder
      const folderIdx = s.serverLayout.findIndex(
        (item) => item.type === 'folder' && item.folderId === folderId
      );
      const newLayout = [...s.serverLayout];
      const insertAt = folderIdx !== -1 ? folderIdx + 1 : newLayout.length;
      newLayout.splice(insertAt, 0, { type: 'server', url: serverUrl });

      return {
        serverFolders: s.serverFolders.map((f) =>
          f.id === folderId ? { ...f, serverUrls: newServerUrls } : f
        ),
        serverLayout: newLayout,
      };
    });
    get().persistServers();
  },

  toggleFolder: (folderId) => {
    set((s) => ({
      serverFolders: s.serverFolders.map((f) =>
        f.id === folderId ? { ...f, isOpen: !f.isOpen } : f
      ),
    }));
    get().persistServers();
  },

  collapseAllFolders: () => {
    set((s) => ({
      serverFolders: s.serverFolders.map((f) => ({ ...f, isOpen: false })),
    }));
    get().persistServers();
  },

  markFolderAsRead: async (folderId) => {
    const folder = get().serverFolders.find((f) => f.id === folderId);
    if (!folder) return;
    await Promise.all(folder.serverUrls.map((url) => get().markServerAsRead(url)));
  },
}));

// Re-mint an expired server token from the central JWT. Concurrent callers
// share one request, and a failure is cached briefly so a server that keeps
// rejecting us is not re-asked on every single HTTP call.
const REAUTH_FAILURE_COOLDOWN_MS = 30_000;
const pendingTokenRefresh = new Map<string, Promise<string | null>>();
const lastTokenRefreshFailure = new Map<string, number>();

function refreshServerToken(serverUrl: string): Promise<string | null> {
  const inFlight = pendingTokenRefresh.get(serverUrl);
  if (inFlight) return inFlight;

  const failedAt = lastTokenRefreshFailure.get(serverUrl);
  if (failedAt && Date.now() - failedAt < REAUTH_FAILURE_COOLDOWN_MS) return Promise.resolve(null);

  const authState = useAuthStore.getState();
  if (authState.user?.accountType !== 'central' || !authState.token) return Promise.resolve(null);

  const request = (async () => {
    try {
      // A long idle can lapse both tokens at once, and the realm verifies the
      // central JWT before minting a server one — so refresh that first, or the
      // mint fails for the very reason we are here. Returns the current token
      // untouched unless it is near or past expiry (desktop gets a grace window
      // before expiry via /api/login/refresh).
      const centralToken = await refreshCentralSessionIfNeeded();
      if (!centralToken) {
        lastTokenRefreshFailure.set(serverUrl, Date.now());
        return null;
      }

      const assertion = await getRealmAssertion(serverUrl);
      const res = await axios.post(`${serverUrl}/api/auth/central`, { token: assertion }, { timeout: 10_000 });
      // Ignore a recovery result after logout/account switching or explicit removal.
      if (useAuthStore.getState().user?.id !== authState.user?.id
        || !useServerStore.getState().servers.some(entry => entry.url === serverUrl)) return null;
      const nextToken = typeof res.data?.token === 'string' ? res.data.token : null;
      if (!nextToken) {
        lastTokenRefreshFailure.set(serverUrl, Date.now());
        return null;
      }
      lastTokenRefreshFailure.delete(serverUrl);
      useServerStore.getState().updateServerToken(serverUrl, nextToken);
      return nextToken;
    } catch {
      lastTokenRefreshFailure.set(serverUrl, Date.now());
      return null;
    } finally {
      pendingTokenRefresh.delete(serverUrl);
    }
  })();

  pendingTokenRefresh.set(serverUrl, request);
  return request;
}

setServerTokenRefresher(refreshServerToken);

// Register the active server getter for createApi
setActiveServerGetter(() => {
  const state = useServerStore.getState();
  if (!state.activeServerUrl) return null;
  const entry = state.servers.find((s) => s.url === state.activeServerUrl);
  if (!entry) return null;
  return { url: entry.url, token: entry.token };
});

// Register logout callback to reset serverStore (avoids circular import)
setOnLogoutCallback((keepServers) => {
  useServerStore.getState().logoutCleanup(keepServers);
  useDMStore.getState().reset();
  useGroupChatStore.getState().reset();
  useFriendStore.getState().reset();
});

// Register server token updater for central account owner-claim flow
setUpdateServerTokenCallback((url, token) => {
  useServerStore.getState().updateServerToken(url, token);
});
