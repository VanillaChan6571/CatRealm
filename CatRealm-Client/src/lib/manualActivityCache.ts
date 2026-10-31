interface ActivitySnapshotBase {
  activityType: string | null;
  activityText: string | null;
  activityStartedAt: number | null;
}

export interface ManualActivitySnapshot extends ActivitySnapshotBase {
  source: 'explicit' | 'inferred' | null;
}

export interface AutoActivitySnapshot extends ActivitySnapshotBase {}

const STORAGE_PREFIX = 'catrealm:manual-activity:';
const AUTO_STORAGE_PREFIX = 'catrealm:auto-activity:';

function getStorageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

function getAutoStorageKey(userId: string) {
  return `${AUTO_STORAGE_PREFIX}${userId}`;
}

function readActivitySnapshot(storageKey: string): ManualActivitySnapshot | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ManualActivitySnapshot>;
    return {
      activityType: parsed.activityType ?? null,
      activityText: parsed.activityText ?? null,
      activityStartedAt: Number.isFinite(parsed.activityStartedAt) ? Number(parsed.activityStartedAt) : null,
      source: parsed.source === 'explicit' || parsed.source === 'inferred' ? parsed.source : null,
    };
  } catch {
    return null;
  }
}

function writeActivitySnapshot(storageKey: string, snapshot: ActivitySnapshotBase | ManualActivitySnapshot) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
  } catch {
    // ignore storage errors
  }
}

function clearActivitySnapshot(storageKey: string) {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // ignore storage errors
  }
}

export function readManualActivity(userId: string | null | undefined): ManualActivitySnapshot | null {
  if (!userId || typeof window === 'undefined') return null;
  return readActivitySnapshot(getStorageKey(userId));
}

export function writeManualActivity(userId: string | null | undefined, snapshot: ManualActivitySnapshot) {
  if (!userId || typeof window === 'undefined') return;
  writeActivitySnapshot(getStorageKey(userId), snapshot);
}

export function clearManualActivity(userId: string | null | undefined) {
  if (!userId || typeof window === 'undefined') return;
  clearActivitySnapshot(getStorageKey(userId));
}

export function readAutoActivity(userId: string | null | undefined): AutoActivitySnapshot | null {
  if (!userId || typeof window === 'undefined') return null;
  return readActivitySnapshot(getAutoStorageKey(userId));
}

export function writeAutoActivity(userId: string | null | undefined, snapshot: AutoActivitySnapshot) {
  if (!userId || typeof window === 'undefined') return;
  writeActivitySnapshot(getAutoStorageKey(userId), snapshot);
}

export function clearAutoActivity(userId: string | null | undefined) {
  if (!userId || typeof window === 'undefined') return;
  clearActivitySnapshot(getAutoStorageKey(userId));
}
