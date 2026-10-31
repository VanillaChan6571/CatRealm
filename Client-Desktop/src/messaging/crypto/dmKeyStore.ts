import { create } from 'zustand';
import { x25519 } from '@noble/curves/ed25519.js';
import { createAuthenticatedApi } from '../../lib/authApi';
import { getLocalDeviceId, getLocalDmPrivateKey } from '../../lib/deviceIdentity';
import { getAllConversations } from '../persistence/dmStorage';

import { bytesToBase64, base64ToBytes } from './base64';
import { logDMKeyDebug, logDMKeyError } from './dmKeyDebug';

const STORAGE_PREFIX = 'catrealm.dm-conversation-secret.';
const RECENT_DEVICE_TRUST_MS = 24 * 60 * 60 * 1000;

// Surfaces silent key-upload failures: when this device holds a conversation
// secret but the server demands a fresh passkey/platform proof before it may
// share it, the user must be told — otherwise their other devices stay locked
// with no visible reason (30-day DM key-sharing proof window server-side).
type DMKeyHealthState = {
  proofRequired: boolean;
  setProofRequired: (proofRequired: boolean) => void;
  updatedConversations: Record<string, number>;
  markConversationKeysUpdated: (conversationId: string) => void;
  accountId: string | null;
  recentPasskeyApprovedDeviceId: string | null;
  reverifyForPasskeyApprovedDeviceId: string | null;
  setAccountId: (accountId: string) => void;
  notePasskeyApprovedDevice: (deviceId: string) => void;
  markProofRequiredForTargets: (deviceIds: string[]) => void;
  clearProofRequiredForTargets: (deviceIds: string[]) => void;
};
export const useDMKeyHealthStore = create<DMKeyHealthState>((set) => ({
  proofRequired: false,
  setProofRequired: (proofRequired) => set({ proofRequired }),
  updatedConversations: {},
  markConversationKeysUpdated: (conversationId) => set((state) => ({
    updatedConversations: {
      ...state.updatedConversations,
      [conversationId]: (state.updatedConversations[conversationId] ?? 0) + 1,
    },
  })),
  accountId: null,
  recentPasskeyApprovedDeviceId: null,
  reverifyForPasskeyApprovedDeviceId: null,
  setAccountId: (accountId) => set((state) => state.accountId === accountId ? state : {
    accountId,
    proofRequired: false,
    recentPasskeyApprovedDeviceId: null,
    reverifyForPasskeyApprovedDeviceId: null,
    updatedConversations: {},
  }),
  notePasskeyApprovedDevice: (deviceId) => set({ recentPasskeyApprovedDeviceId: deviceId }),
  markProofRequiredForTargets: (deviceIds) => set((state) => (
    state.recentPasskeyApprovedDeviceId && deviceIds.includes(state.recentPasskeyApprovedDeviceId)
      ? { reverifyForPasskeyApprovedDeviceId: state.recentPasskeyApprovedDeviceId }
      : state
  )),
  clearProofRequiredForTargets: (deviceIds) => set((state) => (
    state.reverifyForPasskeyApprovedDeviceId && deviceIds.includes(state.reverifyForPasskeyApprovedDeviceId)
      ? { reverifyForPasskeyApprovedDeviceId: null, recentPasskeyApprovedDeviceId: null }
      : state
  )),
}));

function isProofRequiredError(err: unknown): boolean {
  return Boolean((err as { response?: { data?: { proofRequired?: boolean } } })?.response?.data?.proofRequired);
}
async function deriveWrapKey(sharedSecret: Uint8Array, conversationId: string, keyVersion: number) {
  const material = await crypto.subtle.importKey('raw', sharedSecret as BufferSource, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new TextEncoder().encode(conversationId),
    info: new TextEncoder().encode(`catrealm:dm-wrap:v1:${keyVersion}`),
  }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export type DMKeyManifest = {
  conversationId: string;
  participantUserIds?: string[];
  activeKeyVersion: number | null;
  upgradedAt: number | null;
  messageCount: number;
  devices: Array<{ id: string; userId: string; deviceName: string; platform: string; dmPublicKey: string | null; notificationPublicKey: string | null; pushCapable: boolean; dmTrustState: string; trustedAt?: number | null; trustedByDeviceId?: string | null; keyShareBlocked?: boolean; hasWrappedKeyVersions: number[] }>;
};

export type DMKeyRecoveryRequest = {
  id: string;
  conversationId: string;
  keyVersion: number;
  requesterUserId: string;
  requesterDeviceId: string;
  approverUserId: string;
  status: 'pending' | 'reviewing' | 'approved' | 'completed' | 'denied' | 'cancelled';
  mode?: 'key-copy' | 'survivor-trust';
  survivorProofReady?: boolean;
  requestedAt: number;
  reviewUntil: number | null;
  expiresAt: number;
};

export function canRequestPeerKeyRecovery(manifest: DMKeyManifest, userId: string, deviceId: string): boolean {
  if (manifest.activeKeyVersion == null) return false;
  const version = manifest.activeKeyVersion;
  return manifest.devices.some((device) => device.id === deviceId && device.userId === userId && device.dmTrustState === 'trusted' && Boolean(device.dmPublicKey) && !device.hasWrappedKeyVersions.includes(version))
    && manifest.devices.some((device) => device.userId !== userId && device.dmTrustState === 'trusted' && device.hasWrappedKeyVersions.includes(version));
}

// True when every device holding the active key is a hardened device whose
// passkey proof has lapsed — i.e. this conversation cannot unlock until one
// of them is re-trusted (or re-proves), no matter how long we wait.
export function areAllKeyHoldersBlocked(manifest: DMKeyManifest): boolean {
  if (manifest.activeKeyVersion == null) return false;
  const holders = manifest.devices.filter((device) => device.hasWrappedKeyVersions.includes(manifest.activeKeyVersion!));
  return holders.length > 0 && holders.every((device) => device.keyShareBlocked === true);
}

export function needsProofToShareDMKey(manifest: DMKeyManifest, deviceId: string): boolean {
  const keyVersion = manifest.activeKeyVersion;
  if (keyVersion == null) return false;
  const localDevice = manifest.devices.find((device) => device.id === deviceId);
  if (!localDevice?.keyShareBlocked || !localDevice.hasWrappedKeyVersions.includes(keyVersion)) return false;
  return manifest.devices.some((device) =>
    device.userId === localDevice.userId
    &&
    device.dmTrustState === 'trusted'
    && Boolean(device.dmPublicKey)
    && !device.hasWrappedKeyVersions.includes(keyVersion)
  );
}

// Encryption state of a conversation from THIS device's point of view:
// - 'pending': still on v1 — the conversation has no active key yet (e.g. the
//   other participant hasn't set up a key-bearing device, so v2 can't activate).
// - 'synced': v2 is active and this device holds a wrapped key for it.
// - 'locked': v2 is active but this device has no key for it (needs approval /
//   a backfill from another device that holds the secret).
export type DMEncryptionState = 'pending' | 'synced' | 'locked';

export function deriveDMEncryptionState(manifest: DMKeyManifest, deviceId: string): DMEncryptionState {
  if (manifest.activeKeyVersion == null) return 'pending';
  const device = manifest.devices.find((entry) => entry.id === deviceId);
  if (device && device.hasWrappedKeyVersions.includes(manifest.activeKeyVersion)) return 'synced';
  return 'locked';
}

function isParticipantUnreadyError(err: unknown): boolean {
  const response = (err as { response?: { status?: number; data?: { code?: string } } })?.response;
  return response?.status === 409 && response?.data?.code === 'DM_V2_PARTICIPANT_UNREADY';
}

export function getLocalConversationSecret(conversationId: string, keyVersion: number): string | null {
  return localStorage.getItem(`${STORAGE_PREFIX}${conversationId}.${keyVersion}`);
}
export async function createSurvivorTrustProof(request: DMKeyRecoveryRequest): Promise<string> {
  const secret = getLocalConversationSecret(request.conversationId, request.keyVersion)
    ?? await loadConversationSecretForCurrentDevice(request.conversationId, request.keyVersion);
  if (!secret) throw new Error('This device cannot read the DM key needed to verify the other device.');
  const raw = base64ToBytes(secret);
  if (raw.length !== 32) throw new Error('This device has an invalid local DM key.');
  const key = await crypto.subtle.importKey('raw', raw as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const message = new TextEncoder().encode(`catrealm:dm-survivor-trust:v1:${request.id}:${request.conversationId}:${request.keyVersion}:${request.requesterUserId}:${request.requesterDeviceId}`);
  return bytesToBase64(new Uint8Array(await crypto.subtle.sign('HMAC', key, message)));
}
function saveLocalConversationSecret(conversationId: string, keyVersion: number, secret: string) {
  localStorage.setItem(`${STORAGE_PREFIX}${conversationId}.${keyVersion}`, secret);
}

async function wrapSecretForDevice(secretBase64: string, recipientPublicKeyBase64: string, conversationId: string, keyVersion: number) {
  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const shared = x25519.getSharedSecret(ephemeralPrivateKey, base64ToBytes(recipientPublicKeyBase64));
  const key = await deriveWrapKey(shared, conversationId, keyVersion);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, base64ToBytes(secretBase64) as BufferSource);
  return JSON.stringify({ v: 1, epk: bytesToBase64(ephemeralPublicKey), iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) });
}

async function unwrapSecret(wrapped: string, conversationId: string, keyVersion: number) {
  const payload = JSON.parse(wrapped) as { v: number; epk: string; iv: string; ciphertext: string };
  if (payload.v !== 1) throw new Error('Unsupported wrapped DM key version');
  const shared = x25519.getSharedSecret(getLocalDmPrivateKey(), base64ToBytes(payload.epk));
  const key = await deriveWrapKey(shared, conversationId, keyVersion);
  const opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(payload.iv) as BufferSource }, key, base64ToBytes(payload.ciphertext) as BufferSource);
  return bytesToBase64(new Uint8Array(opened));
}

export async function fetchDMKeyManifest(conversationId: string) {
  const res = await createAuthenticatedApi().get<DMKeyManifest>(`/api/dms/conversations/${conversationId}/key-manifest`);
  const deviceId = getLocalDeviceId();
  const localDevice = res.data.devices.find((device) => device.id === deviceId);
  logDMKeyDebug('Manifest received', {
    conversationId,
    deviceId,
    activeKeyVersion: res.data.activeKeyVersion,
    localTrustState: localDevice?.dmTrustState ?? 'missing',
    localHasPublicKey: Boolean(localDevice?.dmPublicKey),
    localWrappedKeyVersions: localDevice?.hasWrappedKeyVersions ?? [],
    deviceCount: res.data.devices.length,
  });
  return res.data;
}

export async function ensureNewConversationSecret(conversationId: string): Promise<{ secret: string; keyVersion: number } | null> {
  const manifest = await fetchDMKeyManifest(conversationId);
  if (manifest.activeKeyVersion != null) return null;
  const targets = manifest.devices.filter((device) => device.dmTrustState === 'trusted' && device.dmPublicKey);
  if (targets.length === 0) return null;
  // Gate activation on the authoritative participant list. Every participant
  // must have at least one trusted, key-bearing device, otherwise a participant
  // who hasn't set up a device yet would be permanently locked out. Until both
  // sides are ready, return null so new sends remain blocked until key setup completes. (Fall back to the
  // device-derived set for older servers that don't send participantUserIds.)
  const participantUserIds = manifest.participantUserIds ?? [...new Set(manifest.devices.map((device) => device.userId))];
  const readyUserIds = new Set(targets.map((device) => device.userId));
  if (!participantUserIds.every((userId) => readyUserIds.has(userId))) return null;
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = bytesToBase64(secretBytes);
  const keyVersion = 1;
  const wrappedKeys = await Promise.all(targets.map(async (device) => ({
    deviceId: device.id,
    wrappedConversationSecret: await wrapSecretForDevice(secret, device.dmPublicKey!, conversationId, keyVersion),
  })));
  try {
    await createAuthenticatedApi().post(`/api/dms/conversations/${conversationId}/keys`, {
      sourceDeviceId: getLocalDeviceId(),
      keyVersion,
      wrappedKeys,
    });
  } catch (err) {
    // Server rejected activation because a participant isn't key-ready yet —
    // Return pending; new sends must wait for secure key setup.
    if (isParticipantUnreadyError(err)) return null;
    throw err;
  }
  saveLocalConversationSecret(conversationId, keyVersion, secret);
  return { secret, keyVersion };
}

export async function loadConversationSecretForCurrentDevice(conversationId: string, keyVersion: number): Promise<string | null> {
  const existing = getLocalConversationSecret(conversationId, keyVersion);
  if (existing) {
    return existing;
  }
  const deviceId = getLocalDeviceId();
  logDMKeyDebug('Requesting wrapped conversation key', { conversationId, keyVersion, deviceId });
  let res;
  try {
    res = await createAuthenticatedApi().get<{ keys: Array<{ keyVersion: number; wrappedConversationSecret: string }> }>(
      `/api/dms/conversations/${conversationId}/keys/me`,
      { params: { deviceId } },
    );
  } catch (error) {
    logDMKeyError('Wrapped conversation key request failed', error, { conversationId, keyVersion, deviceId });
    throw error;
  }
  logDMKeyDebug('Wrapped conversation key response received', {
    conversationId,
    keyVersion,
    deviceId,
    returnedKeyVersions: res.data.keys.map((entry) => entry.keyVersion),
  });
  const wrapped = res.data.keys.find((entry) => entry.keyVersion === keyVersion);
  if (!wrapped) {
    logDMKeyDebug('No wrapped key exists for this device', { conversationId, keyVersion, deviceId }, 'warn');
    return null;
  }
  let secret;
  try {
    secret = await unwrapSecret(wrapped.wrappedConversationSecret, conversationId, keyVersion);
  } catch (error) {
    logDMKeyError('Failed to unwrap conversation key', error, { conversationId, keyVersion, deviceId });
    throw error;
  }
  saveLocalConversationSecret(conversationId, keyVersion, secret);
  logDMKeyDebug('Conversation key unwrapped and cached', { conversationId, keyVersion, deviceId });
  void syncTrustedDeviceKeysForConversation(conversationId, keyVersion, secret).catch((error) => {
    logDMKeyError('Trusted-device key sync failed', error, { conversationId, keyVersion });
  });
  return secret;
}

async function backfillMissingTrustedDeviceKeys(manifest: DMKeyManifest, secret: string) {
  if (manifest.activeKeyVersion == null) return;
  const missing = manifest.devices.filter((device) =>
    device.dmTrustState === 'trusted'
    && device.dmPublicKey
    && !device.hasWrappedKeyVersions.includes(manifest.activeKeyVersion!)
    && device.userId === manifest.devices.find((source) => source.id === getLocalDeviceId())?.userId
  );
  if (missing.length === 0) {
    logDMKeyDebug('No trusted devices need key backfill', {
      conversationId: manifest.conversationId,
      keyVersion: manifest.activeKeyVersion,
    });
    return;
  }
  const sourceDevice = manifest.devices.find((device) => device.id === getLocalDeviceId());
  const recentlySelfApproved = missing.find((device) =>
    device.userId === sourceDevice?.userId
    && device.trustedByDeviceId === device.id
    && typeof device.trustedAt === 'number'
    && Date.now() - device.trustedAt * 1000 <= RECENT_DEVICE_TRUST_MS
  );
  if (recentlySelfApproved) {
    useDMKeyHealthStore.getState().notePasskeyApprovedDevice(recentlySelfApproved.id);
  }
  logDMKeyDebug('Preparing trusted-device key backfill', {
    conversationId: manifest.conversationId,
    keyVersion: manifest.activeKeyVersion,
    sourceDeviceId: getLocalDeviceId(),
    targetDeviceIds: missing.map((device) => device.id),
  });
  const wrappedKeys = await Promise.all(missing.map(async (device) => ({
    deviceId: device.id,
    wrappedConversationSecret: await wrapSecretForDevice(secret, device.dmPublicKey!, manifest.conversationId, manifest.activeKeyVersion!),
  })));
  try {
    await createAuthenticatedApi().post(`/api/dms/conversations/${manifest.conversationId}/keys`, {
      sourceDeviceId: getLocalDeviceId(),
      keyVersion: manifest.activeKeyVersion,
      wrappedKeys,
    });
    logDMKeyDebug('Trusted-device key backfill uploaded', {
      conversationId: manifest.conversationId,
      keyVersion: manifest.activeKeyVersion,
      targetDeviceIds: missing.map((device) => device.id),
    });
    useDMKeyHealthStore.getState().setProofRequired(false);
    useDMKeyHealthStore.getState().clearProofRequiredForTargets(missing.map((device) => device.id));
  } catch (error) {
    if (isProofRequiredError(error)) {
      useDMKeyHealthStore.getState().setProofRequired(true);
      useDMKeyHealthStore.getState().markProofRequiredForTargets(missing.map((device) => device.id));
    }
    logDMKeyError('Trusted-device key backfill upload failed', error, {
      conversationId: manifest.conversationId,
      keyVersion: manifest.activeKeyVersion,
      sourceDeviceId: getLocalDeviceId(),
      targetDeviceIds: missing.map((device) => device.id),
    });
    throw error;
  }
}

export async function syncTrustedDeviceKeysForConversation(conversationId: string, keyVersion: number, secret: string) {
  const manifest = await fetchDMKeyManifest(conversationId);
  if (manifest.activeKeyVersion !== keyVersion) return;
  await backfillMissingTrustedDeviceKeys(manifest, secret);
}

export async function shareDMKeyForRecovery(request: DMKeyRecoveryRequest) {
  const manifest = await fetchDMKeyManifest(request.conversationId);
  if (manifest.activeKeyVersion !== request.keyVersion) throw new Error('The DM key changed. Ask for recovery again.');
  const target = manifest.devices.find((device) => device.id === request.requesterDeviceId && device.userId === request.requesterUserId
    && device.dmTrustState === 'trusted' && device.dmPublicKey);
  const source = manifest.devices.find((device) => device.id === getLocalDeviceId() && device.userId === request.approverUserId
    && device.hasWrappedKeyVersions.includes(request.keyVersion));
  if (!target || !source) throw new Error('This device cannot share the requested DM key.');
  const secret = await loadConversationSecretForCurrentDevice(request.conversationId, request.keyVersion);
  if (!secret) throw new Error('This device does not have the DM key.');
  const wrappedConversationSecret = await wrapSecretForDevice(secret, target.dmPublicKey!, request.conversationId, request.keyVersion);
  await createAuthenticatedApi().post(`/api/dms/conversations/${request.conversationId}/keys`, {
    sourceDeviceId: source.id,
    keyVersion: request.keyVersion,
    recoveryRequestId: request.id,
    wrappedKeys: [{ deviceId: target.id, wrappedConversationSecret }],
  });
  useDMKeyHealthStore.getState().markConversationKeysUpdated(request.conversationId);
}

export async function syncKnownConversationKeys() {
  const conversations = await getAllConversations();
  logDMKeyDebug('Scanning known conversations for key backfill', { conversationCount: conversations.length });
  await Promise.allSettled(conversations.map(async (conversation) => {
    const manifest = await fetchDMKeyManifest(conversation.id);
    if (manifest.activeKeyVersion == null) return;
    const secret = getLocalConversationSecret(conversation.id, manifest.activeKeyVersion);
    if (!secret) return;
    await backfillMissingTrustedDeviceKeys(manifest, secret);
  }));
}

// Full self-healing pass over every known conversation: pull this device's
// wrapped key from the server if it isn't cached locally (which also backfills
// other trusted devices), and report conversations this device still can't
// unlock so the caller can ask peers for a backfill.
export async function reconcileConversationKeys(onMissingKey?: (conversationId: string) => void) {
  const conversations = await getAllConversations();
  logDMKeyDebug('Reconciling conversation keys', { conversationCount: conversations.length });
  // Sequential on purpose: every call here counts against the shared per-user
  // DM rate limit, and message loading must win that budget.
  for (const conversation of conversations) {
    try {
      const manifest = await fetchDMKeyManifest(conversation.id);
      if (manifest.activeKeyVersion == null) continue;
      const hadLocalSecret = Boolean(getLocalConversationSecret(conversation.id, manifest.activeKeyVersion));
      const secret = await loadConversationSecretForCurrentDevice(conversation.id, manifest.activeKeyVersion).catch(() => null);
      if (!secret) onMissingKey?.(conversation.id);
      else if (hadLocalSecret) await syncTrustedDeviceKeysForConversation(conversation.id, manifest.activeKeyVersion, secret);
    } catch (error) {
      logDMKeyError('Key reconciliation failed for conversation', error, { conversationId: conversation.id });
    }
  }
}

export async function getConversationSecretForSend(conversationId: string): Promise<{ secret: string; keyVersion: number } | null> {
  const manifest = await fetchDMKeyManifest(conversationId);
  if (manifest.activeKeyVersion != null) {
    const secret = await loadConversationSecretForCurrentDevice(conversationId, manifest.activeKeyVersion);
    if (!secret) throw new Error('No v2 DM key available for this device');
    await backfillMissingTrustedDeviceKeys(manifest, secret).catch(() => {});
    return { secret, keyVersion: manifest.activeKeyVersion };
  }
  return ensureNewConversationSecret(conversationId);
}
