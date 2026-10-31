import type { User } from '../types';
import { useGameActivityStore } from '../stores/gameActivityStore';
import { useSettingsStore } from '../stores/settingsStore';
import { createAuthenticatedApi } from './authApi';
import { clearCentralPresenceActivityCache } from './centralPresenceCache';
import {
  activityCoreMatchesSnapshot,
  activityMatchesSnapshot,
  shouldClearIncomingStaleAutoActivity,
} from './desktopGameActivity';
import { logGameActivityDebug } from './gameActivityDebug';
import { clearManualActivity, readAutoActivity, readManualActivity } from './manualActivityCache';

const pendingCentralActivityClearUserIds = new Set<string>();

function normalizeActivityType(value: unknown): User['activityType'] {
  if (value === 'Playing' || value === 'Listening' || value === 'Watching' || value === 'Custom') return value;
  return null;
}

interface ReconciledCentralProfileActivity {
  activityType: User['activityType'];
  activityText: string | null;
  activityStartedAt: number | null;
  shouldClearUpstream: boolean;
  shouldClearManualSnapshot: boolean;
}

export function reconcileIncomingCentralProfileActivity({
  source,
  userId,
  activityType,
  activityText,
  activityStartedAt,
}: {
  source: string;
  userId: string | null | undefined;
  activityType: string | null | undefined;
  activityText: string | null | undefined;
  activityStartedAt: number | null | undefined;
}): ReconciledCentralProfileActivity {
  const normalizedActivityType = normalizeActivityType(activityType);
  const normalizedActivityText = typeof activityText === 'string' && activityText ? activityText : null;
  const normalizedActivityStartedAt = Number.isFinite(activityStartedAt) ? Number(activityStartedAt) : null;
  const persistedAutoActivity = readAutoActivity(userId);
  const persistedManualActivity = readManualActivity(userId);
  const matchesPersistedAutoActivity = activityMatchesSnapshot({
    activityType: normalizedActivityType,
    activityText: normalizedActivityText,
    activityStartedAt: normalizedActivityStartedAt,
    snapshot: persistedAutoActivity,
  });
  const resemblesPersistedAutoActivity = activityCoreMatchesSnapshot({
    activityType: normalizedActivityType,
    activityText: normalizedActivityText,
    snapshot: persistedAutoActivity,
  });
  const resemblesPersistedManualActivity = activityCoreMatchesSnapshot({
    activityType: normalizedActivityType,
    activityText: normalizedActivityText,
    snapshot: persistedManualActivity,
  });
  const persistedManualLooksLikeAuto = activityCoreMatchesSnapshot({
    activityType: persistedManualActivity?.activityType,
    activityText: persistedManualActivity?.activityText,
    snapshot: persistedAutoActivity,
  });
  const hasExplicitManualActivity = persistedManualActivity?.source === 'explicit';
  const detectorStatus = useGameActivityStore.getState().detectorState.status;
  const gameActivityEnabled = useSettingsStore.getState().gameActivityEnabled;
  const shouldClearUpstream = shouldClearIncomingStaleAutoActivity({
    userId,
    activityType: normalizedActivityType,
    activityText: normalizedActivityText,
    detectorStatus,
    gameActivityEnabled,
    matchesPersistedAutoActivity,
    resemblesPersistedAutoActivity,
    resemblesPersistedManualActivity,
    persistedManualLooksLikeAuto,
    hasExplicitManualActivity,
  });

  logGameActivityDebug('central-profile:activity:reconcile', {
    source,
    userId: userId ?? null,
    incomingActivityType: normalizedActivityType,
    incomingActivityText: normalizedActivityText,
    incomingActivityStartedAt: normalizedActivityStartedAt,
    detectorStatus,
    gameActivityEnabled,
    persistedAutoActivity,
    persistedManualActivity,
    matchesPersistedAutoActivity,
    resemblesPersistedAutoActivity,
    resemblesPersistedManualActivity,
    persistedManualLooksLikeAuto,
    manualSource: persistedManualActivity?.source ?? null,
    hasExplicitManualActivity,
    shouldClearUpstream,
  });

  if (shouldClearUpstream && persistedManualLooksLikeAuto && userId) {
    clearManualActivity(userId);
    logGameActivityDebug('central-profile:activity:manual-cleared', {
      source,
      userId,
      persistedManualActivity,
      persistedAutoActivity,
    });
  }

  return {
    activityType: shouldClearUpstream ? null : normalizedActivityType,
    activityText: shouldClearUpstream ? null : normalizedActivityText,
    activityStartedAt: shouldClearUpstream ? null : normalizedActivityStartedAt,
    shouldClearUpstream,
    shouldClearManualSnapshot: shouldClearUpstream && persistedManualLooksLikeAuto,
  };
}

export function scheduleStaleCentralProfileActivityClear({
  source,
  userId,
}: {
  source: string;
  userId: string | null | undefined;
}) {
  if (!userId) return;
  if (pendingCentralActivityClearUserIds.has(userId)) return;
  pendingCentralActivityClearUserIds.add(userId);
  clearCentralPresenceActivityCache(userId);
  logGameActivityDebug('central-profile:activity:delete:start', {
    source,
    userId,
  });
  createAuthenticatedApi().delete('/api/profile/me/activity')
    .then((res) => {
      clearCentralPresenceActivityCache(res.data.id ?? userId);
      logGameActivityDebug('central-profile:activity:delete:success', {
        source,
        userId: res.data.id ?? userId,
        responseActivityType: res.data.activityType ?? res.data.activity_type ?? null,
        responseActivityText: res.data.activityText ?? res.data.activity_text ?? null,
        responseActivityStartedAt: res.data.activityStartedAt ?? res.data.activity_started_at ?? null,
      });
    })
    .catch((error) => {
      logGameActivityDebug('central-profile:activity:delete:error', {
        source,
        userId,
        message: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      pendingCentralActivityClearUserIds.delete(userId);
    });
}
