type ChatLoadingSkeletonProps = {
  className?: string;
  showHeader?: boolean;
  showComposer?: boolean;
  messageCount?: number;
};

export function ChatLoadingSkeleton({
  className = '',
  showHeader = true,
  showComposer = true,
  messageCount = 7,
}: ChatLoadingSkeletonProps) {
  const rows = Array.from({ length: messageCount }, (_, index) => index);

  return (
    <div className={`flex flex-1 min-h-0 flex-col bg-bg-chat ${className}`.trim()}>
      {showHeader && (
        <div className="h-12 shrink-0 border-b border-border px-4">
          <div className="flex h-full items-center gap-3 animate-pulse">
            <div className="h-4 w-4 rounded bg-bg-elevated" />
            <div className="h-4 w-32 rounded bg-bg-elevated" />
            <div className="hidden h-3 w-48 rounded bg-bg-elevated/80 md:block" />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden px-4 py-5 md:px-6">
        <div className="space-y-5 animate-pulse">
          {rows.map((index) => {
            const compact = index % 3 === 1;
            const widthClass = index % 4 === 0
              ? 'w-[72%]'
              : index % 4 === 1
                ? 'w-[48%]'
                : index % 4 === 2
                  ? 'w-[62%]'
                  : 'w-[55%]';

            return (
              <div key={index} className={`flex gap-3 ${compact ? 'pl-11' : ''}`}>
                {!compact && <div className="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-bg-elevated" />}
                <div className="min-w-0 flex-1">
                  {!compact && (
                    <div className="mb-2 flex items-center gap-2">
                      <div className="h-3 w-24 rounded bg-bg-elevated" />
                      <div className="h-2.5 w-14 rounded bg-bg-elevated/70" />
                    </div>
                  )}
                  <div className={`h-3.5 rounded-full bg-bg-elevated/90 ${widthClass}`} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showComposer && (
        <div className="shrink-0 border-t border-border px-4 py-4 md:px-6">
          <div className="animate-pulse rounded-2xl border border-border bg-bg-elevated/70 px-4 py-3">
            <div className="h-4 w-[38%] rounded bg-bg-input" />
          </div>
        </div>
      )}
    </div>
  );
}
