export type OptionSuggestion = {
  key: string;
  label: string;
  color?: string | null;
};

type ComposerOptionSuggestionListProps = {
  open: boolean;
  title: string;
  items: OptionSuggestion[];
  activeIndex: number;
  onSelect: (item: OptionSuggestion) => void;
};

// Value picker for a slash command's first option (declared choices or roles).
export function ComposerOptionSuggestionList({ open, title, items, activeIndex, onSelect }: ComposerOptionSuggestionListProps) {
  if (!open || items.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-bg-elevated shadow-xl overflow-hidden">
      <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted border-b border-border">
        {title}
      </div>
      <ul className="max-h-64 overflow-y-auto py-1">
        {items.map((item, index) => (
          <li key={item.key}>
            <button
              type="button"
              className={`w-full px-3 py-1.5 text-left text-sm text-text-primary ${
                index === activeIndex ? 'bg-bg-hover' : 'hover:bg-bg-hover/60'
              }`}
              style={item.color ? { color: item.color } : undefined}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(item);
              }}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
