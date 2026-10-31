import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { RoomEvent } from 'livekit-client';

// Each "client" is a fresh module registry (vi.resetModules) with freshly
// registered store mocks (vi.doMock in loadClient; vi.mock instances would be
// shared), like two separate CatRealm apps in one call.
function mockClientStores(dmSecrets: Map<string, string>) {
  // DM keys by conversation id, per client: a client only "has" a key listed here.
  vi.doMock('../../messaging/crypto/dmKeyStore', () => ({
    fetchDMKeyManifest: async () => ({ activeKeyVersion: 1 }),
    loadConversationSecretForCurrentDevice: async (conversationId: string) => dmSecrets.get(conversationId) ?? null,
  }));
  vi.doMock('../../stores/mediaStore', () => ({ useMediaStore: create(() => ({ activeSession: null as unknown })) }));
  vi.doMock('../../stores/voiceStore', () => ({ useVoiceStore: create(() => ({ voiceServerUrl: null })) }));
  vi.doMock('../../stores/authStore', () => ({ useAuthStore: create(() => ({ user: null as unknown })) }));
  vi.doMock('../../stores/friendStore', () => ({ useFriendStore: create(() => ({ friends: [] as { id: string }[] })) }));
  vi.doMock('../../stores/dmStore', () => ({ useDMStore: create(() => ({ conversations: [] as { id: string; otherUserId: string }[] })) }));
  vi.doMock('../../stores/blockedUsersStore', () => ({ useBlockedUsersStore: create(() => ({ isBlocked: () => false })) }));
  vi.doMock('../../stores/settingsStore', () => ({ useSettingsStore: create(() => ({ obsOverlayEnabled: false, obsOverlayReactiveAvatars: false })) }));
}

function randomSecret() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
}

function conversationId(a: string, b: string) {
  return [a, b].sort().join(':');
}

// ── Fake LiveKit network ─────────────────────────────────────────────────────

type Listener = (...args: unknown[]) => void;

class FakeRoom {
  listeners = new Map<string, Set<Listener>>();
  byteHandlers = new Map<string, (reader: unknown, info: { identity: string }) => void>();
  remoteParticipants = new Map<string, { identity: string }>();
  localParticipant: {
    publishData: (payload: Uint8Array, opts: { topic?: string; destinationIdentities?: string[] }) => Promise<void>;
    streamBytes: (opts: { topic: string; destinationIdentities: string[]; attributes: Record<string, string>; totalSize: number }) => Promise<{
      write: (chunk: Uint8Array) => Promise<void>;
      close: () => Promise<void>;
    }>;
  };

  net: FakeNet;
  identity: string;

  constructor(net: FakeNet, identity: string) {
    this.net = net;
    this.identity = identity;
    this.localParticipant = {
      publishData: async (payload, { topic, destinationIdentities }) => {
        for (const peer of this.net.peersOf(this, destinationIdentities)) {
          setTimeout(() => peer.emit(RoomEvent.DataReceived, payload.slice(), { identity: this.identity }, undefined, topic), 0);
        }
      },
      streamBytes: async ({ topic, destinationIdentities, attributes, totalSize }) => {
        const chunks: Uint8Array[] = [];
        return {
          write: async (chunk) => {
            chunks.push(chunk.slice());
          },
          close: async () => {
            for (const peer of this.net.peersOf(this, destinationIdentities)) {
              const handler = peer.byteHandlers.get(topic);
              const reader = {
                info: { attributes, size: totalSize },
                async *[Symbol.asyncIterator]() {
                  for (const chunk of chunks) yield chunk;
                },
              };
              setTimeout(() => handler?.(reader, { identity: this.identity }), 0);
            }
          },
        };
      },
    };
  }

  on(event: string, fn: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return this;
  }
  off(event: string, fn: Listener) {
    this.listeners.get(event)?.delete(fn);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((fn) => fn(...args));
  }
  registerByteStreamHandler(topic: string, handler: (reader: unknown, info: { identity: string }) => void) {
    if (this.byteHandlers.has(topic)) throw new Error('already registered');
    this.byteHandlers.set(topic, handler);
  }
  unregisterByteStreamHandler(topic: string) {
    this.byteHandlers.delete(topic);
  }
}

class FakeNet {
  rooms: FakeRoom[] = [];
  join(room: FakeRoom) {
    for (const other of this.rooms) {
      other.remoteParticipants.set(room.identity, { identity: room.identity });
      room.remoteParticipants.set(other.identity, { identity: other.identity });
    }
    this.rooms.push(room);
    for (const other of this.rooms) if (other !== room) other.emit(RoomEvent.ParticipantConnected, { identity: room.identity });
  }
  peersOf(from: FakeRoom, destinations?: string[]) {
    return this.rooms.filter((r) => r !== from && (!destinations?.length || destinations.includes(r.identity)));
  }
}

// ── Shared fake disk behind window.electron ──────────────────────────────────

const disk = new Map<string, Uint8Array>();
async function hexId(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return `${[...digest].map((b) => b.toString(16).padStart(2, '0')).join('')}.png`;
}

beforeEach(() => {
  disk.clear();
  (window as unknown as { electron: unknown }).electron = {
    reactiveAvatarReadImage: async (id: string) => (disk.has(id) ? { ok: true, bytes: disk.get(id), mime: 'image/png' } : { ok: false }),
    reactiveAvatarSaveImage: async (bytes: Uint8Array) => {
      const id = await hexId(bytes);
      disk.set(id, bytes.slice());
      return { ok: true, id };
    },
    reactiveAvatarPrune: async () => ({ ok: true }),
  };
});

afterEach(() => {
  delete (window as unknown as { electron?: unknown }).electron;
});

type Client = Awaited<ReturnType<typeof loadClient>>;

async function loadClient(
  centralId: string,
  opts: { receiving?: boolean; friends?: string[]; dmSecrets?: Map<string, string> } = {},
) {
  vi.resetModules();
  mockClientStores(opts.dmSecrets ?? new Map());
  window.localStorage.clear();
  const exchange = await import('../reactiveAvatarShare/exchange');
  const { useMediaStore } = await import('../../stores/mediaStore');
  const { useAuthStore } = await import('../../stores/authStore');
  const { useFriendStore } = await import('../../stores/friendStore');
  const { useDMStore } = await import('../../stores/dmStore');
  const { useSettingsStore } = await import('../../stores/settingsStore');
  const { useReactiveAvatarStore } = await import('../../stores/reactiveAvatarStore');
  const { useReactiveShareStore } = await import('../../stores/reactiveShareStore');
  // Mocked stores only carry the fields the exchange reads.
  useAuthStore.setState({ user: { id: centralId, accountType: 'central' } } as never);
  useFriendStore.setState({ friends: (opts.friends ?? []).map((id) => ({ id })) } as never);
  useDMStore.setState({ conversations: (opts.friends ?? []).map((id) => ({ id: conversationId(centralId, id), otherUserId: id })) } as never);
  useSettingsStore.setState({ obsOverlayEnabled: !!opts.receiving, obsOverlayReactiveAvatars: !!opts.receiving });
  exchange.initReactiveAvatarExchange();
  return { centralId, exchange, useMediaStore, useReactiveAvatarStore, useReactiveShareStore };
}

async function giveMyPack(client: Client) {
  const idle = await window.electron!.reactiveAvatarSaveImage!(new Uint8Array([1, 2, 3, 4]));
  const speaking = await window.electron!.reactiveAvatarSaveImage!(new Uint8Array([5, 6, 7]));
  if (!idle.ok || !speaking.ok) throw new Error('save failed');
  client.useReactiveAvatarStore.setState({
    myPack: { images: { idle: idle.id, speaking: speaking.id }, motion: 'pop', updatedAt: Date.now(), shareCopies: {} },
  });
  return { idleId: idle.id, speakingId: speaking.id };
}

function joinCall(net: FakeNet, client: Client) {
  const room = new FakeRoom(net, client.centralId);
  net.join(room);
  client.useMediaStore.setState({ activeSession: { room, context: 'dm', identity: client.centralId } } as never);
}

describe('reactive avatar exchange', () => {
  it('delivers a friend pack privately and verifies it', async () => {
    const net = new FakeNet();
    const shared = new Map([[conversationId('alice', 'bob'), randomSecret()]]);
    const alice = await loadClient('alice', { friends: ['bob'], dmSecrets: shared });
    await giveMyPack(alice);
    const bob = await loadClient('bob', { receiving: true, friends: ['alice'], dmSecrets: shared });
    joinCall(net, alice);
    joinCall(net, bob);

    await vi.waitFor(() => {
      expect(bob.useReactiveShareStore.getState().offered['central:alice']?.status).toBe('ready');
    }, { timeout: 3000 });
    const offer = bob.useReactiveShareStore.getState().offered['central:alice'];
    expect(offer.kind).toBe('friend');
    const received = bob.useReactiveShareStore.getState().received[offer.hash];
    expect(received.motion).toBe('pop');
    expect([...disk.get(received.images.idle!)!]).toEqual([1, 2, 3, 4]);
    expect([...disk.get(received.images.speaking!)!]).toEqual([5, 6, 7]);
  });

  it('sends the share copy instead of a large original', async () => {
    const net = new FakeNet();
    const shared = new Map([[conversationId('alice', 'bob'), randomSecret()]]);
    const alice = await loadClient('alice', { friends: ['bob'], dmSecrets: shared });
    const { idleId } = await giveMyPack(alice);
    const copy = await window.electron!.reactiveAvatarSaveImage!(new Uint8Array([42]));
    if (!copy.ok) throw new Error('save failed');
    alice.useReactiveAvatarStore.getState().setMyShareCopy(idleId, copy.id);
    const bob = await loadClient('bob', { receiving: true, friends: ['alice'], dmSecrets: shared });
    joinCall(net, alice);
    joinCall(net, bob);

    await vi.waitFor(() => {
      expect(bob.useReactiveShareStore.getState().offered['central:alice']?.status).toBe('ready');
    }, { timeout: 3000 });
    const offer = bob.useReactiveShareStore.getState().offered['central:alice'];
    const received = bob.useReactiveShareStore.getState().received[offer.hash];
    expect([...disk.get(received.images.idle!)!]).toEqual([42]);
    // Alice's own pack still points at her original.
    expect(alice.useReactiveAvatarStore.getState().myPack.images.idle).toBe(idleId);
  });

  it('only downloads a stranger pack after it is allowed', async () => {
    const net = new FakeNet();
    const carol = await loadClient('carol');
    carol.useReactiveShareStore.setState({ shareMode: 'everyone' });
    await giveMyPack(carol);
    const bob = await loadClient('bob', { receiving: true });
    joinCall(net, carol);
    joinCall(net, bob);

    await vi.waitFor(() => {
      expect(bob.useReactiveShareStore.getState().offered['central:carol']?.status).toBe('available');
    }, { timeout: 3000 });
    // Not fetched (or shown) until allowed.
    await new Promise((r) => setTimeout(r, 50));
    expect(Object.keys(bob.useReactiveShareStore.getState().received)).toHaveLength(0);

    bob.useReactiveShareStore.getState().setApproval('central:carol', 'allowed');
    await vi.waitFor(() => {
      expect(bob.useReactiveShareStore.getState().offered['central:carol']?.status).toBe('ready');
    }, { timeout: 3000 });
    expect(bob.useReactiveShareStore.getState().offered['central:carol'].kind).toBe('public');
  });

  it('shares nothing with strangers when sharing with friends only', async () => {
    const net = new FakeNet();
    const carol = await loadClient('carol');
    await giveMyPack(carol);
    const bob = await loadClient('bob', { receiving: true });
    joinCall(net, carol);
    joinCall(net, bob);
    await new Promise((r) => setTimeout(r, 100));
    expect(bob.useReactiveShareStore.getState().offered).toEqual({});
  });

  it('ignores someone claiming to be a friend without the DM key', async () => {
    const net = new FakeNet();
    const conv = conversationId('alice', 'bob');
    const bob = await loadClient('bob', { receiving: true, friends: ['alice'], dmSecrets: new Map([[conv, randomSecret()]]) });
    // mallory claims alice's central id, but only has a key she made up.
    const mallory = await loadClient('alice', { friends: ['bob'], dmSecrets: new Map([[conv, randomSecret()]]) });
    await giveMyPack(mallory);
    const malloryRoom = new FakeRoom(net, 'mallory-identity');
    net.join(malloryRoom);
    mallory.useMediaStore.setState({ activeSession: { room: malloryRoom, context: 'dm', identity: 'mallory-identity' } } as never);
    joinCall(net, bob);
    // Her client sends a sealed offer (wrong key); she also forges one by hand.
    await new Promise((r) => setTimeout(r, 100));
    const forged = new TextEncoder().encode(JSON.stringify({ v: 1, t: 'offer', from: 'alice', to: 'bob', kv: 1, s: btoa('x'.repeat(40)) }));
    await malloryRoom.localParticipant.publishData(forged, { topic: 'catrealm.reactive-avatar.v1', destinationIdentities: ['bob'] });
    await new Promise((r) => setTimeout(r, 100));
    expect(bob.useReactiveShareStore.getState().offered['central:mallory-identity']).toBeUndefined();
    expect(Object.keys(bob.useReactiveShareStore.getState().received)).toHaveLength(0);
  });
});
