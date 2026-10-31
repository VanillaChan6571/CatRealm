function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function actorLabel(data: Record<string, unknown> | null | undefined): string {
  return (
    asString(data?.actorDisplayName) ||
    asString(data?.actorUsername) ||
    asString(data?.actorName) ||
    'Someone'
  );
}

function targetLabel(data: Record<string, unknown> | null | undefined): string {
  return (
    asString(data?.targetDisplayName) ||
    asString(data?.targetUsername) ||
    asString(data?.targetName) ||
    asString(data?.memberDisplayName) ||
    asString(data?.memberUsername) ||
    asString(data?.memberName) ||
    'a member'
  );
}

function formatDuration(secondsRaw: unknown): string | null {
  const totalSeconds = Math.max(0, Math.floor(asNumber(secondsRaw) ?? NaN));
  if (!Number.isFinite(totalSeconds)) return null;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatSystemMessageText(input: {
  messageType?: 'user' | 'system' | null;
  systemType?: string | null;
  systemData?: Record<string, unknown> | null;
  fallbackText?: string | null;
}): string {
  const fallback = (input.fallbackText || '').trim();
  if (input.messageType !== 'system') return fallback;

  const type = (input.systemType || '').trim().toLowerCase();
  const data = input.systemData || null;
  const actor = actorLabel(data);
  const target = targetLabel(data);

  switch (type) {
    case 'group_created':
      return `${actor} created the group chat`;
    case 'member_added':
    case 'group_member_added':
      return `${actor} added ${target}`;
    case 'member_removed':
    case 'group_member_removed':
      return `${actor} removed ${target}`;
    case 'retention_changed':
    case 'group_retention_changed': {
      const days = asNumber(data?.retentionDays ?? data?.retention_days ?? data?.newRetentionDays);
      return days ? `${actor} changed retention to ${days} days` : `${actor} changed retention settings`;
    }
    case 'retention_requested': {
      const days = asNumber(data?.retentionDays ?? data?.retention_days ?? data?.requestedDays);
      return days ? `${actor} requested retention change to ${days} days` : `${actor} requested a retention change`;
    }
    case 'retention_request_declined':
      return `${actor} declined a retention change request`;
    case 'dm_e2ee_upgraded':
      return 'This DM is now encrypted and keys have been synced to account holders.';
    case 'avatar_changed':
    case 'group_avatar_changed':
      return `${actor} changed the group photo`;
    case 'group_owner_changed':
      return `${actor} made ${target} the group owner`;
    case 'call_started':
      return `${actor} started a call`;
    case 'call_declined':
      return `${actor} declined the call`;
    case 'call_cancelled':
      return `${actor} cancelled the call`;
    case 'call_missed':
      return fallback || 'Missed call';
    case 'call_ended': {
      const duration = formatDuration(data?.durationSeconds ?? data?.duration_seconds ?? data?.duration);
      return duration ? `Call lasted ${duration}` : (fallback || 'Call ended');
    }
    case 'central_limit_warning':
      return (
        asString(data?.warningText)
        || "Modified Clients are welcomed but not to overwhelm central's resources! If you continue this or attempt to override Central's Limitations your account will be limited."
      );
    case 'central_account_limited': {
      const limitedUntil = asNumber(data?.limitedUntil);
      const untilLabel = limitedUntil
        ? new Date(limitedUntil * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : null;
      return untilLabel
        ? `This account has been limited by Central: DM and group-chat calls are disabled until ${untilLabel}.`
        : 'This account has been limited by Central: DM and group-chat calls are disabled for 14 days.';
    }
    default:
      return fallback || 'System message';
  }
}
