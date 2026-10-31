/**
 * Client-side scheduled message queue backed by localStorage.
 * Used when the server (central auth) doesn't natively support scheduledAt.
 * Messages are stored as plaintext and re-encrypted at send time.
 */

export interface ScheduledDMEntry {
  id: string;
  otherUserId: string;
  conversationId: string;
  text: string;
  scheduledAt: number; // unix seconds
  nsfwTags: string[];
}

export interface ScheduledGCEntry {
  id: string;
  groupId: string;
  text: string;
  scheduledAt: number; // unix seconds
  nsfwTags: string[];
}

const DM_KEY = 'catrealm:scheduled_dms';
const GC_KEY = 'catrealm:scheduled_gcs';

function readJSON<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(key) ?? '[]') as T[]; } catch { return []; }
}
function writeJSON<T>(key: string, items: T[]) {
  try { localStorage.setItem(key, JSON.stringify(items)); } catch {}
}

// ── DM ────────────────────────────────────────────────────────────────────────

export function getScheduledDMs(): ScheduledDMEntry[] {
  return readJSON<ScheduledDMEntry>(DM_KEY);
}

export function addScheduledDMEntry(entry: ScheduledDMEntry) {
  const items = getScheduledDMs().filter(e => e.id !== entry.id);
  items.push(entry);
  writeJSON(DM_KEY, items);
}

export function removeScheduledDMEntry(id: string) {
  writeJSON(DM_KEY, getScheduledDMs().filter(e => e.id !== id));
}

// ── Group Chat ────────────────────────────────────────────────────────────────

export function getScheduledGCs(): ScheduledGCEntry[] {
  return readJSON<ScheduledGCEntry>(GC_KEY);
}

export function addScheduledGCEntry(entry: ScheduledGCEntry) {
  const items = getScheduledGCs().filter(e => e.id !== entry.id);
  items.push(entry);
  writeJSON(GC_KEY, items);
}

export function removeScheduledGCEntry(id: string) {
  writeJSON(GC_KEY, getScheduledGCs().filter(e => e.id !== id));
}
