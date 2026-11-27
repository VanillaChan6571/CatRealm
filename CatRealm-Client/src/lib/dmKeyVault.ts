import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import axios from 'axios';
import { create } from 'zustand';
import { createAuthenticatedApi } from './authApi';
import { getLocalDeviceId } from './deviceIdentity';
import { useAuthStore } from '../stores/authStore';
import { decodeToken, loadSession } from '../utils/token';

const VAULT_DB_PREFIX = 'catrealm-dm-key-vault-';
const LEGACY_PREFIX = 'catrealm.dm-conversation-secret.';
const LEGACY_OWNER = 'catrealm.dm-conversation-secret-owner';
const LEGACY_DEVICE = 'catrealm.dm-conversation-secret-device';
const SCHEMA = 1;
const encoder = new TextEncoder();

type VaultMeta = {
  schema: number;
  userId: string;
  deviceId: string;
  vaultId: string;
  secretId: string;
  deviceKey: CryptoKey;
};
type EncryptedRecord = {
  key: string;
  conversationId: string;
  keyVersion: number;
  innerIv: Uint8Array;
  outerIv: Uint8Array;
  ciphertext: ArrayBuffer;
};
interface VaultDB extends DBSchema {
  metadata: { key: string; value: VaultMeta };
  secrets: { key: string; value: EncryptedRecord };
}
type OpenVault = {
  db: IDBPDatabase<VaultDB>;
  meta: VaultMeta;
  accountKey: CryptoKey;
  cache: Map<string, string>;
  userId: string;
  deviceId: string;
  sessionId: string;
  generation: number;
};
type VaultOwner = { userId: string; deviceId: string; sessionId: string };

type VaultIssue = 'storage' | 'vault' | 'conflict' | 'legacy' | null;
type VaultStatus = { cannotSave: boolean; reason: string | null; issue: VaultIssue };
class VaultKeyConflictError extends Error {}
function keyConflict() {
  warn('A different DM key already exists for this conversation version. The stored key was kept for recovery.', 'conflict');
  return new VaultKeyConflictError('DM key version already has a different secret');
}
export const useDMVaultStatus = create<VaultStatus>(() => ({ cannotSave: false, reason: null, issue: null }));
function warn(reason: string, issue: Exclude<VaultIssue, null> = 'storage') {
  if (issue === 'legacy' && useDMVaultStatus.getState().cannotSave) return;
  useDMVaultStatus.setState({ cannotSave: issue !== 'legacy', reason, issue });
}
function clearWarning() {
  useDMVaultStatus.setState({ cannotSave: false, reason: null, issue: null });
}

let generation = 0;
let current: OpenVault | null = null;
let opening: Promise<OpenVault | null> | null = null;
let openingOwner: VaultOwner | null = null;
const volatile = new Map<string, string>();
let volatileOwner: VaultOwner | null = null;
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('catrealm-dm-key-vault') : null;

const entryKey = (conversationId: string, keyVersion: number) => `${conversationId}.${keyVersion}`;
const databaseName = (userId: string, deviceId: string) => `${VAULT_DB_PREFIX}${userId}-${deviceId}`;
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
function fromB64(value: string): Uint8Array {
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
function context() {
  const { user, token } = useAuthStore.getState();
  if (user?.accountType !== 'central' || !token) return null;
  const deviceId = getLocalDeviceId();
  const activeToken = decodeToken(token);
  const saved = loadSession();
  const savedToken = saved?.token ? decodeToken(saved.token) : null;
  if (activeToken?.type !== 'central' || activeToken.sub !== user.id || activeToken.did !== deviceId
    || typeof activeToken.sid !== 'string' || !activeToken.sid
    || saved?.user?.id !== user.id || savedToken?.sid !== activeToken.sid
    || savedToken?.did !== deviceId) return null;
  return { userId: user.id, deviceId, sessionId: activeToken.sid };
}
function stillCurrent(userId: string, deviceId: string, sessionId: string, expectedGeneration: number) {
  const now = context();
  return generation === expectedGeneration && now?.userId === userId && now.deviceId === deviceId && now.sessionId === sessionId;
}
function additionalData(meta: VaultMeta, conversationId: string, keyVersion: number, layer: string) {
  return encoder.encode(JSON.stringify([SCHEMA, meta.userId, meta.deviceId, meta.vaultId, conversationId, keyVersion, layer]));
}
function randomIv() { return crypto.getRandomValues(new Uint8Array(12)); }
async function openDatabase(userId: string, deviceId: string) {
  return openDB<VaultDB>(databaseName(userId, deviceId), 1, {
    upgrade(db) {
      db.createObjectStore('metadata');
      db.createObjectStore('secrets', { keyPath: 'key' });
    },
  });
}
function isMissingSecret(error: unknown) {
  return axios.isAxiosError(error) && error.response?.data?.code === 'VAULT_SECRET_MISSING';
}
async function fetchSecret(owner: VaultOwner, expectedGeneration: number, hasMeta: boolean) {
  const { userId, deviceId, sessionId } = owner;
  const path = `/api/devices/${encodeURIComponent(deviceId)}/vault-secret`;
  const api = createAuthenticatedApi();
  try {
    const response = await api.get<{ secret: string; secretId: string }>(path);
    return response.data;
  } catch (error) {
    if (!isMissingSecret(error) || hasMeta) throw error;
    if (!stillCurrent(userId, deviceId, sessionId, expectedGeneration)) throw new Error('Session changed');
    const response = await api.post<{ secret: string; secretId: string }>(path);
    return response.data;
  }
}
async function openForCurrent(): Promise<OpenVault | null> {
  const selected = context();
  if (!selected) return null;
  const { userId, deviceId, sessionId } = selected;
  const expectedGeneration = generation;
  let db: IDBPDatabase<VaultDB> | null = null;
  let hadVault = false;
  try {
    db = await openDatabase(userId, deviceId);
    let meta = await db.get('metadata', 'root');
    hadVault = !!meta;
    const remote = await fetchSecret(selected, expectedGeneration, !!meta);
    if (!stillCurrent(userId, deviceId, sessionId, expectedGeneration)) { db.close(); return null; }
    const secretBytes = fromB64(remote.secret);
    if (secretBytes.length !== 32 || !remote.secretId) throw new Error('Invalid vault secret');
    if (meta && (meta.schema !== SCHEMA || meta.userId !== userId || meta.deviceId !== deviceId || meta.secretId !== remote.secretId)) {
      throw new Error('Vault identity or Central secret changed; local vault retained for recovery');
    }
    if (!meta) {
      const deviceKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      if (!stillCurrent(userId, deviceId, sessionId, expectedGeneration)) { db.close(); return null; }
      meta = {
        schema: SCHEMA, userId, deviceId, vaultId: crypto.randomUUID(), secretId: remote.secretId,
        deviceKey,
      };
      await db.put('metadata', meta, 'root');
    }
    const accountKey = await crypto.subtle.importKey('raw', secretBytes as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const vault: OpenVault = { db, meta, accountKey, cache: new Map(), userId, deviceId, sessionId, generation: expectedGeneration };
    if (!stillCurrent(userId, deviceId, sessionId, expectedGeneration)) { db.close(); return null; }
    const records = await db.getAll('secrets');
    for (const record of records) {
      const secret = await decrypt(vault, record);
      vault.cache.set(entryKey(record.conversationId, record.keyVersion), secret);
    }
    if (!stillCurrent(userId, deviceId, sessionId, expectedGeneration)) { db.close(); return null; }
    current?.db.close();
    current = vault;
    if (volatileOwner?.userId === userId && volatileOwner.deviceId === deviceId && volatileOwner.sessionId === sessionId) {
      for (const [key, value] of [...volatile]) {
        const match = key.match(/^(.+)\.(\d+)$/);
        if (!match) continue;
        try {
          await saveVaultConversationSecret(match[1], Number(match[2]), value);
        } catch (error) {
          if (!(error instanceof VaultKeyConflictError)) throw error;
        }
      }
    }
    if (volatile.size === 0) clearWarning();
    refreshLegacyDMKeyNotice();
    return vault;
  } catch {
    if (current?.db === db) current = null;
    db?.close();
    if (stillCurrent(userId, deviceId, sessionId, expectedGeneration)) {
      warn(hadVault
        ? 'Your local DM vault could not be opened. Its encrypted keys were kept for recovery.'
        : 'DM keys cannot be saved on this device and will be lost when this window closes.', hadVault ? 'vault' : 'storage');
    }
    return null;
  }
}
async function encrypt(vault: OpenVault, conversationId: string, keyVersion: number, secret: string): Promise<EncryptedRecord> {
  const innerIv = randomIv();
  const outerIv = randomIv();
  const plain = fromB64(secret);
  if (plain.length !== 32) throw new Error('Invalid conversation secret');
  const inner = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: innerIv as BufferSource,
    additionalData: additionalData(vault.meta, conversationId, keyVersion, 'account') as BufferSource }, vault.accountKey, plain as BufferSource);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: outerIv as BufferSource,
    additionalData: additionalData(vault.meta, conversationId, keyVersion, 'device') as BufferSource }, vault.meta.deviceKey, inner);
  return { key: entryKey(conversationId, keyVersion), conversationId, keyVersion, innerIv, outerIv, ciphertext };
}
async function decrypt(vault: OpenVault, record: EncryptedRecord): Promise<string> {
  if (record.innerIv?.length !== 12 || record.outerIv?.length !== 12 || !Number.isSafeInteger(record.keyVersion) || record.keyVersion < 1) throw new Error('Invalid vault record');
  const inner = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.outerIv as BufferSource,
    additionalData: additionalData(vault.meta, record.conversationId, record.keyVersion, 'device') as BufferSource }, vault.meta.deviceKey, record.ciphertext);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.innerIv as BufferSource,
    additionalData: additionalData(vault.meta, record.conversationId, record.keyVersion, 'account') as BufferSource }, vault.accountKey, inner));
  if (plain.length !== 32) throw new Error('Invalid conversation secret');
  return b64(plain);
}
// Older clients stamped a single owner/device marker when signing out, after
// plaintext keys from several accounts could already be mixed in one origin.
// Even matching markers are not proof that every entry belongs to this account.
export function refreshLegacyDMKeyNotice() {
  for (let index = 0; index < localStorage.length; index++) {
    if (localStorage.key(index)?.startsWith(LEGACY_PREFIX)) {
      warn('Old plaintext DM key copies need review. They were kept; current DM encryption is separate.', 'legacy');
      return;
    }
  }
}

type LegacyMarkerState = 'missing' | 'matches' | 'different';
export type LegacyDMKeyDiagnostics = {
  entries: number;
  plausibleKeys: number;
  accountMarker: LegacyMarkerState;
  deviceMarker: LegacyMarkerState;
  sessionMarker: LegacyMarkerState;
};

// Only report counts and comparisons. Never expose plaintext key values or IDs in diagnostics.
export function getLegacyDMKeyDiagnostics(): LegacyDMKeyDiagnostics | null {
  const activeUser = useAuthStore.getState().user;
  if (activeUser?.accountType !== 'central') return null;
  const selected = { userId: activeUser.id, deviceId: getLocalDeviceId() };
  const marker = (value: string | null, expected: string): LegacyMarkerState =>
    value == null ? 'missing' : value === expected ? 'matches' : 'different';
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key): key is string => !!key && key.startsWith(LEGACY_PREFIX));
  let plausibleKeys = 0;
  for (const key of keys) {
    const match = key.slice(LEGACY_PREFIX.length).match(/^(.+)\.(\d+)$/);
    const version = Number(match?.[2]);
    if (!match || !Number.isSafeInteger(version) || version < 1) continue;
    const value = localStorage.getItem(key);
    if (!value) continue;
    try { if (fromB64(value).length === 32) plausibleKeys++; } catch { /* malformed entry */ }
  }
  let sessionOwner: string | null = null;
  try { sessionOwner = JSON.parse(localStorage.getItem('catrealm_session') ?? 'null')?.user?.id ?? null; } catch { /* malformed session */ }
  return {
    entries: keys.length,
    plausibleKeys,
    accountMarker: marker(localStorage.getItem(LEGACY_OWNER), selected.userId),
    deviceMarker: marker(localStorage.getItem(LEGACY_DEVICE), selected.deviceId),
    sessionMarker: marker(sessionOwner, selected.userId),
  };
}

export type DMVaultAudit = {
  records: number;
  accessible: number;
  needsReview: number;
  couldNotCheck: number;
};

// Check only conversation membership. Conversation IDs go to the authenticated
// manifest endpoint; no key material is sent or returned in the audit result.
export async function auditCurrentDMVault(): Promise<DMVaultAudit> {
  const selected = context();
  const vault = current;
  if (!selected || !vault || !stillCurrent(vault.userId, vault.deviceId, vault.sessionId, vault.generation)) {
    throw new Error('Sign in and wait for this device’s DM vault to open before checking.');
  }
  const records = await vault.db.getAll('secrets');
  const recordCounts = new Map<string, number>();
  for (const record of records) {
    recordCounts.set(record.conversationId, (recordCounts.get(record.conversationId) ?? 0) + 1);
  }
  const result: DMVaultAudit = { records: records.length, accessible: 0, needsReview: 0, couldNotCheck: 0 };
  const api = createAuthenticatedApi();
  for (const [conversationId, recordCount] of recordCounts) {
    if (!stillCurrent(vault.userId, vault.deviceId, vault.sessionId, vault.generation)) {
      throw new Error('Account changed during the DM key check. Run it again for the current account.');
    }
    try {
      const response = await api.get<{ participantUserIds?: string[] }>(
        `/api/dms/conversations/${encodeURIComponent(conversationId)}/key-manifest`,
      );
      if (response.data.participantUserIds?.includes(vault.userId)) result.accessible += recordCount;
      else result.needsReview += recordCount;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) result.needsReview += recordCount;
      else result.couldNotCheck += recordCount;
    }
  }
  if (!stillCurrent(vault.userId, vault.deviceId, vault.sessionId, vault.generation)) {
    throw new Error('Account changed during the DM key check. Run it again for the current account.');
  }
  return result;
}

export async function ensureDMVaultReady() {
  const selected = context();
  if (!selected) return null;
  if ((current && (current.userId !== selected.userId || current.deviceId !== selected.deviceId || current.sessionId !== selected.sessionId))
    || (volatileOwner && (volatileOwner.userId !== selected.userId || volatileOwner.deviceId !== selected.deviceId || volatileOwner.sessionId !== selected.sessionId))
    || (openingOwner && (openingOwner.userId !== selected.userId || openingOwner.deviceId !== selected.deviceId || openingOwner.sessionId !== selected.sessionId))) lockDMVault();
  if (current && stillCurrent(current.userId, current.deviceId, current.sessionId, current.generation)) return current;
  if (!opening) {
    openingOwner = selected;
    const task = openForCurrent().finally(() => {
      if (opening === task) { opening = null; openingOwner = null; }
    });
    opening = task;
  }
  return opening;
}
export async function getVaultConversationSecret(conversationId: string, keyVersion: number) {
  const selected = context();
  if (!selected) return null;
  const selectedGeneration = generation;
  const vault = await ensureDMVaultReady();
  const after = context();
  if (generation !== selectedGeneration || after?.userId !== selected.userId || after.deviceId !== selected.deviceId || after.sessionId !== selected.sessionId) return null;
  const ownVolatile = volatileOwner?.userId === selected.userId && volatileOwner.deviceId === selected.deviceId && volatileOwner.sessionId === selected.sessionId;
  return vault?.cache.get(entryKey(conversationId, keyVersion))
    ?? (ownVolatile ? volatile.get(entryKey(conversationId, keyVersion)) : null) ?? null;
}
export async function saveVaultConversationSecret(conversationId: string, keyVersion: number, secret: string) {
  const selected = context();
  if (!selected) throw new Error('No active bound Central account for DM key');
  const selectedGeneration = generation;
  const secretBytes = fromB64(secret);
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1 || secretBytes.length !== 32) throw new Error('Invalid conversation secret');
  secret = b64(secretBytes);
  const key = entryKey(conversationId, keyVersion);
  const vault = await ensureDMVaultReady();
  const after = context();
  if (generation !== selectedGeneration || after?.userId !== selected.userId || after.deviceId !== selected.deviceId || after.sessionId !== selected.sessionId) throw new Error('Session changed while saving DM key');
  if (volatileOwner?.userId === selected.userId && volatileOwner.deviceId === selected.deviceId && volatileOwner.sessionId === selected.sessionId) {
    const pending = volatile.get(key);
    if (pending && pending !== secret) throw keyConflict();
  }
  if (!vault || !stillCurrent(vault.userId, vault.deviceId, vault.sessionId, vault.generation)) {
    volatileOwner = selected;
    volatile.set(key, secret);
    warn('DM keys cannot be saved on this device and will be lost when this window closes.');
    return;
  }
  const cached = vault.cache.get(key);
  if (cached) {
    if (cached !== secret) throw keyConflict();
    return;
  }
  try {
    const record = await encrypt(vault, conversationId, keyVersion, secret);
    if (!stillCurrent(vault.userId, vault.deviceId, vault.sessionId, vault.generation)) throw new Error('Session changed while saving DM key');
    try {
      await vault.db.add('secrets', record);
    } catch (error) {
      if ((error as { name?: string })?.name !== 'ConstraintError') throw error;
      const existing = await vault.db.get('secrets', key);
      if (!existing || await decrypt(vault, existing) !== secret) {
        throw keyConflict();
      }
    }
    if (!stillCurrent(vault.userId, vault.deviceId, vault.sessionId, vault.generation)) throw new Error('Session changed while saving DM key');
    vault.cache.set(key, secret);
    volatile.delete(key);
  } catch (error) {
    if (error instanceof VaultKeyConflictError) throw error;
    const latest = context();
    if (generation !== selectedGeneration || latest?.userId !== selected.userId || latest.deviceId !== selected.deviceId || latest.sessionId !== selected.sessionId) throw new Error('Session changed while saving DM key');
    volatileOwner = selected;
    volatile.set(key, secret);
    warn('DM keys cannot be saved on this device and will be lost when this window closes.');
  }
}
export function lockDMVault(broadcast = true) {
  if (broadcast) {
    const selected = current ?? context();
    if (selected) channel?.postMessage({ type: 'lock', userId: selected.userId, deviceId: selected.deviceId });
  }
  generation++;
  current?.db.close();
  current = null;
  opening = null;
  openingOwner = null;
  volatile.clear();
  volatileOwner = null;
  clearWarning();
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === 'catrealm.device-id') { lockDMVault(false); return; }
    if (event.key !== 'catrealm_session') return;
    const active = current ?? volatileOwner ?? context();
    let nextUserId: string | null = null;
    let nextSessionId: string | null = null;
    try {
      const next = event.newValue ? JSON.parse(event.newValue) : null;
      nextUserId = next?.user?.id ?? null;
      nextSessionId = next?.token ? (decodeToken(next.token)?.sid as string | undefined) ?? null : null;
    } catch { /* lock below */ }
    if (active && (nextUserId !== active.userId || nextSessionId !== active.sessionId)) lockDMVault(false);
  });
}
if (channel) {
  channel.onmessage = (event: MessageEvent<{ type?: string; userId?: string; deviceId?: string }>) => {
    const selected = current ?? context();
    if (event.data?.type === 'lock' && selected?.userId === event.data.userId && selected?.deviceId === event.data.deviceId) {
      lockDMVault(false);
    }
  };
}
export async function forgetDMVault(userId: string, deviceId: string) {
  lockDMVault();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName(userId, deviceId));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other CatRealm tabs to forget local DM keys'));
  });
}
