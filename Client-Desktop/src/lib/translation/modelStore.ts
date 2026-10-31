import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { PackLanguage } from './languages';
import type { ModelFile } from './models';

/**
 * Downloads model files once and keeps them in IndexedDB (the Cache API is unavailable on
 * Electron's file:// origin). Every download is SHA-256 verified before it is stored. Each
 * installed pack also records the hashes it put on disk, so a pack whose pins changed shows as
 * needing an update and removing it deletes exactly its own files.
 */
type PackRecord = { hashes: string[] };

interface ModelDB extends DBSchema {
  files: { key: string; value: ArrayBuffer };
  packs: { key: string; value: PackRecord };
}

const DB_NAME = 'catrealm-translation-models';
let dbPromise: Promise<IDBPDatabase<ModelDB>> | null = null;

function getDb(): Promise<IDBPDatabase<ModelDB>> {
  dbPromise ??= openDB<ModelDB>(DB_NAME, 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) db.createObjectStore('files');
      if (oldVersion < 2) db.createObjectStore('packs');
    },
  });
  return dbPromise;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function download(file: ModelFile, onBytes: (n: number) => void): Promise<ArrayBuffer> {
  const response = await fetch(file.url, { credentials: 'omit' });
  if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status}): ${file.url}`);
  const out = new Uint8Array(file.size);
  const reader = response.body.getReader();
  let offset = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.byteLength > out.byteLength) throw new Error(`Model file larger than expected: ${file.url}`);
    out.set(value, offset);
    offset += value.byteLength;
    onBytes(value.byteLength);
  }
  if (offset !== file.size) throw new Error(`Model file truncated: ${file.url}`);
  if ((await sha256Hex(out.buffer)) !== file.sha256) throw new Error(`Model checksum mismatch: ${file.url}`);
  return out.buffer;
}

/** Returns the file from IndexedDB, downloading (and storing) it on first use. */
export async function loadModelFile(file: ModelFile, onBytes: (n: number) => void = () => {}): Promise<ArrayBuffer> {
  const db = await getDb();
  const cached = await db.get('files', file.sha256);
  if (cached) {
    onBytes(file.size);
    return cached;
  }
  const buffer = await download(file, onBytes);
  await db.put('files', buffer, file.sha256);
  return buffer;
}

export async function hasModelFile(file: ModelFile): Promise<boolean> {
  const db = await getDb();
  return (await db.getKey('files', file.sha256)) !== undefined;
}

export async function hasPackRecord(lang: PackLanguage): Promise<boolean> {
  const db = await getDb();
  return (await db.getKey('packs', lang)) !== undefined;
}

/** Downloads every file of a pack, then records it as installed (replacing an older revision). */
export async function installPackFiles(lang: PackLanguage, files: ModelFile[], onBytes: (n: number) => void): Promise<void> {
  const db = await getDb();
  const previous = await db.get('packs', lang);
  for (const file of files) await loadModelFile(file, onBytes);
  const hashes = files.map((file) => file.sha256);
  await db.put('packs', { hashes }, lang);
  const stale = (previous?.hashes ?? []).filter((hash) => !hashes.includes(hash));
  await Promise.all(stale.map((hash) => db.delete('files', hash)));
}

/** Deletes a pack's files (current pins and whatever revision it recorded) and its record. */
export async function removePackFiles(lang: PackLanguage, files: ModelFile[]): Promise<void> {
  const db = await getDb();
  const record = await db.get('packs', lang);
  const hashes = new Set([...files.map((file) => file.sha256), ...(record?.hashes ?? [])]);
  await Promise.all([...hashes].map((hash) => db.delete('files', hash)));
  await db.delete('packs', lang);
}
