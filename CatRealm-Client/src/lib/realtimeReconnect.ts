export type RealtimeReconnectKind = 'voice' | 'theater';

export type RealtimeReconnectTarget = {
  kind: RealtimeReconnectKind;
  serverUrl: string;
  channelId: string;
  channelName: string | null;
  userId: string | null;
  savedAt: number;
};

const STORAGE_KEY = 'catrealm.realtimeReconnect.v1';
const MAX_AGE_MS = 15 * 60 * 1000;

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readStoredTarget(): RealtimeReconnectTarget | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RealtimeReconnectTarget>;
    if (
      (parsed.kind !== 'voice' && parsed.kind !== 'theater')
      || typeof parsed.serverUrl !== 'string'
      || typeof parsed.channelId !== 'string'
      || typeof parsed.savedAt !== 'number'
    ) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      kind: parsed.kind,
      serverUrl: parsed.serverUrl,
      channelId: parsed.channelId,
      channelName: typeof parsed.channelName === 'string' ? parsed.channelName : null,
      userId: typeof parsed.userId === 'string' ? parsed.userId : null,
      savedAt: parsed.savedAt,
    };
  } catch {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage cleanup errors
    }
    return null;
  }
}

export function persistRealtimeReconnectTarget(target: Omit<RealtimeReconnectTarget, 'savedAt'>) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...target,
      savedAt: Date.now(),
    } satisfies RealtimeReconnectTarget));
  } catch {
    // ignore storage errors
  }
}

export function clearRealtimeReconnectTarget(kind?: RealtimeReconnectKind) {
  if (!canUseStorage()) return;
  try {
    const current = readStoredTarget();
    if (!current) return;
    if (!kind || current.kind === kind) {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function getRealtimeReconnectTarget(match: { serverUrl: string; userId: string | null }) {
  const current = readStoredTarget();
  if (!current) return null;
  if (current.serverUrl !== match.serverUrl) return null;
  if ((current.userId ?? null) !== (match.userId ?? null)) return null;
  return current;
}

export function consumeRealtimeReconnectTarget(match: { serverUrl: string; userId: string | null }) {
  const current = getRealtimeReconnectTarget(match);
  if (!current) return null;
  clearRealtimeReconnectTarget();
  return current;
}
