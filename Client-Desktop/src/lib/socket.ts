import { io, Socket } from 'socket.io-client';
import { AUTH_BASE } from './authApi';
import { getCentralDeviceCredentials } from './centralDeviceCredentials';

const sockets = new Map<string, Socket>();
let activeUrl: string | null = null;

export function setActiveSocketUrl(url: string | null) {
  activeUrl = url;
}

export function connectSocket(serverUrl: string, token: string): Socket {
  const auth = { token, clientType: 'desktop', ...(serverUrl.replace(/\/+$/, '') === AUTH_BASE ? getCentralDeviceCredentials() : {}) };
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
  if (serverUrl) {
    return sockets.get(serverUrl) ?? null;
  }
  // Return the active server's socket
  if (activeUrl) {
    return sockets.get(activeUrl) ?? null;
  }
  // Fallback: if only one socket, return it (decentralized mode)
  if (sockets.size === 1) {
    return sockets.values().next().value ?? null;
  }
  return null;
}

export function updateSocketAuthToken(serverUrl: string, token: string) {
  const socket = sockets.get(serverUrl);
  if (socket) {
    socket.auth = { ...(typeof socket.auth === 'object' ? socket.auth : {}), token };
  }
}

export function disconnectSocket(serverUrl?: string) {
  if (serverUrl) {
    sockets.get(serverUrl)?.disconnect();
    sockets.delete(serverUrl);
  } else {
    sockets.forEach((s) => s.disconnect());
    sockets.clear();
    activeUrl = null;
  }
}
