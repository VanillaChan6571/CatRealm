type ComposerEmoteSuggestionItem = {
  label: string;
  previewImage?: string;
  previewEmoji?: string;
};

type ComposerEmoteSuggestionListProps<T extends ComposerEmoteSuggestionItem> = {
  open: boolean;
  items: T[];
  activeIndex: number;
  onSelect: (item: T) => void;
};

export function ComposerEmoteSuggestionList<T extends ComposerEmoteSuggestionItem>({
  open,
  items,
  activeIndex,
  onSelect,
}: ComposerEmoteSuggestionListProps<T>) {
  if (!open || items.length === 0) return null;

  return (
    <div className="bg-bg-elevated border border-border rounded shadow-lg text-xs max-h-56 overflow-y-auto">
      {items.map((item, idx) => (
        <button
          key={`${item.label}-${idx}`}
          type="button"
          onClick={() => onSelect(item)}
          className={`w-full text-left px-3 py-1.5 hover:bg-bg-hover/60 flex items-center gap-2 ${
            idx === activeIndex ? 'bg-bg-hover/60 text-text-primary' : 'text-text-secondary'
          }`}
        >
          {item.previewImage ? (
            <img src={item.previewImage} alt={item.label} className="w-5 h-5 object-contain rounded" loading="lazy" />
          ) : (
            <span className="w-5 text-center">{item.previewEmoji || '🙂'}</span>
          )}
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
