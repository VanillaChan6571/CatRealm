import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Socket } from 'socket.io-client';
import { attachRealmSocketRecovery, isRealmCredentialError, isRealmMembershipError } from '../realmSocketRecovery';

class FakeSocket extends EventEmitter {
  connected = false;
  auth = { token: 'old-token', clientType: 'desktop' };
  io = new EventEmitter();
  connect = vi.fn(() => this);
}

function tokenExpiringAt(expirySeconds: number) {
  return `header.${btoa(JSON.stringify({ exp: expirySeconds }))}.signature`;
}

describe('realm socket recovery', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(refreshToken = vi.fn<() => Promise<string | null>>().mockResolvedValue('new-token')) {
    const socket = new FakeSocket();
    const current = { value: true };
    const setStatus = vi.fn();
    const dispose = attachRealmSocketRecovery(socket as unknown as Socket, {
      refreshToken, isCurrent: () => current.value, setStatus,
    });
    return { socket, current, refreshToken, setStatus, dispose };
  }

  it('distinguishes stale credentials from an explicit removal or ban', () => {
    for (const message of ['Invalid token', 'No token', 'Invalid or expired token', 'No token provided']) {
      expect(isRealmCredentialError(message)).toBe(true);
      expect(isRealmMembershipError(message)).toBe(false);
    }
    expect(isRealmMembershipError('Removed from server')).toBe(true);
    expect(isRealmMembershipError('Banned from server')).toBe(true);
    expect(isRealmMembershipError('websocket error')).toBe(false);
  });

  it('refreshes a rotated token and explicitly reconnects', async () => {
    const h = setup();
    h.socket.emit('connect_error', new Error('Invalid token'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.refreshToken).toHaveBeenCalledTimes(1);
    expect(h.socket.auth).toEqual({ token: 'new-token', clientType: 'desktop' });
    expect(h.socket.connect).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it('refreshes an expired token when the WebSocket closes before the realm can reject it', async () => {
    const h = setup();
    h.socket.auth.token = tokenExpiringAt(Math.floor(Date.now() / 1000) - 1);
    h.socket.emit('connect_error', new Error('websocket error'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.refreshToken).toHaveBeenCalledTimes(1);
    expect(h.socket.auth.token).toBe('new-token');
    expect(h.socket.connect).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it('leaves a current token to normal transport reconnection', async () => {
    const h = setup();
    h.socket.auth.token = tokenExpiringAt(Math.floor(Date.now() / 1000) + 3600);
    h.socket.emit('connect_error', new Error('websocket error'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.refreshToken).not.toHaveBeenCalled();
    h.dispose();
  });

  it('retries a failed refresh after the restarting realm recovers', async () => {
    const h = setup(vi.fn<() => Promise<string | null>>().mockResolvedValueOnce(null).mockResolvedValue('new-token'));
    h.socket.emit('connect_error', new Error('Invalid token'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.socket.connect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.refreshToken).toHaveBeenCalledTimes(2);
    expect(h.socket.connect).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it('bounds retries if the realm keeps rejecting freshly issued tokens', async () => {
    const h = setup();
    h.socket.emit('connect_error', new Error('Invalid token'));
    await vi.advanceTimersByTimeAsync(0);
    h.socket.emit('connect_error', new Error('Invalid token'));
    h.socket.emit('connect_error', new Error('Invalid token'));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(h.refreshToken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.refreshToken).toHaveBeenCalledTimes(2);
    h.dispose();
  });

  it('reconnects a background realm after a server-initiated restart', async () => {
    const h = setup();
    h.socket.emit('disconnect', 'io server disconnect');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.socket.connect).toHaveBeenCalledTimes(1);
    expect(h.refreshToken).not.toHaveBeenCalled();
    h.dispose();
  });

  it('stops retries on explicit membership rejection', async () => {
    const h = setup();
    h.socket.emit('disconnect', 'io server disconnect');
    h.socket.emit('connect_error', new Error('Banned from server'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.socket.connect).not.toHaveBeenCalled();
    expect(h.refreshToken).not.toHaveBeenCalled();
    h.dispose();
  });

  it('ignores a refresh completed after removal or account switching', async () => {
    let resolve!: (token: string) => void;
    const h = setup(vi.fn(() => new Promise<string>(done => { resolve = done; })));
    h.socket.emit('connect_error', new Error('Invalid token'));
    await vi.advanceTimersByTimeAsync(0);
    h.current.value = false;
    resolve('stale-result');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.socket.auth.token).toBe('old-token');
    expect(h.socket.connect).not.toHaveBeenCalled();
    h.dispose();
  });

  it('disposes its listeners and timer without removing other socket listeners', async () => {
    const h = setup();
    const other = vi.fn();
    h.socket.on('connect_error', other);
    h.socket.emit('disconnect', 'io server disconnect');
    h.dispose();
    await vi.advanceTimersByTimeAsync(30_000);
    h.socket.emit('connect_error', new Error('Invalid token'));
    expect(other).toHaveBeenCalledTimes(1);
    expect(h.socket.connect).not.toHaveBeenCalled();
    expect(h.refreshToken).not.toHaveBeenCalled();
  });
});
