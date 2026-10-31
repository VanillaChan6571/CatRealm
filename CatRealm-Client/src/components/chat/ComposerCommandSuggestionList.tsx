import { useMemo, useState } from 'react';
import { Bot as BotIcon } from 'lucide-react';
import { AvatarImage } from '../ui/AvatarImage';
import { resolveAvatarUrl } from '../../utils/avatar';
import type { BotCommand } from '../../types';

type ComposerCommandSuggestionListProps = {
  open: boolean;
  items: BotCommand[];
  activeIndex: number;
  serverUrl?: string | null;
  onSelect: (item: BotCommand) => void;
};

function CommandDescription({ text }: { text: string }) {
  const marker = text.toLowerCase().indexOf('only you');
  if (marker < 0) return <>{text}</>;
  const openParen = text.lastIndexOf('(', marker);
  const closeParen = text.indexOf(')', marker);
  const start = openParen >= 0 ? openParen : marker;
  const end = closeParen >= 0 ? closeParen + 1 : text.length;
  return (
    <>
      {text.slice(0, start)}
      <span className="font-medium text-yellow-400">{text.slice(start, end)}</span>
      {text.slice(end)}
    </>
  );
}

// Slash-command typeahead popup — mirrors ComposerMentionSuggestionList styling.
export function ComposerCommandSuggestionList({
  open,
  items,
  activeIndex,
  serverUrl,
  onSelect,
}: ComposerCommandSuggestionListProps) {
  const [selectedBotId, setSelectedBotId] = useState('all');
  const bots = useMemo(() => Array.from(new Map(items.map((item) => [item.botId, {
    id: item.botId,
    name: item.botDisplayName || item.botUsername,
  }])).values()), [items]);
  const effectiveSelectedBotId = selectedBotId === 'all' || items.some((item) => item.botId === selectedBotId)
    ? selectedBotId
    : 'all';
  const visibleItems = effectiveSelectedBotId === 'all'
    ? items
    : items.filter((item) => item.botId === effectiveSelectedBotId);

  if (!open || items.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-bg-elevated shadow-xl overflow-hidden">
      <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted border-b border-border">
        Commands
      </div>
      <div className="flex gap-1.5 overflow-x-auto border-b border-border px-2 py-2">
        {[{ id: 'all', name: 'All' }, ...bots].map((bot) => {
          const active = effectiveSelectedBotId === bot.id;
          return (
            <button
              key={bot.id}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                setSelectedBotId(bot.id);
              }}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                active
                  ? 'border-indigo-400 bg-indigo-500/15 text-indigo-300'
                  : 'border-border bg-bg-input text-text-muted hover:text-text-primary'
              }`}
            >
              {bot.name}
            </button>
          );
        })}
      </div>
      <ul className="max-h-64 overflow-y-auto py-1">
        {visibleItems.map((item) => (
          <li key={`${item.botId}:${item.name}`}>
            <button
              type="button"
              className={`w-full flex items-center gap-3 px-3 py-1.5 text-left ${
                items[activeIndex] === item ? 'bg-bg-hover' : 'hover:bg-bg-hover/60'
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(item);
              }}
            >
              <span className="w-6 h-6 rounded-full overflow-hidden bg-indigo-600/30 flex items-center justify-center text-white shrink-0">
                <AvatarImage
                  src={resolveAvatarUrl(item.botAvatar, serverUrl)}
                  alt={item.botUsername}
                  size={24}
                  className="w-6 h-6 object-cover"
                  fallback={<BotIcon className="w-3.5 h-3.5" />}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">/{item.name}</span>
                  {item.options.length > 0 && (
                    <span className="text-xs text-text-muted truncate">
                      {item.options.map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(' ')}
                    </span>
                  )}
                </span>
                {item.description && (
                  <span className="block text-xs text-text-muted truncate"><CommandDescription text={item.description} /></span>
                )}
              </span>
              <span className="text-xs text-text-muted shrink-0">
                {item.botDisplayName || item.botUsername}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
