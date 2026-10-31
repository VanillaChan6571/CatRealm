import type { Socket } from 'socket.io-client';
import { decodeToken } from '../utils/token';

export function isRealmCredentialError(message: unknown): boolean {
  return typeof message === 'string' && /^(invalid(?: or expired)? token|no token(?: provided)?|jwt expired)$/i.test(message.trim());
}

export function isRealmMembershipError(message: unknown): boolean {
  return typeof message === 'string' && /^(removed from server|banned from server)$/i.test(message.trim());
}

function socketTokenExpired(socket: Socket): boolean {
  const token = typeof socket.auth === 'object' && socket.auth !== null ? socket.auth.token : null;
  const expiry = typeof token === 'string' ? decodeToken(token)?.exp : null;
  return typeof expiry === 'number' && expiry * 1000 <= Date.now();
}

type RecoveryOptions = {
  refreshToken: () => Promise<string | null>;
  isCurrent: () => boolean;
  setStatus: (status: 'connected' | 'reconnecting' | 'disconnected' | 'idle') => void;
};

// Handshake rejection disables Socket.IO's automatic reconnect. Recover the
// credential and explicitly reconnect, without changing saved realm membership.
export function attachRealmSocketRecovery(socket: Socket, options: RecoveryOptions): () => void {
  let disposed = false;
  let refreshing = false;
  let lastRefreshAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const current = () => !disposed && options.isCurrent();
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = (callback: () => void, delay: number) => {
    if (!current() || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      if (current() && !socket.connected) callback();
    }, delay);
  };
  const recover = async () => {
    if (!current() || refreshing || socket.connected) return;
    refreshing = true;
    lastRefreshAt = Date.now();
    options.setStatus('reconnecting');
    try {
      const token = await options.refreshToken();
      if (!current() || socket.connected) return;
      if (token) {
        socket.auth = { ...(typeof socket.auth === 'object' ? socket.auth : {}), token };
        socket.connect();
      } else {
        options.setStatus('disconnected');
        schedule(() => { void recover(); }, 30_000);
      }
    } catch {
      if (current()) {
        options.setStatus('disconnected');
        schedule(() => { void recover(); }, 30_000);
      }
    } finally {
      refreshing = false;
    }
  };
  const onConnect = () => {
    clearTimer();
    lastRefreshAt = -Infinity;
    if (current()) options.setStatus('connected');
  };
  const onDisconnect = (reason: string) => {
    if (!current()) return;
    clearTimer();
    options.setStatus(reason === 'io client disconnect' ? 'idle' : 'disconnected');
    if (reason === 'io server disconnect') {
      schedule(() => { options.setStatus('reconnecting'); socket.connect(); }, 10_000);
    }
  };
  const onConnectError = (error: Error) => {
    if (!current()) return;
    options.setStatus('disconnected');
    if (isRealmMembershipError(error.message)) {
      clearTimer();
      return;
    }
    // Some proxies close the WebSocket before Socket.IO can report the realm's
    // "Invalid token" rejection. If our local token has expired, renew it
    // instead of retrying the same credential indefinitely.
    if ((!isRealmCredentialError(error.message) && !socketTokenExpired(socket)) || refreshing) return;
    clearTimer();
    schedule(() => { void recover(); }, Math.max(0, 30_000 - (Date.now() - lastRefreshAt)));
  };
  const onReconnectAttempt = () => { if (current()) options.setStatus('reconnecting'); };
  socket.on('connect', onConnect);
  socket.on('disconnect', onDisconnect);
  socket.on('connect_error', onConnectError);
  socket.io.on('reconnect_attempt', onReconnectAttempt);
  return () => {
    disposed = true;
    clearTimer();
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
    socket.off('connect_error', onConnectError);
    socket.io.off('reconnect_attempt', onReconnectAttempt);
  };
}
