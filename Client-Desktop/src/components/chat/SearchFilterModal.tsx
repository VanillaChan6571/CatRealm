import { useState, useRef, type KeyboardEvent } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ContentType = 'image' | 'video' | 'file' | 'link' | 'embed' | 'sticker' | 'forward';
export type DateOp = 'before' | 'after' | 'on';
export type DateFilter = { op: DateOp; date: string }; // date = 'YYYY-MM-DD'

export type SearchFilters = {
  from: string[];
  has: ContentType[];
  mentions: string[];
  dates: DateFilter[];
};

export const EMPTY_FILTERS: SearchFilters = { from: [], has: [], mentions: [], dates: [] };

export function countActiveFilters(f: SearchFilters): number {
  return f.from.length + f.has.length + f.mentions.length + f.dates.filter((d) => d.date).length;
}

/** Convert date filter array to server-ready unix-second bounds (null if not set). */
export function resolveDateBounds(dates: DateFilter[]): { dateAfter: number | null; dateBefore: number | null } {
  let dateAfter: number | null = null;
  let dateBefore: number | null = null;

  for (const df of dates) {
    if (!df.date) continue;
    // Parse as local midnight
    const dayStart = Math.floor(new Date(df.date + 'T00:00:00').getTime() / 1000);
    const dayEnd = dayStart + 86400;

    if (df.op === 'after') {
      dateAfter = Math.max(dateAfter ?? 0, dayEnd); // strictly after the day
    } else if (df.op === 'before') {
      dateBefore = Math.min(dateBefore ?? Number.MAX_SAFE_INTEGER, dayStart); // before day starts
    } else {
      // on: message within the day
      dateAfter = Math.max(dateAfter ?? 0, dayStart);
      dateBefore = Math.min(dateBefore ?? Number.MAX_SAFE_INTEGER, dayEnd);
    }
  }

  return { dateAfter, dateBefore };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const HAS_OPTIONS: { value: ContentType; label: string; icon: string }[] = [
  { value: 'image', label: 'image', icon: '🖼️' },
  { value: 'video', label: 'video', icon: '🎬' },
  { value: 'file', label: 'file', icon: '📎' },
  { value: 'link', label: 'link', icon: '🔗' },
  { value: 'embed', label: 'embed', icon: '🪆' },
  { value: 'sticker', label: 'sticker', icon: '🎭' },
  { value: 'forward', label: 'forward', icon: '↪️' },
];

function TagInput({
  tags,
  placeholder,
  onChange,
}: {
  tags: string[];
  placeholder: string;
  onChange: (tags: string[]) => void;
}) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = (val: string) => {
    const trimmed = val.trim().replace(/^@/, '');
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInputValue('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 min-h-[38px] px-3 py-1.5 bg-bg-input border border-border rounded-lg cursor-text focus-within:border-accent/60 transition-colors"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-accent/20 text-accent text-xs font-medium"
        >
          {tag}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(tags.filter((t) => t !== tag)); }}
            className="text-accent/70 hover:text-accent leading-none"
            aria-label={`Remove ${tag}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (inputValue.trim()) addTag(inputValue); }}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[80px] bg-transparent outline-none text-sm text-text-primary placeholder:text-text-muted"
      />
    </div>
  );
}

function DateFilterRow({
  filter,
  onChange,
  onRemove,
}: {
  filter: DateFilter;
  onChange: (f: DateFilter) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <select
        value={filter.op}
        onChange={(e) => onChange({ ...filter, op: e.target.value as DateOp })}
        className="bg-bg-input border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent/60 transition-colors"
      >
        <option value="before">Before</option>
        <option value="after">After</option>
        <option value="on">On</option>
      </select>
      <input
        type="date"
        value={filter.date}
        onChange={(e) => onChange({ ...filter, date: e.target.value })}
        className="flex-1 bg-bg-input border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent/60 transition-colors [color-scheme:dark]"
      />
      <button
        type="button"
        onClick={onRemove}
        className="w-8 h-8 flex items-center justify-center rounded text-text-muted hover:text-danger transition-colors shrink-0"
        aria-label="Remove date filter"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
        </svg>
      </button>
    </div>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────────

type SearchFilterModalProps = {
  filters: SearchFilters;
  onApply: (filters: SearchFilters) => void;
  onClose: () => void;
  isDMMode?: boolean;
};

export function SearchFilterModal({ filters, onApply, onClose, isDMMode = false }: SearchFilterModalProps) {
  const [draft, setDraft] = useState<SearchFilters>(() => ({
    from: [...filters.from],
    has: [...filters.has],
    mentions: [...filters.mentions],
    dates: filters.dates.map((d) => ({ ...d })),
  }));

  const toggleHas = (type: ContentType) => {
    setDraft((prev) => ({
      ...prev,
      has: prev.has.includes(type) ? prev.has.filter((h) => h !== type) : [...prev.has, type],
    }));
  };

  const addDate = () => {
    const today = new Date().toISOString().slice(0, 10);
    setDraft((prev) => ({ ...prev, dates: [...prev.dates, { op: 'before', date: today }] }));
  };

  const updateDate = (idx: number, f: DateFilter) => {
    setDraft((prev) => {
      const dates = [...prev.dates];
      dates[idx] = f;
      return { ...prev, dates };
    });
  };

  const removeDate = (idx: number) => {
    setDraft((prev) => ({ ...prev, dates: prev.dates.filter((_, i) => i !== idx) }));
  };

  const activeCount = countActiveFilters(draft);

  // Stickers not supported in DM mode
  const visibleHasOptions = isDMMode
    ? HAS_OPTIONS.filter((o) => o.value !== 'sticker')
    : HAS_OPTIONS;

  return (
    <div className="absolute inset-0 z-30 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Slide-in from right */}
      <div className="relative z-10 ml-auto w-[420px] max-w-full flex flex-col bg-bg-elevated border-l border-border shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="font-semibold text-text-primary text-base">Filters</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors p-0.5"
            aria-label="Close filters"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6 min-h-0">
          {/* From */}
          <section>
            <h3 className="text-sm font-semibold text-text-primary mb-0.5">From</h3>
            <p className="text-xs text-text-muted mb-2">Sent by any of the selected users</p>
            <TagInput
              tags={draft.from}
              placeholder="ex. username"
              onChange={(tags) => setDraft((p) => ({ ...p, from: tags }))}
            />
          </section>

          {/* Has */}
          <section>
            <h3 className="text-sm font-semibold text-text-primary mb-0.5">Has</h3>
            <p className="text-xs text-text-muted mb-2">Includes any of the selected types of data</p>
            <div className="flex flex-wrap gap-2">
              {visibleHasOptions.map(({ value, label, icon }) => {
                const active = draft.has.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleHas(value)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm border transition-colors ${
                      active
                        ? 'bg-accent/20 border-accent text-accent'
                        : 'bg-transparent border-border text-text-secondary hover:border-text-muted'
                    }`}
                  >
                    <span>{icon}</span>
                    {label}
                    {active && (
                      <svg className="w-3 h-3 opacity-70" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Mentions */}
          <section>
            <h3 className="text-sm font-semibold text-text-primary mb-0.5">Mentions</h3>
            <p className="text-xs text-text-muted mb-2">Mentions any of the selected users</p>
            <TagInput
              tags={draft.mentions}
              placeholder="ex. username"
              onChange={(tags) => setDraft((p) => ({ ...p, mentions: tags }))}
            />
          </section>

          {/* Date */}
          <section>
            <h3 className="text-sm font-semibold text-text-primary mb-0.5">Date</h3>
            <p className="text-xs text-text-muted mb-2">When the message was sent</p>
            <div className="space-y-2">
              {draft.dates.map((d, i) => (
                <DateFilterRow
                  key={i}
                  filter={d}
                  onChange={(f) => updateDate(i, f)}
                  onRemove={() => removeDate(i)}
                />
              ))}
              <button
                type="button"
                onClick={addDate}
                className="w-full py-2 rounded-lg border border-dashed border-border text-sm text-text-muted hover:text-text-primary hover:border-text-muted transition-colors flex items-center justify-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add date
              </button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-4 border-t border-border flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setDraft(EMPTY_FILTERS)}
            disabled={activeCount === 0}
            className="text-sm text-accent hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-default transition-opacity"
          >
            Clear Filters{activeCount > 0 ? ` (${activeCount})` : ''}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-sm font-medium text-text-secondary bg-bg-hover hover:bg-border transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onApply(draft)}
              className="px-4 py-1.5 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/80 transition-colors"
            >
              Apply Filters
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
