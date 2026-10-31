import type { HTMLAttributes, ReactNode } from 'react';
import { X } from 'lucide-react';

type ComposerContextBanner = {
  kind: 'reply' | 'forward';
  label: ReactNode;
  preview?: ReactNode;
  onClear: () => void;
};

interface SharedComposerShellProps {
  replyBanner?: ComposerContextBanner | null;
  forwardBanner?: ComposerContextBanner | null;
  rowClassName?: string;
  rowProps?: HTMLAttributes<HTMLDivElement>;
  children: ReactNode;
}

function ContextBanner({ banner }: { banner: ComposerContextBanner }) {
  const accentClass = banner.kind === 'reply' ? 'text-accent' : 'text-blue-400';
  return (
    <div className="px-4 py-2 bg-bg-elevated border border-border rounded-t-lg flex items-center justify-between">
      <div className="text-xs text-text-muted truncate">
        {banner.label}
        {banner.preview ? (
          <>
            : <span className={accentClass}>{banner.preview}</span>
          </>
        ) : null}
      </div>
      <button
        type="button"
        onClick={banner.onClear}
        className="text-text-muted hover:text-text-primary"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function SharedComposerShell({
  replyBanner = null,
  forwardBanner = null,
  rowClassName = '',
  rowProps,
  children,
}: SharedComposerShellProps) {
  const hasContextBanner = !!(replyBanner || forwardBanner);
  return (
    <>
      {replyBanner ? <ContextBanner banner={replyBanner} /> : null}
      {forwardBanner ? <ContextBanner banner={forwardBanner} /> : null}
      <div
        {...rowProps}
        className={`bg-bg-input border border-border ${hasContextBanner ? 'rounded-b-lg border-t-0' : 'rounded-lg'} flex items-end relative ${rowClassName}`.trim()}
      >
        {children}
      </div>
    </>
  );
}
