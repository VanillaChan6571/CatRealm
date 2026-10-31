import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRealtimeReconnectTarget,
  consumeRealtimeReconnectTarget,
  getRealtimeReconnectTarget,
  persistRealtimeReconnectTarget,
} from '../realtimeReconnect';

describe('realtime reconnect target persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it('returns a saved target only for the matching server and user', () => {
    persistRealtimeReconnectTarget({
      kind: 'theater',
      serverUrl: 'https://server-a.example',
      channelId: 'theater-1',
      channelName: 'Movie Night',
      userId: 'user-1',
    });

    expect(getRealtimeReconnectTarget({
      serverUrl: 'https://server-a.example',
      userId: 'user-1',
    })).toMatchObject({
      kind: 'theater',
      serverUrl: 'https://server-a.example',
      channelId: 'theater-1',
      channelName: 'Movie Night',
      userId: 'user-1',
    });
    expect(getRealtimeReconnectTarget({
      serverUrl: 'https://server-b.example',
      userId: 'user-1',
    })).toBeNull();
    expect(getRealtimeReconnectTarget({
      serverUrl: 'https://server-a.example',
      userId: 'user-2',
    })).toBeNull();
  });

  it('can consume or clear a target after a failed reconnect attempt', () => {
    persistRealtimeReconnectTarget({
      kind: 'voice',
      serverUrl: 'https://server-a.example',
      channelId: 'voice-1',
      channelName: null,
      userId: 'user-1',
    });

    expect(consumeRealtimeReconnectTarget({
      serverUrl: 'https://server-a.example',
      userId: 'user-1',
    })?.channelId).toBe('voice-1');
    expect(getRealtimeReconnectTarget({
      serverUrl: 'https://server-a.example',
      userId: 'user-1',
    })).toBeNull();

    persistRealtimeReconnectTarget({
      kind: 'theater',
      serverUrl: 'https://server-a.example',
      channelId: 'theater-1',
      channelName: null,
      userId: 'user-1',
    });
    clearRealtimeReconnectTarget('theater');
    expect(getRealtimeReconnectTarget({
      serverUrl: 'https://server-a.example',
      userId: 'user-1',
    })).toBeNull();
  });
});
