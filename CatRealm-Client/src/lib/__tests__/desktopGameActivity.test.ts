import { describe, expect, it } from 'vitest';
import {
  activityCoreMatchesSnapshot,
  activityMatchesSnapshot,
  isDetectorManagedActivity,
  shouldClearIncomingStaleAutoActivity,
  shouldDiscardPersistedManualActivity,
  shouldRestoreManualActivity,
  shouldSnapshotManualActivity,
} from '../desktopGameActivity';

describe('shouldSnapshotManualActivity', () => {
  it('does not overwrite manual activity while an auto-detected session is being restored', () => {
    expect(shouldSnapshotManualActivity({
      userId: 'user-1',
      activityType: 'Playing',
      activityText: 'Cat Quest',
      detectorStatus: 'disabled',
      hasDetectorActivity: false,
      hadAutoActivity: true,
      matchesPersistedAutoActivity: false,
      resemblesPersistedAutoActivity: false,
    })).toBe(false);
  });

  it('captures non-playing manual activity when no auto-detected session is active', () => {
    expect(shouldSnapshotManualActivity({
      userId: 'user-1',
      activityType: 'Listening',
      activityText: 'Manual Cat FM',
      detectorStatus: 'idle',
      hasDetectorActivity: false,
      hadAutoActivity: false,
      matchesPersistedAutoActivity: false,
      resemblesPersistedAutoActivity: false,
    })).toBe(true);
  });

  it('does not implicitly snapshot manual playing activity', () => {
    expect(shouldSnapshotManualActivity({
      userId: 'user-1',
      activityType: 'Playing',
      activityText: 'Manual Cat Quest',
      detectorStatus: 'idle',
      hasDetectorActivity: false,
      hadAutoActivity: false,
      matchesPersistedAutoActivity: false,
      resemblesPersistedAutoActivity: false,
    })).toBe(false);
  });

  it('does not snapshot a stale detector-managed activity as manual activity', () => {
    expect(shouldSnapshotManualActivity({
      userId: 'user-1',
      activityType: 'Playing',
      activityText: 'Cat Quest',
      detectorStatus: 'idle',
      hasDetectorActivity: false,
      hadAutoActivity: false,
      matchesPersistedAutoActivity: true,
      resemblesPersistedAutoActivity: true,
    })).toBe(false);
  });

  it('does not snapshot a stale detector-managed activity when only startedAt drifted', () => {
    expect(shouldSnapshotManualActivity({
      userId: 'user-1',
      activityType: 'Playing',
      activityText: 'Cat Quest',
      detectorStatus: 'idle',
      hasDetectorActivity: false,
      hadAutoActivity: false,
      matchesPersistedAutoActivity: false,
      resemblesPersistedAutoActivity: true,
    })).toBe(false);
  });
});

describe('shouldRestoreManualActivity', () => {
  it('restores after a live auto-detected session ends', () => {
    expect(shouldRestoreManualActivity({
      userId: 'user-1',
      activityType: 'Playing',
      activityText: 'Cat Quest',
      hadAutoActivity: true,
      matchesPersistedAutoActivity: false,
      resemblesPersistedAutoActivity: false,
      resemblesManualActivity: false,
    })).toBe(true);
  });

  it('restores when the current activity still looks like persisted auto activity', () => {
    expect(shouldRestoreManualActivity({
      userId: 'user-1',
      activityType: 'Playing',
      activityText: 'Cat Quest',
      hadAutoActivity: false,
      matchesPersistedAutoActivity: false,
      resemblesPersistedAutoActivity: true,
      resemblesManualActivity: false,
    })).toBe(true);
  });

  it('does not clear an explicit manual activity that matches the same game', () => {
    expect(shouldRestoreManualActivity({
      userId: 'user-1',
      activityType: 'Playing',
      activityText: 'Cat Quest',
      hadAutoActivity: false,
      matchesPersistedAutoActivity: false,
      resemblesPersistedAutoActivity: true,
      resemblesManualActivity: true,
    })).toBe(false);
  });
});

describe('shouldClearIncomingStaleAutoActivity', () => {
  it('clears stale central activity when game activity is off and it matches the persisted auto snapshot', () => {
    expect(shouldClearIncomingStaleAutoActivity({
      userId: 'user-1',
      activityType: 'Playing',
      activityText: 'Cat Quest',
      detectorStatus: 'disabled',
      gameActivityEnabled: false,
      matchesPersistedAutoActivity: true,
      resemblesPersistedAutoActivity: true,
      resemblesPersistedManualActivity: false,
      persistedManualLooksLikeAuto: false,
      hasExplicitManualActivity: false,
    })).toBe(true);
  });

  it('does not clear a real manual activity that matches the persisted manual snapshot', () => {
    expect(shouldClearIncomingStaleAutoActivity({
      userId: 'user-1',
      activityType: 'Playing',
      activityText: 'Cat Quest',
      detectorStatus: 'disabled',
      gameActivityEnabled: false,
      matchesPersistedAutoActivity: true,
      resemblesPersistedAutoActivity: true,
      resemblesPersistedManualActivity: true,
      persistedManualLooksLikeAuto: false,
      hasExplicitManualActivity: true,
    })).toBe(false);
  });

  it('does not clear while the detector is still starting with game activity enabled', () => {
    expect(shouldClearIncomingStaleAutoActivity({
      userId: 'user-1',
      activityType: 'Playing',
      activityText: 'Cat Quest',
      detectorStatus: 'idle',
      gameActivityEnabled: true,
      matchesPersistedAutoActivity: true,
      resemblesPersistedAutoActivity: true,
      resemblesPersistedManualActivity: false,
      persistedManualLooksLikeAuto: false,
      hasExplicitManualActivity: false,
    })).toBe(false);
  });

  it('clears stale playing activity when detector is off and there is no explicit manual snapshot', () => {
    expect(shouldClearIncomingStaleAutoActivity({
      userId: 'user-1',
      activityType: 'Playing',
      activityText: 'Cat Quest',
      detectorStatus: 'unsupported',
      gameActivityEnabled: false,
      matchesPersistedAutoActivity: false,
      resemblesPersistedAutoActivity: false,
      resemblesPersistedManualActivity: false,
      persistedManualLooksLikeAuto: false,
      hasExplicitManualActivity: false,
    })).toBe(true);
  });
});

describe('shouldDiscardPersistedManualActivity', () => {
  it('discards inferred playing snapshots during restore', () => {
    expect(shouldDiscardPersistedManualActivity({
      activityType: 'Playing',
      source: 'inferred',
      detectorStatus: 'idle',
      currentActivityResemblesPersistedAuto: false,
      persistedManualLooksLikeAuto: false,
    })).toBe(true);
  });

  it('keeps explicit playing snapshots during restore', () => {
    expect(shouldDiscardPersistedManualActivity({
      activityType: 'Playing',
      source: 'explicit',
      detectorStatus: 'idle',
      currentActivityResemblesPersistedAuto: false,
      persistedManualLooksLikeAuto: false,
    })).toBe(false);
  });
});

describe('isDetectorManagedActivity', () => {
  it('recognizes when the live activity belongs to the active detector session', () => {
    expect(isDetectorManagedActivity({
      activityType: 'Playing',
      activityText: 'Cat Quest',
      detectorStatus: 'active',
      detectorActivity: {
        activityType: 'Playing',
        activityText: 'Cat Quest',
        activityStartedAt: 123,
      },
    })).toBe(true);
  });

  it('does not treat a different manual activity as detector-managed', () => {
    expect(isDetectorManagedActivity({
      activityType: 'Listening',
      activityText: 'Cat FM',
      detectorStatus: 'active',
      detectorActivity: {
        activityType: 'Playing',
        activityText: 'Cat Quest',
        activityStartedAt: 123,
      },
    })).toBe(false);
  });
});

describe('activity snapshot matching', () => {
  it('matches a persisted auto snapshot only when type, text, and startedAt all match', () => {
    expect(activityMatchesSnapshot({
      activityType: 'Playing',
      activityText: 'Cat Quest',
      activityStartedAt: 123,
      snapshot: {
        activityType: 'Playing',
        activityText: 'Cat Quest',
        activityStartedAt: 123,
      },
    })).toBe(true);

    expect(activityMatchesSnapshot({
      activityType: 'Playing',
      activityText: 'Cat Quest',
      activityStartedAt: 124,
      snapshot: {
        activityType: 'Playing',
        activityText: 'Cat Quest',
        activityStartedAt: 123,
      },
    })).toBe(false);
  });

  it('can still recognize the same activity payload when only startedAt differs', () => {
    expect(activityCoreMatchesSnapshot({
      activityType: 'Playing',
      activityText: 'Cat Quest',
      snapshot: {
        activityType: 'Playing',
        activityText: 'Cat Quest',
        activityStartedAt: 123,
      },
    })).toBe(true);
  });
});
