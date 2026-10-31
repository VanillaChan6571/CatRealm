import { useEffect, useRef } from 'react';
import { createApi } from '../lib/api';
import { createAuthenticatedApi } from '../lib/authApi';
import { clearCentralPresenceActivityCache, writeCentralPresenceCache } from '../lib/centralPresenceCache';
import { logGameActivityDebug } from '../lib/gameActivityDebug';
import {
  activityCoreMatchesSnapshot,
  activityMatchesSnapshot,
  shouldDiscardPersistedManualActivity,
  shouldRestoreManualActivity,
  shouldSnapshotManualActivity,
} from '../lib/desktopGameActivity';
import { clearAutoActivity, clearManualActivity, readAutoActivity, readManualActivity, writeAutoActivity, writeManualActivity } from '../lib/manualActivityCache';
import { useAuthStore } from '../stores/authStore';
import { useGameActivityStore } from '../stores/gameActivityStore';
import { usePresenceStore } from '../stores/presenceStore';
import { useSettingsStore } from '../stores/settingsStore';

function buildActivitySignature(type: string | null | undefined, text: string | null | undefined, startedAt: number | null | undefined) {
  return `${type || ''}::${text || ''}::${startedAt || ''}`;
}

import { fetchIconByProcess } from '../lib/gameLibraryIcons';

export { fetchIconByProcess as fetchGameIconUrl, evictIconCacheByProcess as evictIconCacheEntries } from '../lib/gameLibraryIcons';

async function publishActivity(
  user: ReturnType<typeof useAuthStore.getState>['user'],
  payload: { activityType: string | null; activityText: string | null; activityStartedAt: number | null }
) {
  if (!user) return;
  const updateUser = useAuthStore.getState().updateUser;
  const updateOnlineUser = usePresenceStore.getState().updateOnlineUser;

  const sameActivity = user.activityType === payload.activityType && user.activityText === payload.activityText;
  const normalizedStartedAt = sameActivity && user.activityStartedAt && (
    !payload.activityStartedAt || payload.activityStartedAt > user.activityStartedAt
  )
    ? user.activityStartedAt
    : payload.activityStartedAt;

  logGameActivityDebug('publish:start', {
    userId: user.id,
    accountType: user.accountType,
    currentActivityType: user.activityType ?? null,
    currentActivityText: user.activityText ?? null,
    currentActivityStartedAt: user.activityStartedAt ?? null,
    payload,
    sameActivity,
    normalizedStartedAt,
  });

  if (user.accountType === 'central') {
    const api = createAuthenticatedApi();
    if (!payload.activityType || !payload.activityText) {
      const res = await api.delete('/api/profile/me/activity');
      logGameActivityDebug('publish:central-delete:success', {
        userId: res.data.id ?? user.id,
        responseActivityType: res.data.activityType ?? res.data.activity_type ?? null,
        responseActivityText: res.data.activityText ?? res.data.activity_text ?? null,
        responseActivityStartedAt: res.data.activityStartedAt ?? res.data.activity_started_at ?? null,
      });
      updateUser({ activityType: null, activityText: null, activityStartedAt: null });
      clearCentralPresenceActivityCache(res.data.id ?? user.id);
      updateOnlineUser(res.data.id ?? user.id, { activityType: null, activityText: null, activityStartedAt: null });
      return;
    }
    const res = await api.put('/api/profile/me/activity', {
      ...payload,
      activityStartedAt: normalizedStartedAt,
    });
    const nextType = res.data.activityType ?? res.data.activity_type ?? payload.activityType;
    const nextText = res.data.activityText ?? res.data.activity_text ?? payload.activityText;
    const nextStartedAt = res.data.activityStartedAt ?? res.data.activity_started_at ?? normalizedStartedAt;
    logGameActivityDebug('publish:central-put:success', {
      userId: res.data.id ?? user.id,
      nextType,
      nextText,
      nextStartedAt,
    });
    updateUser({ activityType: nextType, activityText: nextText, activityStartedAt: nextStartedAt });
    writeCentralPresenceCache(res.data.id ?? user.id, {
      activityType: nextType,
      activityText: nextText,
      activityStartedAt: nextStartedAt,
    });
    updateOnlineUser(res.data.id ?? user.id, { activityType: nextType, activityText: nextText, activityStartedAt: nextStartedAt });
    return;
  }

  const api = createApi();
  if (!payload.activityType || !payload.activityText) {
    const res = await api.delete('/api/profile/me/activity');
    logGameActivityDebug('publish:local-delete:success', {
      userId: res.data.id ?? user.id,
      responseActivityType: res.data.activityType ?? res.data.activity_type ?? null,
      responseActivityText: res.data.activityText ?? res.data.activity_text ?? null,
      responseActivityStartedAt: res.data.activityStartedAt ?? res.data.activity_started_at ?? null,
    });
    updateUser({ activityType: null, activityText: null, activityStartedAt: null });
    updateOnlineUser(res.data.id ?? user.id, { activityType: null, activityText: null, activityStartedAt: null });
    return;
  }

  const res = await api.put('/api/profile/me/activity', {
    ...payload,
    activityStartedAt: normalizedStartedAt,
  });
  const nextType = res.data.activityType ?? res.data.activity_type ?? payload.activityType;
  const nextText = res.data.activityText ?? res.data.activity_text ?? payload.activityText;
  const nextStartedAt = res.data.activityStartedAt ?? res.data.activity_started_at ?? normalizedStartedAt;
  logGameActivityDebug('publish:local-put:success', {
    userId: res.data.id ?? user.id,
    nextType,
    nextText,
    nextStartedAt,
  });
  updateUser({ activityType: nextType, activityText: nextText, activityStartedAt: nextStartedAt });
  updateOnlineUser(res.data.id ?? user.id, { activityType: nextType, activityText: nextText, activityStartedAt: nextStartedAt });
}

export function useDesktopGameActivity() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const gameActivityEnabled = useSettingsStore((s) => s.gameActivityEnabled);
  const detectorState = useGameActivityStore((s) => s.detectorState);
  const setDetectorState = useGameActivityStore((s) => s.setDetectorState);
  const setEffectiveGameStartedAt = useGameActivityStore((s) => s.setEffectiveGameStartedAt);
  const setGameIconUrl = useGameActivityStore((s) => s.setGameIconUrl);
  const lastPublishedSignatureRef = useRef('');
  const hadAutoActivityRef = useRef(false);
  const gameStartedAtRef = useRef<number | null>(null);
  const lastGameTextRef = useRef<string | null>(null);
  const persistedAutoActivity = readAutoActivity(user?.id);
  const persistedManualActivity = readManualActivity(user?.id);
  const currentActivityMatchesPersistedAuto = activityMatchesSnapshot({
    activityType: user?.activityType,
    activityText: user?.activityText,
    activityStartedAt: user?.activityStartedAt,
    snapshot: persistedAutoActivity,
  });
  const currentActivityResemblesPersistedAuto = activityCoreMatchesSnapshot({
    activityType: user?.activityType,
    activityText: user?.activityText,
    snapshot: persistedAutoActivity,
  });
  const currentActivityResemblesPersistedManual = activityCoreMatchesSnapshot({
    activityType: user?.activityType,
    activityText: user?.activityText,
    snapshot: persistedManualActivity,
  });

  useEffect(() => {
    logGameActivityDebug('state:snapshot', {
      userId: user?.id ?? null,
      enabledSetting: gameActivityEnabled,
      detectorStatus: detectorState.status,
      detectorActivity: detectorState.activity ?? null,
      userActivityType: user?.activityType ?? null,
      userActivityText: user?.activityText ?? null,
      userActivityStartedAt: user?.activityStartedAt ?? null,
      persistedAutoActivity,
      persistedManualActivity,
      currentActivityMatchesPersistedAuto,
      currentActivityResemblesPersistedAuto,
      currentActivityResemblesPersistedManual,
      hadAutoActivity: hadAutoActivityRef.current,
    });
  }, [
    currentActivityMatchesPersistedAuto,
    currentActivityResemblesPersistedAuto,
    currentActivityResemblesPersistedManual,
    detectorState.activity,
    detectorState.status,
    gameActivityEnabled,
    persistedAutoActivity,
    persistedManualActivity,
    user?.activityStartedAt,
    user?.activityText,
    user?.activityType,
    user?.id,
  ]);

  useEffect(() => {
    if (!window.electron?.onGameActivityState) return;
    window.electron.getGameActivityState().then(setDetectorState).catch(() => {});
    const unsubscribe = window.electron.onGameActivityState(setDetectorState);
    return unsubscribe;
  }, [setDetectorState]);

  useEffect(() => {
    if (!window.electron?.setGameActivityEnabled) return;
    window.electron.setGameActivityEnabled(gameActivityEnabled).then(setDetectorState).catch(() => {});
  }, [gameActivityEnabled, setDetectorState]);

  useEffect(() => {
    if (!shouldSnapshotManualActivity({
      userId: user?.id,
      activityType: user?.activityType,
      activityText: user?.activityText,
      detectorStatus: detectorState.status,
      hasDetectorActivity: !!detectorState.activity,
      hadAutoActivity: hadAutoActivityRef.current,
      matchesPersistedAutoActivity: currentActivityMatchesPersistedAuto,
      resemblesPersistedAutoActivity: currentActivityResemblesPersistedAuto,
    })) return;
    if (!user?.id || !user.activityType || !user.activityText) return;
    writeManualActivity(user.id, {
      activityType: user.activityType,
      activityText: user.activityText,
      activityStartedAt: user.activityStartedAt ?? null,
      source: 'inferred',
    });
  }, [
    user?.id,
    user?.activityType,
    user?.activityText,
    user?.activityStartedAt,
    detectorState.status,
    detectorState.activity,
    currentActivityMatchesPersistedAuto,
    currentActivityResemblesPersistedAuto,
  ]);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    if (!window.electron?.setGameActivityEnabled) return;

    const run = async () => {
      if (detectorState.status === 'active' && detectorState.activity) {
        const active = detectorState.activity;
        hadAutoActivityRef.current = true;
        logGameActivityDebug('run:auto-active', {
          userId: user.id,
          detectorStatus: detectorState.status,
          active,
          lastGameText: lastGameTextRef.current,
          effectiveStartedAt: active.activityStartedAt ?? gameStartedAtRef.current ?? null,
        });

        // Track start time per game session; reset whenever the game name changes
        if (active.activityText !== lastGameTextRef.current) {
          const t = active.activityStartedAt ?? Math.floor(Date.now() / 1000);
          gameStartedAtRef.current = t;
          lastGameTextRef.current = active.activityText;
          setEffectiveGameStartedAt(t);
          if (active.processName) {
            fetchIconByProcess(active.processName).then(setGameIconUrl).catch(() => {});
          }
        }

        const effectiveStartedAt = active.activityStartedAt ?? gameStartedAtRef.current;
        writeAutoActivity(user.id, {
          activityType: active.activityType,
          activityText: active.activityText,
          activityStartedAt: effectiveStartedAt ?? null,
        });
        const signature = buildActivitySignature(active.activityType, active.activityText, effectiveStartedAt);
        if (signature === lastPublishedSignatureRef.current) return;
        await publishActivity(user, {
          activityType: active.activityType,
          activityText: active.activityText,
          activityStartedAt: effectiveStartedAt,
        });
        lastPublishedSignatureRef.current = signature;
        return;
      }

      const persistedManualLooksLikeAuto = activityCoreMatchesSnapshot({
        activityType: persistedManualActivity?.activityType,
        activityText: persistedManualActivity?.activityText,
        snapshot: persistedAutoActivity,
      });
      const shouldDiscardPersistedManual = shouldDiscardPersistedManualActivity({
        activityType: persistedManualActivity?.activityType,
        source: persistedManualActivity?.source,
        detectorStatus: detectorState.status,
        currentActivityResemblesPersistedAuto,
        persistedManualLooksLikeAuto,
      });
      const manual = shouldDiscardPersistedManual ? null : persistedManualActivity;
      const resemblesEffectiveManual = manual
        ? activityCoreMatchesSnapshot({
          activityType: user.activityType,
          activityText: user.activityText,
          snapshot: manual,
        })
        : false;
      if (shouldDiscardPersistedManual) {
        clearManualActivity(user.id);
        logGameActivityDebug('run:manual-cleared-as-stale-auto', {
          userId: user.id,
          detectorStatus: detectorState.status,
          persistedManualActivity,
          persistedAutoActivity,
        });
      }
      const shouldRestore = shouldRestoreManualActivity({
        userId: user.id,
        activityType: user.activityType,
        activityText: user.activityText,
        hadAutoActivity: hadAutoActivityRef.current,
        matchesPersistedAutoActivity: currentActivityMatchesPersistedAuto,
        resemblesPersistedAutoActivity: currentActivityResemblesPersistedAuto,
        resemblesManualActivity: resemblesEffectiveManual,
      });
      logGameActivityDebug('run:restore-check', {
        userId: user.id,
        detectorStatus: detectorState.status,
        detectorActivity: detectorState.activity ?? null,
        userActivityType: user.activityType ?? null,
        userActivityText: user.activityText ?? null,
        userActivityStartedAt: user.activityStartedAt ?? null,
        hadAutoActivity: hadAutoActivityRef.current,
        manual,
        currentActivityMatchesPersistedAuto,
        currentActivityResemblesPersistedAuto,
        currentActivityResemblesPersistedManual,
        persistedManualLooksLikeAuto,
        shouldDiscardPersistedManual,
        manualSource: persistedManualActivity?.source ?? null,
        resemblesEffectiveManual,
        shouldRestore,
      });
      if (!shouldRestore) return;
      const signature = buildActivitySignature(manual?.activityType ?? null, manual?.activityText ?? null, manual?.activityStartedAt ?? null);
      if (signature !== lastPublishedSignatureRef.current) {
        await publishActivity(user, {
          activityType: manual?.activityType ?? null,
          activityText: manual?.activityText ?? null,
          activityStartedAt: manual?.activityStartedAt ?? null,
        });
      }
      lastPublishedSignatureRef.current = signature;
      clearAutoActivity(user.id);
      hadAutoActivityRef.current = false;
      lastGameTextRef.current = null;
      gameStartedAtRef.current = null;
      setEffectiveGameStartedAt(null);
      setGameIconUrl(null);
    };

    run().catch((error) => {
      logGameActivityDebug('run:error', {
        userId: user.id,
        detectorStatus: detectorState.status,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, [
    currentActivityMatchesPersistedAuto,
    currentActivityResemblesPersistedAuto,
    currentActivityResemblesPersistedManual,
    detectorState.activity,
    detectorState.status,
    isAuthenticated,
    persistedManualActivity,
    setEffectiveGameStartedAt,
    setGameIconUrl,
    user,
  ]);
}
