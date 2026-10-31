interface ActivitySnapshotLike {
  activityType: string | null;
  activityText: string | null;
  activityStartedAt: number | null;
}

export function shouldSnapshotManualActivity({
  userId,
  activityType,
  activityText,
  detectorStatus,
  hasDetectorActivity,
  hadAutoActivity,
  matchesPersistedAutoActivity,
  resemblesPersistedAutoActivity,
}: {
  userId: string | null | undefined;
  activityType: string | null | undefined;
  activityText: string | null | undefined;
  detectorStatus: string | null | undefined;
  hasDetectorActivity: boolean;
  hadAutoActivity: boolean;
  matchesPersistedAutoActivity: boolean;
  resemblesPersistedAutoActivity: boolean;
}) {
  if (!userId) return false;
  if (!activityType || !activityText) return false;
  if (activityType === 'Playing') return false;
  if (detectorStatus === 'active' && hasDetectorActivity) return false;
  if (hadAutoActivity) return false;
  if (matchesPersistedAutoActivity) return false;
  if (resemblesPersistedAutoActivity) return false;
  return true;
}

export function shouldDiscardPersistedManualActivity({
  activityType,
  source,
  detectorStatus,
  currentActivityResemblesPersistedAuto,
  persistedManualLooksLikeAuto,
}: {
  activityType: string | null | undefined;
  source: 'explicit' | 'inferred' | null | undefined;
  detectorStatus: string | null | undefined;
  currentActivityResemblesPersistedAuto: boolean;
  persistedManualLooksLikeAuto: boolean;
}) {
  if (!activityType) return false;
  if (activityType === 'Playing' && source !== 'explicit' && detectorStatus !== 'active') return true;
  if (detectorStatus === 'disabled' && currentActivityResemblesPersistedAuto && persistedManualLooksLikeAuto) return true;
  return false;
}

export function shouldRestoreManualActivity({
  userId,
  activityType,
  activityText,
  hadAutoActivity,
  matchesPersistedAutoActivity,
  resemblesPersistedAutoActivity,
  resemblesManualActivity,
}: {
  userId: string | null | undefined;
  activityType: string | null | undefined;
  activityText: string | null | undefined;
  hadAutoActivity: boolean;
  matchesPersistedAutoActivity: boolean;
  resemblesPersistedAutoActivity: boolean;
  resemblesManualActivity: boolean;
}) {
  if (!userId) return false;
  if (hadAutoActivity) return true;
  if (!activityType || !activityText) return false;
  if (matchesPersistedAutoActivity) return true;
  if (!resemblesPersistedAutoActivity) return false;
  if (resemblesManualActivity) return false;
  return true;
}

export function shouldClearIncomingStaleAutoActivity({
  userId,
  activityType,
  activityText,
  detectorStatus,
  gameActivityEnabled,
  matchesPersistedAutoActivity,
  resemblesPersistedAutoActivity,
  resemblesPersistedManualActivity,
  persistedManualLooksLikeAuto,
  hasExplicitManualActivity,
}: {
  userId: string | null | undefined;
  activityType: string | null | undefined;
  activityText: string | null | undefined;
  detectorStatus: string | null | undefined;
  gameActivityEnabled: boolean;
  matchesPersistedAutoActivity: boolean;
  resemblesPersistedAutoActivity: boolean;
  resemblesPersistedManualActivity: boolean;
  persistedManualLooksLikeAuto: boolean;
  hasExplicitManualActivity: boolean;
}) {
  if (!userId) return false;
  if (!activityType || !activityText) return false;
  if (detectorStatus === 'active') return false;
  if (gameActivityEnabled && detectorStatus !== 'disabled') return false;
  if (!matchesPersistedAutoActivity && !resemblesPersistedAutoActivity) {
    if (activityType === 'Playing' && !hasExplicitManualActivity) return true;
    return false;
  }
  if (resemblesPersistedManualActivity && !persistedManualLooksLikeAuto) return false;
  return true;
}

export function activityMatchesSnapshot({
  activityType,
  activityText,
  activityStartedAt,
  snapshot,
}: {
  activityType: string | null | undefined;
  activityText: string | null | undefined;
  activityStartedAt: number | null | undefined;
  snapshot: ActivitySnapshotLike | null | undefined;
}) {
  if (!snapshot) return false;
  return activityType === snapshot.activityType
    && activityText === snapshot.activityText
    && (activityStartedAt ?? null) === snapshot.activityStartedAt;
}

export function activityCoreMatchesSnapshot({
  activityType,
  activityText,
  snapshot,
}: {
  activityType: string | null | undefined;
  activityText: string | null | undefined;
  snapshot: ActivitySnapshotLike | null | undefined;
}) {
  if (!snapshot) return false;
  return activityType === snapshot.activityType
    && activityText === snapshot.activityText;
}

export function isDetectorManagedActivity({
  activityType,
  activityText,
  detectorStatus,
  detectorActivity,
}: {
  activityType: string | null | undefined;
  activityText: string | null | undefined;
  detectorStatus: string | null | undefined;
  detectorActivity: DesktopGameActivity | null | undefined;
}) {
  if (detectorStatus !== 'active' || !detectorActivity) return false;
  return activityType === detectorActivity.activityType && activityText === detectorActivity.activityText;
}
