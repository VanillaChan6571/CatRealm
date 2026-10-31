export type ActivityElapsedFormat = 'compact' | 'detailed';

export function formatElapsed(
  startedAt: number | null | undefined,
  nowMs: number,
  format: ActivityElapsedFormat
) {
  if (!Number.isFinite(startedAt) || !startedAt || startedAt <= 0) return null;
  const totalSeconds = Math.max(0, Math.floor(nowMs / 1000) - startedAt);
  if (format === 'detailed') {
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [
      `${days}d`,
      `${hours}h`,
      `${minutes}m`,
      `${seconds}s`,
    ];
    return parts.join(' ');
  }
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatActivitySummary({
  customStatusText,
  activityType,
  activityText,
  activityStartedAt,
  nowMs = Date.now(),
}: {
  customStatusText?: string | null;
  activityType?: string | null;
  activityText?: string | null;
  activityStartedAt?: number | null;
  nowMs?: number;
}) {
  const trimmedCustomStatus = typeof customStatusText === 'string' ? customStatusText.trim() : '';
  if (!activityType || !activityText) return trimmedCustomStatus || null;

  const icon = activityType === 'Playing'
    ? '🎮'
    : activityType === 'Listening'
      ? '🎵'
      : activityType === 'Watching'
        ? '📺'
        : '';
  const elapsed = formatElapsed(activityStartedAt, nowMs, 'compact');
  const activityLabel = activityType === 'Custom'
    ? `${activityText}`
    : `${icon} ${activityType} ${activityText}`.trim();
  return elapsed ? `${activityLabel} • ${elapsed}` : activityLabel;
}
