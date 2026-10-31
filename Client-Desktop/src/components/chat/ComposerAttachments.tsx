import { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { isArchiveFile } from '../../lib/archiveFiles';
import { Check } from 'lucide-react';

type NsfwTagKey = 'gore' | 'blood' | 'lewd' | 'spoiler';

type SingleAttachmentChipProps = {
  file: File;
  error?: string | null;
  sizeLabel?: string | null;
  onRemove: () => void;
  nsfwTagState?: Record<NsfwTagKey, boolean>;
  onToggleNsfwTag?: (tag: NsfwTagKey, value: boolean) => void;
};

export function ComposerSingleAttachmentChip({
  file,
  error,
  sizeLabel,
  onRemove,
  nsfwTagState,
  onToggleNsfwTag,
}: SingleAttachmentChipProps) {
  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  const isAudio = file.type.startsWith('audio/');

  useEffect(() => {
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  return (
    <div className="mb-3">
      <div className="inline-flex max-w-full items-start gap-3 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary">
        {(isImage || isVideo || isAudio) && (
          <div className="shrink-0">
            {isImage ? (
              <img src={previewUrl} alt={file.name} className="h-16 w-24 rounded border border-border object-cover" />
            ) : null}
            {isVideo ? (
              <video src={previewUrl} className="h-16 w-24 rounded border border-border bg-black object-cover" muted />
            ) : null}
            {isAudio ? (
              <audio src={previewUrl} controls className="w-56 max-w-[60vw]" />
            ) : null}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="max-w-[18rem] truncate">{file.name}</span>
            {sizeLabel ? <span className="text-text-muted">({sizeLabel})</span> : null}
            <button
              type="button"
              onClick={onRemove}
              className="text-text-muted hover:text-text-primary"
              title="Remove attachment"
            >
              ×
            </button>
          </div>
          {onToggleNsfwTag && nsfwTagState ? (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-text-secondary">
              <span className="text-text-muted">NSFW tags:</span>
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={!!nsfwTagState.lewd}
                  onChange={(e) => onToggleNsfwTag('lewd', e.target.checked)}
                />
                <span>Lewd</span>
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={!!nsfwTagState.blood}
                  onChange={(e) => onToggleNsfwTag('blood', e.target.checked)}
                />
                <span>Blood</span>
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={!!nsfwTagState.gore}
                  onChange={(e) => onToggleNsfwTag('gore', e.target.checked)}
                />
                <span>Gore</span>
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={!!nsfwTagState.spoiler}
                  onChange={(e) => onToggleNsfwTag('spoiler', e.target.checked)}
                />
                <span>Spoiler</span>
              </label>
            </div>
          ) : null}
        </div>
      </div>
      {error ? <span className="text-sm text-danger">{error}</span> : null}
    </div>
  );
}

type UploadStatus = 'uploading' | 'ready' | 'error';

export type ComposerUploadPreviewItem = {
  id: string;
  file: File;
  previewUrl: string;
  status: UploadStatus;
  progress: number;
};

type ComposerUploadPreviewStripProps<TItem extends ComposerUploadPreviewItem> = {
  items: TItem[];
  onRemove: (item: TItem) => void;
  onRetry?: (item: TItem) => void | Promise<void>;
  renderExtraBadge?: (item: TItem) => ReactNode;
  onInsertTag?: (tag: string) => void;
};

export function ComposerUploadPreviewStrip<TItem extends ComposerUploadPreviewItem>({
  items,
  onRemove,
  onRetry,
  renderExtraBadge,
  onInsertTag,
}: ComposerUploadPreviewStripProps<TItem>) {
  if (!items.length) return null;

  return (
    <div className="mt-3 relative">
      <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1 pr-6 scrollbar-thin">
        {items.map((item, index) => {
          const isVideo = item.file.type.startsWith('video/');
          const isArchive = isArchiveFile(item.file);
          const tag = `<?img${index + 1}>`;
          return (
            <div key={item.id} className="relative rounded border border-border bg-bg-elevated overflow-hidden shrink-0 w-48">
              {isArchive ? (
                <div className="w-full h-24 flex flex-col items-center justify-center gap-1 px-2 text-xs text-text-secondary">
                  <span className="text-2xl" aria-hidden>📦</span>
                  <span className="max-w-full truncate">{item.file.name}</span>
                </div>
              ) : isVideo ? (
                <video src={item.previewUrl} className="w-full h-24 object-cover" muted />
              ) : (
                <img src={item.previewUrl} alt={item.file.name} className="w-full h-24 object-cover" />
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2 text-xs text-white">
                {item.status === 'error' && onRetry ? (
                  <button
                    onClick={() => void onRetry(item)}
                    className="px-2 py-1 rounded bg-black/60 hover:bg-black/80"
                  >
                    Retry
                  </button>
                ) : null}
                <button
                  onClick={() => onRemove(item)}
                  className="px-2 py-1 rounded bg-black/60 hover:bg-black/80"
                >
                  Remove
                </button>
              </div>
              {onInsertTag && !isArchive && (
                <button
                  type="button"
                  onClick={() => onInsertTag(tag)}
                  className="absolute top-1 left-1 text-[10px] bg-[var(--color-accent)]/80 hover:bg-[var(--color-accent)] text-white rounded px-1 py-0.5 font-mono leading-tight"
                  title={`Click to insert ${tag} at cursor`}
                >
                  {tag}
                </button>
              )}
              <div className="p-1 text-[10px] text-text-muted truncate">{item.file.name}</div>
              {item.status === 'uploading' && (
                <div className="px-1 pb-1">
                  <div className="h-1 rounded bg-bg-hover">
                    <div
                      className="h-1 rounded bg-accent transition-all"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                </div>
              )}
              {item.status === 'ready' && (
                <div className="absolute top-1 right-1 text-xs bg-accent text-white rounded-full px-1.5 py-0.5">
                  <Check className="h-3 w-3" />
                </div>
              )}
              {item.status === 'error' && (
                <div className="absolute top-1 right-1 text-xs bg-danger text-white rounded-full px-1.5 py-0.5">
                  !
                </div>
              )}
              {renderExtraBadge ? renderExtraBadge(item) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
