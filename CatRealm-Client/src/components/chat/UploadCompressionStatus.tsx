import type { UploadCompressionStatus as Status, UploadCompressionSummary as Summary } from '../../hooks/useUploadCompression';

function formatMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Cat Lab upload compression: a progress line with a cancel button while a
 * file is being shrunk, then a short "before → after" line once it fits.
 */
export function UploadCompressionStatus({
  status,
  summary,
  onCancel,
}: {
  status: Status | null;
  summary?: Summary | null;
  onCancel: () => void;
}) {
  if (status) {
    const percent = Math.round(status.progress * 100);
    return (
      <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
        <span className="truncate">
          Compressing {status.fileName} to fit {status.limitMb} MB… {percent}%
        </span>
        <div className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-bg-hover">
          <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
        <button type="button" className="shrink-0 text-text-secondary hover:text-text-primary underline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }
  if (!summary?.length) return null;
  return (
    <div className="mt-1 space-y-0.5 text-xs text-text-muted">
      {summary.map((entry) => (
        <div key={entry.fileName} className="truncate">
          Compressed {entry.fileName}: {formatMb(entry.beforeBytes)} → {formatMb(entry.afterBytes)}
        </div>
      ))}
    </div>
  );
}
