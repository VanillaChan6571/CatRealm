import type { User } from '../types';
import type { ServerEntry, ServerFolder, ServerLayoutItem } from '../stores/serverStore';

const STORAGE_KEY = 'catrealm_session';
const SERVERS_KEY = 'catrealm_servers';
const ACTIVE_SERVER_KEY = 'catrealm_active_server';
const LAST_CHANNELS_KEY = 'catrealm_last_channels';

interface StoredSession {
  token: string;
  serverUrl?: string;
  user: User;
  syncKey?: string;
}

export function saveSession(token: string, serverUrl: string | null, user: User, syncKey?: string | null) {
  const data: StoredSession = { token, user };
  if (serverUrl) data.serverUrl = serverUrl;
  if (syncKey) data.syncKey = syncKey;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export function saveServers(servers: ServerEntry[]) {
  localStorage.setItem(SERVERS_KEY, JSON.stringify(servers));
}

export function loadServers(): ServerEntry[] {
  try {
    const raw = localStorage.getItem(SERVERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function clearServers() {
  localStorage.removeItem(SERVERS_KEY);
}

export function saveActiveServerUrl(url: string | null) {
  if (!url) {
    localStorage.removeItem(ACTIVE_SERVER_KEY);
    return;
  }
  localStorage.setItem(ACTIVE_SERVER_KEY, url);
}

export function loadActiveServerUrl(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SERVER_KEY);
  } catch {
    return null;
  }
}

export function saveLastChannelId(serverUrl: string, channelId: string) {
  try {
    const raw = localStorage.getItem(LAST_CHANNELS_KEY);
    const map: Record<string, string> = raw ? JSON.parse(raw) : {};
    map[serverUrl] = channelId;
    localStorage.setItem(LAST_CHANNELS_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

export function loadLastChannelId(serverUrl: string): string | null {
  try {
    const raw = localStorage.getItem(LAST_CHANNELS_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    return map[serverUrl] || null;
  } catch {
    return null;
  }
}

const SERVER_LAYOUT_KEY = 'catrealm_server_layout';
const SERVER_FOLDERS_KEY = 'catrealm_server_folders';

export function saveServerLayout(layout: ServerLayoutItem[]): void {
  localStorage.setItem(SERVER_LAYOUT_KEY, JSON.stringify(layout));
}

export function loadServerLayout(): ServerLayoutItem[] | null {
  try {
    const raw = localStorage.getItem(SERVER_LAYOUT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ServerLayoutItem[];
  } catch {
    return null;
  }
}

export function saveServerFolders(folders: ServerFolder[]): void {
  localStorage.setItem(SERVER_FOLDERS_KEY, JSON.stringify(folders));
}

export function loadServerFolders(): ServerFolder[] {
  try {
    const raw = localStorage.getItem(SERVER_FOLDERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ServerFolder[];
  } catch {
    return [];
  }
}

export function decodeToken(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

export function parseTokenUser(payload: Record<string, unknown>): User {
  if (payload.type === 'central') {
    return {
      id: payload.sub as string,
      username: payload.username as string,
      accountType: 'central',
    };
  }
  if (payload.account_type === 'central') {
    return {
      id: payload.id as string,
      username: payload.username as string,
      role: payload.role as string,
      isOwner: Boolean(payload.is_owner),
      permissions: typeof payload.permissions === 'number' ? payload.permissions : undefined,
      accountType: 'central',
    };
  }
  return {
    id: payload.id as string,
    username: payload.username as string,
    role: payload.role as string,
    isOwner: Boolean(payload.is_owner),
    permissions: typeof payload.permissions === 'number' ? payload.permissions : undefined,
    accountType: 'local',
  };
}
