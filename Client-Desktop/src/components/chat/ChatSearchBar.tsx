import { useEffect, useRef } from 'react';

type ChatSearchBarProps = {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  currentMatch: number; // 0-based index
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
};

export function ChatSearchBar({
  query,
  onQueryChange,
  matchCount,
  currentMatch,
  onPrev,
  onNext,
  onClose,
}: ChatSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    } else if (e.key === 'F3') {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    }
  };

  const counterText = matchCount === 0
    ? (query ? 'No results' : '')
    : `${currentMatch + 1} of ${matchCount}`;

  return (
    <div className="shrink-0 px-4 py-2 border-b border-border bg-bg-chat flex items-center gap-2">
      <svg
        className="w-4 h-4 text-text-muted shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>

      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search messages..."
        className="flex-1 bg-transparent outline-none text-text-primary text-sm placeholder:text-text-muted min-w-0"
        aria-label="Search messages"
      />

      {query.length > 0 && (
        <span className={`text-xs shrink-0 tabular-nums ${matchCount === 0 ? 'text-danger' : 'text-text-muted'}`}>
          {counterText}
        </span>
      )}

      <button
        type="button"
        onClick={onPrev}
        disabled={matchCount === 0}
        className="text-text-muted hover:text-text-primary disabled:opacity-40 transition-colors p-0.5"
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m18 15-6-6-6 6" />
        </svg>
      </button>

      <button
        type="button"
        onClick={onNext}
        disabled={matchCount === 0}
        className="text-text-muted hover:text-text-primary disabled:opacity-40 transition-colors p-0.5"
        title="Next match (Enter)"
        aria-label="Next match"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <button
        type="button"
        onClick={onClose}
        className="text-text-muted hover:text-text-primary transition-colors p-0.5"
        title="Close (Escape)"
        aria-label="Close search"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
