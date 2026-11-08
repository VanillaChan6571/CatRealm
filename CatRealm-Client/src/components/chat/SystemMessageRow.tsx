import type { ReactNode } from 'react';
import { formatSystemMessageText } from '../../lib/systemMessageText';

type SystemMessageRowProps = {
  messageType?: 'user' | 'system' | null;
  systemType?: string | null;
  systemData?: Record<string, unknown> | null;
  text?: string | null;
  timestampLabel?: string | null;
  actionLabel?: string;
  onAction?: () => void;
  icon?: ReactNode;
  className?: string;
  tone?: 'muted' | 'success';
};

export function SystemMessageRow({
  messageType = 'system',
  systemType = null,
  systemData = null,
  text = null,
  timestampLabel = null,
  actionLabel,
  onAction,
  icon,
  className,
  tone = 'muted',
}: SystemMessageRowProps) {
  if (systemType === 'official_announcement') {
    const title = typeof systemData?.title === 'string' ? systemData.title : 'Official announcement';
    const linkUrl = typeof systemData?.linkUrl === 'string' ? systemData.linkUrl : null;
    return (
      <div className={className || 'px-4 py-2'}>
        <article className="mx-auto max-w-2xl rounded-xl border border-accent/35 bg-accent/10 px-4 py-3 text-left shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <strong className="text-text-primary">✓ {title}</strong>
            {timestampLabel ? <time className="text-[10px] text-text-muted">{timestampLabel}</time> : null}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-text-secondary">{text}</p>
          {linkUrl ? <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold text-accent hover:underline">Open official link</a> : null}
        </article>
      </div>
    );
  }
  const label = formatSystemMessageText({
    messageType,
    systemType,
    systemData,
    fallbackText: text,
  });

  const isSuccess = tone === 'success';
  const containerToneClass = isSuccess
    ? 'border-emerald-500/40 bg-emerald-500/10'
    : 'border-border/70 bg-bg-elevated/70';
  const labelToneClass = isSuccess ? 'text-emerald-400' : 'text-yellow-400';

  return (
    <div className={className || 'px-4 py-2'}>
      <div className="flex items-center gap-3 text-xs text-text-muted">
        <div className="h-px flex-1 bg-border/60" />
        <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-center ${containerToneClass}`}>
          <span className="leading-none">{icon ?? '•'}</span>
          <span className={`break-words ${labelToneClass}`}>{label}</span>
          {timestampLabel ? <span className="text-[10px] opacity-80">• {timestampLabel}</span> : null}
          {actionLabel && onAction ? (
            <button
              type="button"
              className="ml-1 text-accent hover:underline"
              onClick={onAction}
            >
              {actionLabel}
            </button>
          ) : null}
        </div>
        <div className="h-px flex-1 bg-border/60" />
      </div>
    </div>
  );
}

