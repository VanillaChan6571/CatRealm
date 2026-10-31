import { RoomEvent, type ByteStreamReader, type RemoteParticipant, type Room } from 'livekit-client';
import { useAuthStore } from '../../stores/authStore';
import { useBlockedUsersStore } from '../../stores/blockedUsersStore';
import { useDMStore } from '../../stores/dmStore';
import { useFriendStore } from '../../stores/friendStore';
import { useMediaStore } from '../../stores/mediaStore';
import { REACTIVE_AVATAR_STATES, useReactiveAvatarStore, type ReactiveAvatarState } from '../../stores/reactiveAvatarStore';
import { isOfferShown, useReactiveShareStore } from '../../stores/reactiveShareStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { fetchDMKeyManifest, loadConversationSecretForCurrentDevice } from '../../messaging/crypto/dmKeyStore';
import { base64ToBytes, bytesToBase64 } from '../../messaging/crypto/base64';
import { getOverlayPersonKey } from '../overlayPersonKey';
import { deriveAvatarShareKey, openFromFriend, sealForFriend, shareAad } from './crypto';
import { initReactiveImageGc } from './imageGc';
import { buildReactivePack, parseReactivePack, sha256Hex, SHARED_PACK_MAX_BYTES } from './pack';

/**
 * Cat Lab — exchanges reactive avatar packs with the other people in a call,
 * peer to peer over the call's LiveKit room. Nothing is stored on any server:
 * the media server only relays the bytes.
 *
 * Control messages (topic CONTROL_TOPIC, reliable data packets):
 *   hello   { cid, rx, pub }  who I am (central id, if any), whether I receive,
 *                             and my public pack hash if I share with everyone
 *   offer   { from, to, kv, s }  friends only: my pack hash sealed with our DM key
 *   request { hash, mode }    please send me that pack
 * Packs travel as a byte stream on PACK_TOPIC to the requester only; friend
 * packs are sealed with the DM-derived key, public ones are verified by hash.
 */
const CONTROL_TOPIC = 'catrealm.reactive-avatar.v1';
const PACK_TOPIC = 'catrealm.reactive-avatar.v1.pack';
const PROTOCOL_VERSION = 1;
const MAX_CONTROL_BYTES = 4096;
const SEAL_OVERHEAD_BYTES = 64;
const REQUEST_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 4;
const DOWNLOAD_TIMEOUT_MS = 90_000;

type Peer = { cid: string | null; rx: boolean; pub: string | null };
type FriendKey = { key: CryptoKey; keyVersion: number };
type MyPack = { bytes: Uint8Array; hash: string } | null;

type RoomBinding = {
  room: Room;
  peers: Map<string, Peer>;
  helloSentTo: Set<string>;
  pendingDownloads: Map<string, { hash: string; mode: 'friend' | 'public'; cid: string | null; timer: number }>;
  requestLog: Map<string, number[]>;
  dispose: () => void;
};

let initialized = false;
let binding: RoomBinding | null = null;
let myPackPromise: Promise<MyPack> | null = null;
let myPackStamp = -1;
const friendKeyCache = new Map<string, Promise<FriendKey | null>>();

// ── Identity, friendship and keys ────────────────────────────────────────────

function myCentralId(): string | null {
  const user = useAuthStore.getState().user;
  return user?.accountType === 'central' ? user.id : null;
}

function isReceiving(): boolean {
  const s = useSettingsStore.getState();
  return s.obsOverlayEnabled && s.obsOverlayReactiveAvatars;
}

function isFriend(centralId: string): boolean {
  if (useBlockedUsersStore.getState().isBlocked(centralId)) return false;
  return useFriendStore.getState().friends.some((f) => f.id === centralId);
}

function conversationIdFor(centralId: string): string | null {
  return useDMStore.getState().conversations.find((c) => c.otherUserId === centralId)?.id ?? null;
}

/**
 * Key for a friend we already share a DM key with. Never creates a DM key:
 * friends who have never DMed are treated as strangers.
 */
function friendKey(centralId: string, keyVersion?: number): Promise<FriendKey | null> {
  const cacheKey = `${centralId}:${keyVersion ?? 'active'}`;
  const cached = friendKeyCache.get(cacheKey);
  if (cached) return cached;
  const promise = (async () => {
    const conversationId = conversationIdFor(centralId);
    if (!conversationId) return null;
    let version = keyVersion;
    if (version === undefined) {
      const manifest = await fetchDMKeyManifest(conversationId);
      if (manifest.activeKeyVersion == null) return null;
      version = manifest.activeKeyVersion;
    }
    const secret = await loadConversationSecretForCurrentDevice(conversationId, version);
    if (!secret) return null;
    return { key: await deriveAvatarShareKey(secret, conversationId), keyVersion: version };
  })().catch(() => null);
  friendKeyCache.set(cacheKey, promise);
  return promise;
}

// ── My pack ──────────────────────────────────────────────────────────────────

/** Builds (and caches) my pack bytes; null if empty or too big to share. */
function getMyPack(): Promise<MyPack> {
  const { myPack } = useReactiveAvatarStore.getState();
  if (myPackPromise && myPackStamp === myPack.updatedAt) return myPackPromise;
  myPackStamp = myPack.updatedAt;
  myPackPromise = (async () => {
    if (Object.keys(myPack.images).length === 0 || !window.electron?.reactiveAvatarReadImage) return null;
    const images: Partial<Record<ReactiveAvatarState, Uint8Array>> = {};
    for (const state of REACTIVE_AVATAR_STATES) {
      const original = myPack.images[state];
      const id = original ? myPack.shareCopies[original] ?? original : undefined;
      if (!id) continue;
      const result = await window.electron.reactiveAvatarReadImage(id);
      if (result.ok) images[state] = result.bytes;
    }
    const bytes = buildReactivePack(myPack.motion, images);
    if (bytes.byteLength > SHARED_PACK_MAX_BYTES) return null;
    return { bytes, hash: await sha256Hex(bytes) };
  })().catch(() => null);
  return myPackPromise;
}

/** Size of my pack as it would be shared, for the Appearance status line. */
export async function getMySharedPackSize(): Promise<{ bytes: number; shareable: boolean } | null> {
  const { myPack } = useReactiveAvatarStore.getState();
  if (Object.keys(myPack.images).length === 0) return null;
  const pack = await getMyPack();
  if (pack) return { bytes: pack.bytes.byteLength, shareable: true };
  let total = 0;
  for (const original of Object.values(myPack.images)) {
    const id = original ? myPack.shareCopies[original] ?? original : undefined;
    const result = id ? await window.electron?.reactiveAvatarReadImage?.(id) : null;
    if (result?.ok) total += result.bytes.byteLength;
  }
  return { bytes: total, shareable: false };
}

// ── Messaging ────────────────────────────────────────────────────────────────

function send(room: Room, message: Record<string, unknown>, to?: string) {
  const payload = new TextEncoder().encode(JSON.stringify({ ...message, v: PROTOCOL_VERSION }));
  void room.localParticipant.publishData(payload, {
    reliable: true,
    topic: CONTROL_TOPIC,
    destinationIdentities: to ? [to] : undefined,
  }).catch(() => {});
}

async function sendHello(b: RoomBinding, to?: string) {
  const shareMode = useReactiveShareStore.getState().shareMode;
  const pack = shareMode === 'everyone' ? await getMyPack() : null;
  send(b.room, { t: 'hello', cid: myCentralId(), rx: isReceiving(), pub: pack?.hash ?? null }, to);
  if (to) b.helloSentTo.add(to);
  else b.room.remoteParticipants.forEach((p) => b.helloSentTo.add(p.identity));
}

async function sendOfferIfFriend(b: RoomBinding, identity: string) {
  const me = myCentralId();
  const peer = b.peers.get(identity);
  if (!me || !peer?.rx || !peer.cid || useReactiveShareStore.getState().shareMode === 'off') return;
  if (!isFriend(peer.cid)) return;
  const [pack, key] = await Promise.all([getMyPack(), friendKey(peer.cid)]);
  if (!pack || !key || binding !== b) return;
  const sealed = await sealForFriend(key.key, new TextEncoder().encode(pack.hash), shareAad('offer', me, peer.cid, ''));
  send(b.room, { t: 'offer', from: me, to: peer.cid, kv: key.keyVersion, s: bytesToBase64(sealed) }, identity);
}

function personKeyFor(identity: string): string {
  const session = useMediaStore.getState().activeSession;
  return getOverlayPersonKey(identity, session?.context === 'voice' ? useVoiceStore.getState().voiceServerUrl : null);
}

function requestPack(b: RoomBinding, identity: string, hash: string, mode: 'friend' | 'public', cid: string | null) {
  if (b.pendingDownloads.has(identity)) return;
  const personKey = personKeyFor(identity);
  const share = useReactiveShareStore.getState();
  const offer = share.offered[personKey];
  if (offer) share.setOffered(personKey, { ...offer, status: 'downloading' });
  const timer = window.setTimeout(() => {
    b.pendingDownloads.delete(identity);
    const current = useReactiveShareStore.getState().offered[personKey];
    if (current?.status === 'downloading') useReactiveShareStore.getState().setOffered(personKey, { ...current, status: 'failed' });
  }, DOWNLOAD_TIMEOUT_MS);
  b.pendingDownloads.set(identity, { hash, mode, cid, timer });
  send(b.room, { t: 'request', hash, mode }, identity);
}

/** UI entry point: fetch a stranger's pack (on preview / allow). */
export function requestOfferedPack(personKey: string) {
  const b = binding;
  const offer = useReactiveShareStore.getState().offered[personKey];
  if (!b || !offer || offer.status === 'ready' || offer.status === 'downloading') return;
  if (useReactiveShareStore.getState().received[offer.hash]) {
    useReactiveShareStore.getState().setOffered(personKey, { ...offer, status: 'ready' });
    return;
  }
  requestPack(b, offer.identity, offer.hash, offer.kind, offer.centralId);
}

function recordOffer(b: RoomBinding, identity: string, hash: string, kind: 'friend' | 'public', cid: string | null) {
  const share = useReactiveShareStore.getState();
  const personKey = personKeyFor(identity);
  const existing = share.offered[personKey];
  // A verified friend offer always wins over the unverified public one.
  if (existing?.kind === 'friend' && kind === 'public') return;
  const cached = !!share.received[hash];
  const offer = { identity, hash, kind, centralId: cid, status: cached ? 'ready' as const : 'available' as const };
  share.setOffered(personKey, offer);
  // Friends download straight away (unless blocked); strangers only once allowed.
  if (!cached && isOfferShown(personKey, offer, share.approvals)) requestPack(b, identity, hash, kind, cid);
}

async function handleControl(b: RoomBinding, identity: string, payload: Uint8Array) {
  if (payload.byteLength > MAX_CONTROL_BYTES) return;
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return;
  }
  if (!msg || msg.v !== PROTOCOL_VERSION) return;
  const me = myCentralId();

  if (msg.t === 'hello') {
    const peer: Peer = {
      cid: typeof msg.cid === 'string' ? msg.cid : null,
      rx: msg.rx === true,
      pub: typeof msg.pub === 'string' && /^[0-9a-f]{64}$/.test(msg.pub) ? msg.pub : null,
    };
    b.peers.set(identity, peer);
    if (!b.helloSentTo.has(identity)) void sendHello(b, identity);
    if (isReceiving() && peer.pub) recordOffer(b, identity, peer.pub, 'public', peer.cid);
    if (isReceiving() && !peer.pub) {
      const personKey = personKeyFor(identity);
      if (useReactiveShareStore.getState().offered[personKey]?.kind === 'public') useReactiveShareStore.getState().setOffered(personKey, null);
    }
    void sendOfferIfFriend(b, identity);
    return;
  }

  if (msg.t === 'offer') {
    if (!isReceiving() || !me || msg.to !== me || typeof msg.from !== 'string' || typeof msg.s !== 'string' || typeof msg.kv !== 'number') return;
    if (b.peers.get(identity)?.cid !== msg.from || !isFriend(msg.from)) return;
    const key = await friendKey(msg.from, msg.kv);
    if (!key) return;
    const opened = await openFromFriend(key.key, base64ToBytes(msg.s), shareAad('offer', msg.from, me, ''));
    const hash = opened ? new TextDecoder().decode(opened) : '';
    if (!/^[0-9a-f]{64}$/.test(hash) || binding !== b) return;
    recordOffer(b, identity, hash, 'friend', msg.from);
    return;
  }

  if (msg.t === 'request') {
    if (typeof msg.hash !== 'string' || (msg.mode !== 'friend' && msg.mode !== 'public')) return;
    const now = Date.now();
    const recent = (b.requestLog.get(identity) ?? []).filter((t) => now - t < REQUEST_WINDOW_MS);
    if (recent.length >= MAX_REQUESTS_PER_WINDOW) return;
    b.requestLog.set(identity, [...recent, now]);
    void sendPack(b, identity, msg.hash, msg.mode);
  }
}

async function sendPack(b: RoomBinding, identity: string, hash: string, mode: 'friend' | 'public') {
  const shareMode = useReactiveShareStore.getState().shareMode;
  const pack = await getMyPack();
  if (!pack || pack.hash !== hash || shareMode === 'off') return;
  let bytes = pack.bytes;
  const attributes: Record<string, string> = { hash, mode };
  if (mode === 'friend') {
    const me = myCentralId();
    const peerCid = b.peers.get(identity)?.cid;
    if (!me || !peerCid || !isFriend(peerCid)) return;
    const key = await friendKey(peerCid);
    if (!key) return;
    bytes = await sealForFriend(key.key, pack.bytes, shareAad('pack', me, peerCid, hash));
    attributes.kv = String(key.keyVersion);
  } else if (shareMode !== 'everyone') {
    return;
  }
  if (binding !== b) return;
  const writer = await b.room.localParticipant.streamBytes({
    topic: PACK_TOPIC,
    destinationIdentities: [identity],
    attributes,
    mimeType: 'application/octet-stream',
    totalSize: bytes.byteLength,
  });
  const CHUNK = 64 * 1024;
  for (let i = 0; i < bytes.byteLength; i += CHUNK) await writer.write(bytes.subarray(i, i + CHUNK));
  await writer.close();
}

async function handlePackStream(b: RoomBinding, reader: ByteStreamReader, identity: string) {
  const pending = b.pendingDownloads.get(identity);
  const attrs = reader.info.attributes ?? {};
  // Only accept what we asked this participant for.
  if (!pending || attrs.hash !== pending.hash || attrs.mode !== pending.mode) return;
  const limit = SHARED_PACK_MAX_BYTES + SEAL_OVERHEAD_BYTES;
  if ((reader.info.size ?? 0) > limit) return;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of reader) {
    total += chunk.byteLength;
    if (total > limit) return;
    chunks.push(chunk);
  }
  window.clearTimeout(pending.timer);
  b.pendingDownloads.delete(identity);
  const personKey = personKeyFor(identity);
  const fail = () => {
    const current = useReactiveShareStore.getState().offered[personKey];
    if (current) useReactiveShareStore.getState().setOffered(personKey, { ...current, status: 'failed' });
  };

  let bytes: Uint8Array = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (pending.mode === 'friend') {
    const me = myCentralId();
    const keyVersion = Number(attrs.kv);
    if (!me || !pending.cid || !Number.isSafeInteger(keyVersion)) return fail();
    const key = await friendKey(pending.cid, keyVersion);
    const opened = key ? await openFromFriend(key.key, bytes, shareAad('pack', pending.cid, me, pending.hash)) : null;
    if (!opened) return fail();
    bytes = opened;
  }
  if ((await sha256Hex(bytes)) !== pending.hash) return fail();
  const parsed = parseReactivePack(bytes);
  if (!parsed || !window.electron?.reactiveAvatarSaveImage) return fail();

  const images: Partial<Record<ReactiveAvatarState, string>> = {};
  for (const [state, data] of Object.entries(parsed.images)) {
    const saved = await window.electron.reactiveAvatarSaveImage(data, { received: true });
    if (!saved.ok) return fail();
    images[state as ReactiveAvatarState] = saved.id;
  }
  useReactiveShareStore.getState().addReceived(pending.hash, { motion: parsed.motion, images, receivedAt: Date.now() });
  const current = useReactiveShareStore.getState().offered[personKey];
  if (current?.hash === pending.hash) useReactiveShareStore.getState().setOffered(personKey, { ...current, status: 'ready' });
}

// ── Room lifecycle ───────────────────────────────────────────────────────────

function bindRoom(room: Room): RoomBinding {
  const b: RoomBinding = {
    room,
    peers: new Map(),
    helloSentTo: new Set(),
    pendingDownloads: new Map(),
    requestLog: new Map(),
    dispose: () => {},
  };
  const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
    if (topic !== CONTROL_TOPIC || !participant?.identity) return;
    void handleControl(b, participant.identity, payload);
  };
  const onJoined = (participant: RemoteParticipant) => void sendHello(b, participant.identity);
  const onLeft = (participant: RemoteParticipant) => {
    b.peers.delete(participant.identity);
    b.helloSentTo.delete(participant.identity);
    const personKey = personKeyFor(participant.identity);
    if (useReactiveShareStore.getState().offered[personKey]) useReactiveShareStore.getState().setOffered(personKey, null);
  };
  room.on(RoomEvent.DataReceived, onData);
  room.on(RoomEvent.ParticipantConnected, onJoined);
  room.on(RoomEvent.ParticipantDisconnected, onLeft);
  try {
    room.registerByteStreamHandler(PACK_TOPIC, (reader, info) => {
      void handlePackStream(b, reader, info.identity).catch(() => {});
    });
  } catch {
    // Already registered for this room (re-bind after a reconnect).
  }
  b.dispose = () => {
    room.off(RoomEvent.DataReceived, onData);
    room.off(RoomEvent.ParticipantConnected, onJoined);
    room.off(RoomEvent.ParticipantDisconnected, onLeft);
    try {
      room.unregisterByteStreamHandler(PACK_TOPIC);
    } catch {
      // Room already torn down.
    }
    b.pendingDownloads.forEach((d) => window.clearTimeout(d.timer));
  };
  void sendHello(b);
  return b;
}

function reconcileRoom() {
  const session = useMediaStore.getState().activeSession;
  const room = session && !session.isNativeVoice && session.context !== 'theater' ? session.room : null;
  if (binding?.room === room) return;
  binding?.dispose();
  binding = null;
  useReactiveShareStore.getState().clearOffered();
  if (room) binding = bindRoom(room);
}

/** Re-announce after something that changes what we share or receive. */
function reannounce() {
  const b = binding;
  if (!b) return;
  void sendHello(b);
  b.peers.forEach((_peer, identity) => void sendOfferIfFriend(b, identity));
}

export function initReactiveAvatarExchange() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  initReactiveImageGc();

  useMediaStore.subscribe((state, prev) => {
    if (state.activeSession !== prev.activeSession) reconcileRoom();
  });
  useReactiveAvatarStore.subscribe((state, prev) => {
    if (state.myPack !== prev.myPack) reannounce();
  });
  useReactiveShareStore.subscribe((state, prev) => {
    if (state.shareMode !== prev.shareMode) reannounce();
    // Allowing someone (from the badge) fetches their pack if we haven't got it.
    if (state.approvals !== prev.approvals) {
      for (const [personKey, offer] of Object.entries(state.offered)) {
        if (offer.status === 'available' && isOfferShown(personKey, offer, state.approvals)) requestOfferedPack(personKey);
      }
    }
  });
  let receiving = isReceiving();
  useSettingsStore.subscribe(() => {
    if (isReceiving() === receiving) return;
    receiving = isReceiving();
    if (!receiving) useReactiveShareStore.getState().clearOffered();
    reannounce();
  });
  reconcileRoom();
}

