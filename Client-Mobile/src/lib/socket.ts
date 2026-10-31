/**
 * Socket.io adapter — mirrors `CatRealm-Client/src/lib/socket.ts`.
 *
 * Multiple sockets can be live at once (one per CatRealm server). The "active"
 * socket follows the user's currently-focused server. Decentralized mode uses
 * exactly one socket; in that case `getSocket()` returns it without needing
 * to set an active URL first.
 */

import { io, Socket } from 'socket.io-client';
import { AUTH_BASE } from '@/lib/api';
import { getCentralDeviceHeadersForUser } from '@/lib/centralDeviceCredentials';
import { useAuthStore } from '@/stores/authStore';

const sockets = new Map<string, Socket>();
let activeUrl: string | null = null;

export function setActiveSocketUrl(url: string | null) {
  activeUrl = url;
}

export function getActiveSocketUrl(): string | null {
  return activeUrl;
}

export function resolveServerSocketToken(
  accountType: string | undefined,
  realmToken: string | undefined,
  accountToken: string | null,
): string | null {
  return accountType === 'central' ? realmToken || null : realmToken || accountToken;
}

export function connectSocket(serverUrl: string, token: string): Socket {
  const isCentral = new URL(serverUrl).origin === new URL(AUTH_BASE).origin;
  const accountId = useAuthStore.getState().user?.id;
  const auth: Socket['auth'] = isCentral
    ? (callback) => {
        void (async () => {
          const proof: Record<string, string> = accountId ? await getCentralDeviceHeadersForUser(accountId) : {};
          const current = useAuthStore.getState();
          if (current.user?.id !== accountId || current.user?.accountType !== 'central' || !current.token) {
            callback({ token: '', clientType: 'mobile' });
            return;
          }
          callback({
            token: current.token,
            clientType: 'mobile',
            deviceId: proof['X-CatRealm-Device-Id'],
            deviceSecret: proof['X-CatRealm-Device-Secret'],
          });
        })().catch(() => callback({ token: '', clientType: 'mobile' }));
      }
    : { token, clientType: 'mobile' };
  const existing = sockets.get(serverUrl);
  if (existing) {
    existing.auth = auth;
    if (!existing.connected) {
      existing.connect();
    }
    return existing;
  }

  const socket = io(serverUrl, {
    auth,
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  });

  sockets.set(serverUrl, socket);
  return socket;
}

export function getSocket(serverUrl?: string): Socket | null {
  if (serverUrl) return sockets.get(serverUrl) ?? null;
  if (activeUrl) return sockets.get(activeUrl) ?? null;
  if (sockets.size === 1) return sockets.values().next().value ?? null;
  return null;
}

export function disconnectSocket(serverUrl?: string) {
  if (serverUrl) {
    sockets.get(serverUrl)?.disconnect();
    sockets.delete(serverUrl);
    if (activeUrl === serverUrl) activeUrl = null;
    return;
  }
  sockets.forEach((s) => s.disconnect());
  sockets.clear();
  activeUrl = null;
}

/** Iterate live sockets — useful for fan-out events like presence pings. */
export function forEachSocket(fn: (socket: Socket, url: string) => void) {
  sockets.forEach(fn);
}
