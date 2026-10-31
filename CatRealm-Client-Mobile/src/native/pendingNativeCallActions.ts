import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeCallAction } from './types';

const STORAGE_KEY = 'catrealm:native-call-actions:v1';
const MAX_ACTION_AGE_MS = 5 * 60 * 1000;

function isNativeCallAction(value: unknown): value is NativeCallAction {
  if (!value || typeof value !== 'object') return false;
  const action = value as Partial<NativeCallAction>;
  return (
    (action.type === 'displayed' || action.type === 'answer' || action.type === 'decline' || action.type === 'end') &&
    typeof action.callId === 'string' &&
    typeof action.occurredAt === 'number'
  );
}

async function readActions(): Promise<NativeCallAction[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - MAX_ACTION_AGE_MS;
    return parsed.filter((entry): entry is NativeCallAction => isNativeCallAction(entry) && entry.occurredAt >= cutoff);
  } catch {
    return [];
  }
}

async function writeActions(actions: NativeCallAction[]) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
  } catch {
    // Native-call action persistence is a recovery aid; the live event still wins when available.
  }
}

export async function enqueuePendingNativeCallAction(action: NativeCallAction) {
  const existing = await readActions();
  const next = [...existing.filter((entry) => !(entry.type === action.type && entry.callId === action.callId)), action].slice(-20);
  await writeActions(next);
}

export async function drainPendingNativeCallActions(): Promise<NativeCallAction[]> {
  const actions = await readActions();
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // If clearing fails, the age limit above prevents very stale actions from replaying forever.
  }
  return actions;
}
