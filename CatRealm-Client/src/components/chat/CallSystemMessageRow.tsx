import { Phone, PhoneMissed } from 'lucide-react';

type CallSystemMessageRowProps = {
  systemType: string;
  systemData: Record<string, unknown> | null;
  timestampLabel: string | null;
  activeCallId?: string | null;
  onJoinCall?: () => void;
  className?: string;
};

function formatDuration(raw: unknown): string | null {
  const total = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : null;
  if (total === null) return null;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function actorName(systemData: Record<string, unknown> | null): string {
  return (
    (systemData?.actorDisplayName as string | undefined) ||
    (systemData?.actorUsername as string | undefined) ||
    'Someone'
  );
}

export function CallSystemMessageRow({
  systemType,
  systemData,
  timestampLabel,
  activeCallId,
  onJoinCall,
  className,
}: CallSystemMessageRowProps) {
  const type = systemType.toLowerCase();
  const callId = systemData?.callId as string | undefined;

  const isEnded = type === 'call_ended';
  const isMissed = type === 'call_missed';
  const isCancelled = type === 'call_cancelled';
  const isDeclined = type === 'call_declined';
  const isStarted = type === 'call_started';

  const isCallStillActive = isStarted && activeCallId && activeCallId === callId;

  const IconComponent = isMissed || isCancelled || isDeclined ? PhoneMissed : Phone;
  const iconColor = isMissed || isCancelled || isDeclined ? 'text-danger' : 'text-emerald-400';

  let label: string;
  if (isStarted) {
    label = `${actorName(systemData)} started a call.`;
  } else if (isEnded) {
    const dur = formatDuration(systemData?.duration ?? systemData?.durationSeconds);
    label = dur ? `Call lasted ${dur}.` : 'Call ended.';
  } else if (isMissed) {
    label = 'Missed call.';
  } else if (isCancelled) {
    label = `${actorName(systemData)} cancelled the call.`;
  } else if (isDeclined) {
    label = `${actorName(systemData)} declined the call.`;
  } else {
    label = 'Call event.';
  }

  return (
    <div className={`px-4 py-2 ${className ?? ''}`}>
      <div className="flex items-center gap-3 text-xs text-text-muted">
        <div className="h-px flex-1 bg-border/60" />
        <div className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-bg-elevated/70 px-3 py-1">
          <IconComponent className={`w-3.5 h-3.5 shrink-0 ${iconColor}`} />
          <span className="text-text-muted">{label}</span>
          {isCallStillActive && onJoinCall && (
            <>
              <span>—</span>
              <button
                type="button"
                onClick={onJoinCall}
                className="text-accent hover:underline font-medium"
              >
                Join the call
              </button>
            </>
          )}
          {timestampLabel && (
            <span className="text-[10px] opacity-80">• {timestampLabel}</span>
          )}
        </div>
        <div className="h-px flex-1 bg-border/60" />
      </div>
    </div>
  );
}
