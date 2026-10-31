import type { ReactNode } from 'react';
import { resolveAvatarUrl } from '../../utils/avatar';

type ComposerMentionSuggestionItem = {
  type: string;
  label: string;
  description?: string;
  avatar?: string | null;
  accountType?: 'local' | 'central' | 'bot';
};

type ComposerMentionSuggestionListProps<T extends ComposerMentionSuggestionItem> = {
  open: boolean;
  items: T[];
  activeIndex: number;
  onSelect: (item: T) => void;
  serverUrl?: string | null;
  authBase?: string;
};

const SECTION_LABELS: Record<string, string> = {
  system: 'System',
  role: 'Roles',
  user: 'Members',
  channel: 'Channels',
};

export function ComposerMentionSuggestionList<T extends ComposerMentionSuggestionItem>({
  open,
  items,
  activeIndex,
  onSelect,
  serverUrl,
  authBase,
}: ComposerMentionSuggestionListProps<T>) {
  if (!open || items.length === 0) return null;

  // 'alias' belongs to the 'system' section
  const sectionKey = (type: string) => (type === 'alias' ? 'system' : type);

  const nodes: ReactNode[] = [];
  let lastSection = '';

  items.forEach((item, idx) => {
    const sec = sectionKey(item.type);
    if (sec !== lastSection) {
      lastSection = sec;
      nodes.push(
        <div key={`section-${sec}-${idx}`} className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted select-none">
          {SECTION_LABELS[sec] ?? sec}
        </div>
      );
    }

    const isSystem = item.type === 'system' || item.type === 'alias';

    let iconNode: ReactNode;
    if (item.type === 'user' && (item.avatar !== undefined)) {
      const resolvedAvatar = resolveAvatarUrl(
        item.avatar ?? null,
        item.accountType === 'central' ? (authBase ?? null) : (serverUrl ?? null)
      );
      iconNode = resolvedAvatar ? (
        <img
          src={resolvedAvatar}
          alt={item.label}
          className="shrink-0 w-5 h-5 rounded-full object-cover"
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <span className="shrink-0 w-5 h-5 rounded-full bg-bg-hover flex items-center justify-center text-[10px] text-text-muted">
          {item.label.slice(1, 2).toUpperCase()}
        </span>
      );
    } else if (item.type === 'role') {
      iconNode = (
        <span className="shrink-0 w-5 h-5 flex items-center justify-center rounded bg-purple-500/20 text-purple-400 text-[10px] font-bold">
          R
        </span>
      );
    } else if (item.type === 'channel') {
      iconNode = (
        <span className="shrink-0 w-5 h-5 flex items-center justify-center rounded bg-bg-hover text-text-muted text-xs font-bold">
          #
        </span>
      );
    } else if (isSystem) {
      iconNode = (
        <span className="shrink-0 w-5 h-5 flex items-center justify-center rounded bg-accent/20 text-accent text-[10px] font-bold">
          @
        </span>
      );
    }

    nodes.push(
      <button
        key={`${item.type}-${item.label}-${idx}`}
        type="button"
        onClick={() => onSelect(item)}
        className={`w-full text-left px-3 py-1.5 hover:bg-bg-hover/60 flex items-center gap-2 ${
          idx === activeIndex ? 'bg-bg-hover/60 text-text-primary' : 'text-text-secondary'
        }`}
      >
        {iconNode}
        <span className="flex-1 min-w-0">
          <span className="truncate block">{item.label}</span>
          {item.description && (
            <span className="text-[10px] text-text-muted truncate block leading-tight">{item.description}</span>
          )}
        </span>
      </button>
    );
  });

  return (
    <div className="bg-bg-elevated border border-border rounded shadow-lg text-xs max-h-52 overflow-y-auto pb-1">
      {nodes}
    </div>
  );
}
