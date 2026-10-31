export type RtcE2eeScope = 'voice' | 'call';

export type RtcE2eeStatus =
  | 'disabled'
  | 'unsupported'
  | 'pending'
  | 'active'
  | 'repairing'
  | 'downgraded'
  | 'failed';

export type RtcE2eeSignal = {
  sessionId: string;
  pub: string;
  version: 2;
};

type SessionRecord = {
  sessionId: string;
  scope: RtcE2eeScope;
  contextId: string;
  peerId: string;
  localKeyPair: CryptoKeyPair | null;
  localPub: string | null;
  remotePub: string | null;
  keys: { sendKey: CryptoKey; recvKey: CryptoKey } | null;
  senderWrapped: Set<string>;
  receiverWrapped: Set<string>;
  decryptFailureCount: number;
  decryptFailureTriggered: boolean;
};

const sessions = new Map<string, SessionRecord>();

function getSessionMapKey(scope: RtcE2eeScope, contextId: string, peerId: string) {
  return `${scope}:${contextId}:${peerId}`;
}

function getOrCreateSession(scope: RtcE2eeScope, contextId: string, peerId: string, sessionId: string): SessionRecord {
  const mapKey = getSessionMapKey(scope, contextId, peerId);
  const existing = sessions.get(mapKey);
  if (existing && existing.sessionId === sessionId) {
    return existing;
  }
  const next: SessionRecord = {
    sessionId,
    scope,
    contextId,
    peerId,
    localKeyPair: null,
    localPub: null,
    remotePub: null,
    keys: null,
    senderWrapped: new Set<string>(),
    receiverWrapped: new Set<string>(),
    decryptFailureCount: 0,
    decryptFailureTriggered: false,
  };
  sessions.set(mapKey, next);
  return next;
}

function getSession(scope: RtcE2eeScope, contextId: string, peerId: string, sessionId: string): SessionRecord | null {
  const existing = sessions.get(getSessionMapKey(scope, contextId, peerId));
  if (!existing || existing.sessionId !== sessionId) return null;
  return existing;
}

export function isRtcE2eeSupported() {
  return (
    typeof RTCRtpSender !== 'undefined' &&
    typeof RTCRtpReceiver !== 'undefined' &&
    'createEncodedStreams' in RTCRtpSender.prototype &&
    'createEncodedStreams' in RTCRtpReceiver.prototype
  );
}

export function beginRtcE2eeSession(scope: RtcE2eeScope, contextId: string, peerId: string, sessionId: string) {
  getOrCreateSession(scope, contextId, peerId, sessionId);
}

export function clearRtcE2eeSession(scope: RtcE2eeScope, contextId: string, peerId: string) {
  sessions.delete(getSessionMapKey(scope, contextId, peerId));
}

export function clearRtcE2eeSessionsForContext(scope: RtcE2eeScope, contextId: string) {
  const prefix = `${scope}:${contextId}:`;
  for (const key of sessions.keys()) {
    if (key.startsWith(prefix)) {
      sessions.delete(key);
    }
  }
}

export async function getRtcE2eeLocalSignal(
  scope: RtcE2eeScope,
  contextId: string,
  peerId: string,
  sessionId: string,
): Promise<RtcE2eeSignal | null> {
  if (!isRtcE2eeSupported()) return null;
  const session = getOrCreateSession(scope, contextId, peerId, sessionId);
  if (!session.localKeyPair) {
    session.localKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits'],
    );
    session.localPub = await exportKey(session.localKeyPair.publicKey);
  }
  if (!session.localPub) return null;
  return {
    sessionId,
    pub: session.localPub,
    version: 2,
  };
}

export async function acceptRtcE2eeRemoteSignal(
  scope: RtcE2eeScope,
  contextId: string,
  peerId: string,
  sessionId: string,
  signal: RtcE2eeSignal,
  localUserId: string,
  remoteUserId: string,
): Promise<boolean> {
  if (!isRtcE2eeSupported()) return false;
  const session = getOrCreateSession(scope, contextId, peerId, sessionId);
  if (!session.localKeyPair) {
    session.localKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits'],
    );
    session.localPub = await exportKey(session.localKeyPair.publicKey);
  }
  session.remotePub = signal.pub;
  const publicKey = await importKey(signal.pub);
  session.keys = {
    sendKey: await deriveAesKey(
      session.localKeyPair.privateKey,
      publicKey,
      `catrealm-e2ee:v2:${scope}:${contextId}:${sessionId}:send:${localUserId}:${remoteUserId}`,
    ),
    recvKey: await deriveAesKey(
      session.localKeyPair.privateKey,
      publicKey,
      `catrealm-e2ee:v2:${scope}:${contextId}:${sessionId}:send:${remoteUserId}:${localUserId}`,
    ),
  };
  return true;
}

export function hasRtcE2eeKeys(scope: RtcE2eeScope, contextId: string, peerId: string, sessionId: string) {
  return !!getSession(scope, contextId, peerId, sessionId)?.keys;
}

export function applyRtcE2eeToPeerConnection(
  scope: RtcE2eeScope,
  contextId: string,
  peerId: string,
  sessionId: string,
  pc: RTCPeerConnection,
  onDecryptFailure?: () => void,
) {
  const session = getSession(scope, contextId, peerId, sessionId);
  if (!session?.keys) return false;

  let applied = false;

  pc.getSenders().forEach((sender) => {
    const trackId = sender.track?.id;
    if (!trackId || typeof sender.createEncodedStreams !== 'function' || session.senderWrapped.has(trackId)) return;
    session.senderWrapped.add(trackId);
    const { readable, writable } = sender.createEncodedStreams();
    readable
      .pipeThrough(new TransformStream({
        async transform(encodedFrame, controller) {
          try {
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const data = new Uint8Array(encodedFrame.data);
            const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, session.keys!.sendKey, data);
            const out = new Uint8Array(iv.byteLength + cipher.byteLength);
            out.set(iv, 0);
            out.set(new Uint8Array(cipher), iv.byteLength);
            encodedFrame.data = out.buffer;
            controller.enqueue(encodedFrame);
          } catch {
            controller.enqueue(encodedFrame);
          }
        },
      }))
      .pipeTo(writable)
      .catch(() => {});
    applied = true;
  });

  pc.getReceivers().forEach((receiver) => {
    const trackId = receiver.track?.id;
    if (!trackId || typeof receiver.createEncodedStreams !== 'function' || session.receiverWrapped.has(trackId)) return;
    session.receiverWrapped.add(trackId);
    const { readable, writable } = receiver.createEncodedStreams();
    readable
      .pipeThrough(new TransformStream({
        async transform(encodedFrame, controller) {
          try {
            const data = new Uint8Array(encodedFrame.data);
            if (data.byteLength < 13) return;
            const iv = data.slice(0, 12);
            const cipher = data.slice(12);
            const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, session.keys!.recvKey, cipher);
            encodedFrame.data = plain;
            controller.enqueue(encodedFrame);
          } catch {
            session.decryptFailureCount += 1;
            if (!session.decryptFailureTriggered && session.decryptFailureCount >= 8) {
              session.decryptFailureTriggered = true;
              queueMicrotask(() => {
                onDecryptFailure?.();
              });
            }
          }
        },
      }))
      .pipeTo(writable)
      .catch(() => {});
    applied = true;
  });

  return applied;
}

async function exportKey(key: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', key);
  return btoa(String.fromCharCode(...new Uint8Array(spki)));
}

async function importKey(spkiB64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(spkiB64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'spki',
    raw.buffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
}

async function deriveAesKey(privateKey: CryptoKey, publicKey: CryptoKey, info: string) {
  const bits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  );
  const keyMaterial = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('catrealm-e2ee-v2'),
      info: new TextEncoder().encode(info),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
