export interface CachedCentralPresence {
  status: string | null;
  customStatusText: string | null;
  activityType: string | null;
  activityText: string | null;
  activityStartedAt: number | null;
}

const STORAGE_PREFIX = 'catrealm:central-presence:';

function getStorageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

export function readCentralPresenceCache(userId: string | null | undefined): CachedCentralPresence | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedCentralPresence>;
    return {
      status: parsed.status ?? null,
      customStatusText: parsed.customStatusText ?? null,
      activityType: parsed.activityType ?? null,
      activityText: parsed.activityText ?? null,
      activityStartedAt: Number.isFinite(parsed.activityStartedAt) ? Number(parsed.activityStartedAt) : null,
    };
  } catch {
    return null;
  }
}

export function writeCentralPresenceCache(
  userId: string | null | undefined,
  patch: Partial<CachedCentralPresence>
) {
  if (!userId || typeof window === 'undefined') return;
  try {
    const current = readCentralPresenceCache(userId) ?? {
      status: null,
      customStatusText: null,
      activityType: null,
      activityText: null,
      activityStartedAt: null,
    };
    const next: CachedCentralPresence = {
      status: patch.status !== undefined ? patch.status : current.status,
      customStatusText: patch.customStatusText !== undefined ? patch.customStatusText : current.customStatusText,
      activityType: patch.activityType !== undefined ? patch.activityType : current.activityType,
      activityText: patch.activityText !== undefined ? patch.activityText : current.activityText,
      activityStartedAt: patch.activityStartedAt !== undefined ? patch.activityStartedAt : current.activityStartedAt,
    };
    window.localStorage.setItem(getStorageKey(userId), JSON.stringify(next));
  } catch {
    // ignore cache errors
  }
}

export function clearCentralPresenceActivityCache(userId: string | null | undefined) {
  if (!userId) return;
  writeCentralPresenceCache(userId, {
    activityType: null,
    activityText: null,
    activityStartedAt: null,
  });
}
