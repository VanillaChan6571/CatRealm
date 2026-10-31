import { useState, useEffect, useRef, useCallback } from 'react';
import { createApi } from '../../lib/api';
import { resolveAvatarUrl } from '../../utils/avatar';
import { formatMessageTime } from '../../utils/formatTime';
import { AvatarImage } from '../ui/AvatarImage';
import { parseDmContextText } from '../../lib/dmContext';
import { stripExpressionTokensForLinkScan } from '../../messaging/chatlib/messageTokenParser';
import type { DMMessage } from '../../types';
import {
  SearchFilterModal,
  EMPTY_FILTERS,
  countActiveFilters,
  resolveDateBounds,
  type SearchFilters,
  type ContentType,
} from './SearchFilterModal';

// ── Types ────────────────────────────────────────────────────────────────────

type ServerResult = {
  id: string;
  content: string;
  created_at: number; // unix seconds
  username: string;
  display_name?: string | null;
  avatar: string | null;
  role_color?: string | null;
};

type NormalizedResult = {
  messageId: string;
  content: string;
  timestamp: number; // unix seconds
  authorName: string;
  authorAvatarUrl: string;
  roleColor?: string | null;
};

export type SuggestionMember = {
  id: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
};

export type SuggestionChannel = {
  id: string;
  name: string;
};

export type ChatSearchPanelProps = {
  open: boolean;
  onClose: () => void;
  timeFormat?: '12' | '24';

  // Server-channel mode
  channelId?: string | null;
  serverUrl?: string | null;
  members?: SuggestionMember[];
  channels?: SuggestionChannel[];

  // DM mode
  dmMessages?: DMMessage[];
  selfId?: string;
  selfName?: string;
  selfAvatarUrl?: string;
  otherName?: string;
  otherAvatarUrl?: string;
  /** Whether older DM history exists beyond what's loaded (enables "search older"). */
  dmHasOlder?: boolean;
  /** Loads one older page into the store; resolves to whether more remain. */
  onLoadOlderDM?: () => Promise<boolean>;

  onJump: (messageId: string, timestamp: number) => void;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) {
    const display = text.length > 160 ? text.slice(0, 160) + '…' : text;
    return <span>{display}</span>;
  }

  const lText = text.toLowerCase();
  const lQuery = query.toLowerCase();
  const idx = lText.indexOf(lQuery);

  if (idx === -1) {
    const display = text.length > 160 ? text.slice(0, 160) + '…' : text;
    return <span>{display}</span>;
  }

  const ctxStart = Math.max(0, idx - 45);
  const ctxEnd = Math.min(text.length, idx + query.length + 90);
  const before = text.slice(ctxStart, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length, ctxEnd);

  return (
    <span>
      {ctxStart > 0 && <span className="text-text-muted">…</span>}
      {before}
      <mark className="bg-yellow-400/25 text-yellow-200 rounded-sm px-0.5 not-italic font-medium">{match}</mark>
      {after}
      {ctxEnd < text.length && <span className="text-text-muted">…</span>}
    </span>
  );
}

function ResultCard({
  result,
  query,
  timeFormat,
  onJump,
}: {
  result: NormalizedResult;
  query: string;
  timeFormat?: '12' | '24';
  onJump: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const ts = formatMessageTime(result.timestamp, timeFormat ?? '12');

  return (
    <div
      className="relative px-4 py-3 border-b border-border/50 hover:bg-bg-hover/40 transition-colors cursor-pointer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onJump}
    >
      {hovered && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onJump(); }}
          className="absolute top-2 right-3 text-[11px] font-semibold px-2 py-0.5 rounded bg-accent text-white hover:bg-accent/80 transition-colors z-10"
        >
          Jump
        </button>
      )}

      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-full overflow-hidden shrink-0">
          <AvatarImage
            src={result.authorAvatarUrl}
            alt={result.authorName}
            size={24}
            className="w-full h-full object-cover"
            fallback={<span className="text-[10px]">{result.authorName.charAt(0).toUpperCase()}</span>}
          />
        </div>
        <span
          className="text-sm font-semibold truncate"
          style={{ color: result.roleColor || undefined }}
        >
          {result.authorName}
        </span>
        <span className="text-xs text-text-muted shrink-0">{ts}</span>
      </div>

      <p className="text-sm text-text-secondary leading-relaxed pl-8 break-words">
        <HighlightedText text={result.content} query={query} />
      </p>
    </div>
  );
}

// ── Inline query parser ───────────────────────────────────────────────────────

const VALID_HAS: ContentType[] = ['image', 'video', 'file', 'link', 'embed', 'sticker', 'forward'];

/**
 * Parse `operator:value` tokens out of raw query text.
 * Returns the remaining plain text and any filters extracted inline.
 *
 * Supported: from:user  has:image  mentions:user  before:YYYY-MM-DD  after:YYYY-MM-DD  on:YYYY-MM-DD
 */
function parseInlineOperators(raw: string): { textQuery: string; inlineFilters: SearchFilters } {
  const inlineFilters: SearchFilters = { from: [], has: [], mentions: [], dates: [] };
  // Match  operator:"quoted value"  or  operator:value  (no spaces in value)
  const opRe = /\b(from|has|mentions?|before|after|on):("([^"]+)"|(\S+))/gi;
  let match: RegExpExecArray | null;

  while ((match = opRe.exec(raw)) !== null) {
    const op = match[1].toLowerCase();
    const value = (match[3] ?? match[4] ?? '').trim();
    if (!value) continue;

    switch (op) {
      case 'from':
        if (!inlineFilters.from.includes(value)) inlineFilters.from.push(value);
        break;
      case 'has': {
        const h = value as ContentType;
        if (VALID_HAS.includes(h) && !inlineFilters.has.includes(h)) inlineFilters.has.push(h);
        break;
      }
      case 'mention':
      case 'mentions': {
        const u = value.replace(/^@/, '');
        if (!inlineFilters.mentions.includes(u)) inlineFilters.mentions.push(u);
        break;
      }
      case 'before':
        inlineFilters.dates.push({ op: 'before', date: value });
        break;
      case 'after':
        inlineFilters.dates.push({ op: 'after', date: value });
        break;
      case 'on':
        inlineFilters.dates.push({ op: 'on', date: value });
        break;
    }
  }

  const textQuery = raw.replace(opRe, '').replace(/\s{2,}/g, ' ').trim();
  return { textQuery, inlineFilters };
}

/** Merge modal filters + inline-parsed filters, deduplicating values. */
function mergeFilters(modal: SearchFilters, inline: SearchFilters): SearchFilters {
  return {
    from:     [...new Set([...modal.from,     ...inline.from])],
    has:      [...new Set([...modal.has,      ...inline.has])]  as ContentType[],
    mentions: [...new Set([...modal.mentions, ...inline.mentions])],
    dates:    [...modal.dates, ...inline.dates],
  };
}

// ── Autocomplete helpers ──────────────────────────────────────────────────────

type AutoCtx = {
  type: 'from' | 'in' | 'has' | 'mentions';
  partial: string;    // text after the colon (# stripped for 'in')
  tokenStart: number; // char index where the partial value starts (after colon)
  tokenEnd: number;   // current cursor position
};

type AutoSuggestion = {
  id: string;
  label: string;       // display name, channel name, or has-type
  sublabel?: string;   // @username when displayName differs
  avatarUrl?: string;
  isChannel?: boolean;
  isHas?: boolean;
  icon?: string;
};

/**
 * Detect if the cursor is positioned inside a `from:partial` or `in:partial`
 * token and return the context for autocomplete.
 */
const HAS_SUGGESTIONS: AutoSuggestion[] = [
  { id: 'image',   label: 'image',   icon: '🖼️',  isHas: true },
  { id: 'video',   label: 'video',   icon: '🎬',  isHas: true },
  { id: 'file',    label: 'file',    icon: '📎',  isHas: true },
  { id: 'link',    label: 'link',    icon: '🔗',  isHas: true },
  { id: 'embed',   label: 'embed',   icon: '🪆',  isHas: true },
  { id: 'sticker', label: 'sticker', icon: '🎭',  isHas: true },
  { id: 'forward', label: 'forward', icon: '↪️',  isHas: true },
];

function detectAutocomplete(value: string, cursorPos: number): AutoCtx | null {
  const before = value.slice(0, cursorPos);
  const match = before.match(/(?:^|\s)(from|in|has|mentions?):(#?[^\s,]*)$/i);
  if (!match) return null;
  const rawOp = match[1].toLowerCase();
  const type = (rawOp === 'mention' ? 'mentions' : rawOp) as AutoCtx['type'];
  const rawPartial = match[2];                      // e.g. "van", "#gen", "im"
  const partial = rawPartial.replace(/^#/, '');     // strip leading #
  if (!partial && type !== 'has') return null;      // has: shows all options even with no partial
  const tokenStart = cursorPos - rawPartial.length;
  return { type, partial, tokenStart, tokenEnd: cursorPos };
}

// ── DM has-filter helper ──────────────────────────────────────────────────────

function matchHasDM(m: DMMessage, type: ContentType): boolean {
  const allMimes = [
    ...(m.attachments ?? []).map((a) => (a as { mime?: string }).mime ?? ''),
    m.attachmentType ?? '',
  ].filter(Boolean);

  switch (type) {
    case 'image': return allMimes.some((mime) => mime.startsWith('image/'));
    case 'video': return allMimes.some((mime) => mime.startsWith('video/'));
    case 'file': return allMimes.length > 0 || !!m.attachmentUrl;
    case 'link':
    case 'embed': return /https?:\/\//.test(stripExpressionTokensForLinkScan(m.text ?? ''));
    case 'sticker': return false;
    case 'forward': {
      const parsed = parseDmContextText(m.text ?? '');
      return parsed?.kind === 'forward';
    }
    default: return false;
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export function ChatSearchPanel({
  open,
  onClose,
  timeFormat,
  channelId,
  serverUrl,
  members,
  channels,
  dmMessages,
  selfId,
  selfName,
  selfAvatarUrl,
  otherName,
  otherAvatarUrl,
  dmHasOlder,
  onLoadOlderDM,
  onJump,
}: ChatSearchPanelProps) {
  const isDMMode = !channelId && dmMessages !== undefined;

  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [results, setResults] = useState<NormalizedResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [oldestTimestamp, setOldestTimestamp] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  // Autocomplete state
  const [autoCtx, setAutoCtx] = useState<AutoCtx | null>(null);
  const [autoSuggestions, setAutoSuggestions] = useState<AutoSuggestion[]>([]);
  const [autoIdx, setAutoIdx] = useState(0);

  const activeFilterCount = countActiveFilters(filters);
  const { textQuery: _tq, inlineFilters } = parseInlineOperators(query);
  const inlineFilterCount = countActiveFilters(inlineFilters);

  // Auto-focus / reset on open/close
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setResults([]);
      setHasMore(false);
      setOldestTimestamp(null);
      setFilterOpen(false);
      setAutoCtx(null);
      setAutoSuggestions([]);
    }
  }, [open]);

  // ESC closes panel (autocomplete first, then filter modal, then panel)
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (autoCtx) { setAutoCtx(null); setAutoSuggestions([]); }
        else if (filterOpen) setFilterOpen(false);
        else onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, filterOpen, autoCtx]);

  // ── Autocomplete ──────────────────────────────────────────────────────────

  const updateAutocomplete = useCallback((value: string, cursorPos: number) => {
    const ctx = detectAutocomplete(value, cursorPos);
    if (!ctx) { setAutoCtx(null); setAutoSuggestions([]); return; }

    let suggestions: AutoSuggestion[] = [];
    const lower = ctx.partial.toLowerCase();

    if (ctx.type === 'from' && members && members.length > 0) {
      suggestions = members
        .filter((m) =>
          m.username.toLowerCase().startsWith(lower) ||
          m.displayName?.toLowerCase().startsWith(lower)
        )
        .slice(0, 8)
        .map((m) => ({
          id: m.id,
          label: m.displayName || m.username,
          sublabel: m.displayName ? m.username : undefined,
          avatarUrl: m.avatar
            ? resolveAvatarUrl(m.avatar, serverUrl ?? '', 'local') ?? undefined
            : undefined,
        }));
    } else if (ctx.type === 'in' && channels && channels.length > 0) {
      suggestions = channels
        .filter((c) => c.name.toLowerCase().startsWith(lower))
        .slice(0, 8)
        .map((c) => ({ id: c.id, label: c.name, isChannel: true }));
    } else if (ctx.type === 'has') {
      suggestions = HAS_SUGGESTIONS.filter((s) => s.label.startsWith(lower));
    } else if (ctx.type === 'mentions' && members && members.length > 0) {
      suggestions = members
        .filter((m) =>
          m.username.toLowerCase().startsWith(lower) ||
          m.displayName?.toLowerCase().startsWith(lower)
        )
        .slice(0, 8)
        .map((m) => ({
          id: m.id,
          label: m.displayName || m.username,
          sublabel: m.displayName ? m.username : undefined,
          avatarUrl: m.avatar
            ? resolveAvatarUrl(m.avatar, serverUrl ?? '', 'local') ?? undefined
            : undefined,
        }));
    }

    if (suggestions.length === 0) { setAutoCtx(null); setAutoSuggestions([]); return; }
    setAutoCtx(ctx);
    setAutoSuggestions(suggestions);
    setAutoIdx(0);
  }, [members, channels, serverUrl]);

  const completeSuggestion = useCallback((suggestion: AutoSuggestion, ctx: AutoCtx) => {
    const value = ctx.type === 'in' ? `#${suggestion.label}` : suggestion.label;
    const newQuery = query.slice(0, ctx.tokenStart) + value + ' ' + query.slice(ctx.tokenEnd).trimStart();
    setQuery(newQuery);
    setAutoCtx(null);
    setAutoSuggestions([]);
    const newCursor = ctx.tokenStart + value.length + 1;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newCursor, newCursor);
    });
  }, [query]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    updateAutocomplete(val, e.target.selectionStart ?? val.length);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!autoCtx || autoSuggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAutoIdx((i) => Math.min(i + 1, autoSuggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAutoIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      completeSuggestion(autoSuggestions[autoIdx], autoCtx);
    }
    // Escape handled by the global listener above
  };

  const handleInputClick = () => {
    if (inputRef.current) {
      updateAutocomplete(query, inputRef.current.selectionStart ?? query.length);
    }
  };

  // ── DM search (in-memory) ──────────────────────────────────────────────────

  const searchDM = useCallback((q: string, f: SearchFilters) => {
    if (!dmMessages) return;

    const hasAnyFilter = q.trim() || countActiveFilters(f) > 0;
    if (!hasAnyFilter) { setResults([]); setHasMore(false); return; }

    let matched = dmMessages.filter((m) => m.messageType !== 'system');

    // Text query
    if (q.trim()) {
      const lower = q.toLowerCase();
      matched = matched.filter((m) => m.text?.toLowerCase().includes(lower));
    }

    // From filter
    if (f.from.length > 0) {
      const fromLower = f.from.map((u) => u.toLowerCase());
      matched = matched.filter((m) => {
        const isOwn = m.senderId === selfId;
        const name = (isOwn ? selfName : otherName) ?? '';
        return fromLower.some((u) => name.toLowerCase().includes(u));
      });
    }

    // Has filter
    if (f.has.length > 0) {
      matched = matched.filter((m) => f.has.some((type) => matchHasDM(m, type)));
    }

    // Mentions filter
    if (f.mentions.length > 0) {
      const mentionsLower = f.mentions.map((u) => u.toLowerCase());
      matched = matched.filter((m) =>
        mentionsLower.some((u) => m.text?.toLowerCase().includes('@' + u))
      );
    }

    // Date filters
    const { dateAfter, dateBefore } = resolveDateBounds(f.dates);
    if (dateAfter !== null) {
      matched = matched.filter((m) => Math.floor(m.createdAt / 1000) >= dateAfter);
    }
    if (dateBefore !== null) {
      matched = matched.filter((m) => Math.floor(m.createdAt / 1000) < dateBefore);
    }

    const normalised: NormalizedResult[] = matched
      .slice()
      .reverse() // newest first
      .map((m) => {
        const isOwn = m.senderId === selfId;
        return {
          messageId: m.id,
          content: m.text ?? '',
          timestamp: Math.floor(m.createdAt / 1000),
          authorName: isOwn ? (selfName ?? 'You') : (otherName ?? 'User'),
          authorAvatarUrl: isOwn ? (selfAvatarUrl ?? '') : (otherAvatarUrl ?? ''),
        };
      });

    setResults(normalised);
    // Older encrypted history can still be paged in and searched client-side.
    setHasMore(Boolean(dmHasOlder && onLoadOlderDM));
  }, [dmMessages, selfId, selfName, selfAvatarUrl, otherName, otherAvatarUrl, dmHasOlder, onLoadOlderDM]);

  // ── Server search (API) ────────────────────────────────────────────────────

  const searchServer = useCallback(async (q: string, f: SearchFilters, before?: number, append = false) => {
    if (!channelId) return;

    const hasAnyFilter = q.trim() || countActiveFilters(f) > 0;
    if (!hasAnyFilter) {
      if (!append) { setResults([]); setHasMore(false); }
      return;
    }

    if (append) setLoadingMore(true);
    else setLoading(true);

    try {
      const api = createApi();
      const params: Record<string, string | number> = { limit: 25 };
      if (q.trim()) params.q = q;
      if (before) params.before = before;

      // Filter params
      if (f.from.length > 0) params.from = f.from.join(',');
      if (f.has.length > 0) params.has = f.has.join(',');
      if (f.mentions.length > 0) params.mentions = f.mentions.join(',');

      const { dateAfter, dateBefore } = resolveDateBounds(f.dates);
      if (dateAfter !== null) params.date_after = dateAfter;
      if (dateBefore !== null) params.date_before = dateBefore;

      const res = await api.get(`/api/messages/${channelId}/search`, { params });
      const raw: ServerResult[] = res.data.results ?? [];
      const more: boolean = res.data.hasMore ?? false;

      const normalised: NormalizedResult[] = raw.map((m) => ({
        messageId: m.id,
        content: m.content ?? '',
        timestamp: m.created_at,
        authorName: m.display_name || m.username,
        authorAvatarUrl: resolveAvatarUrl(m.avatar ?? undefined, serverUrl ?? '', 'local') ?? '',
        roleColor: m.role_color,
      }));

      if (append) {
        setResults((prev) => [...prev, ...normalised]);
      } else {
        setResults(normalised);
      }
      setHasMore(more);
      // Prefer the server's resume cursor: with the secure-mode scan cap a page
      // can come back short (or empty) while older history remains.
      const nextBefore: number | null = res.data.nextBefore ?? null;
      if (nextBefore) {
        setOldestTimestamp(nextBefore);
      } else if (normalised.length > 0) {
        setOldestTimestamp(normalised[normalised.length - 1].timestamp);
      }
    } catch {
      if (!append) setResults([]);
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }, [channelId, serverUrl]);

  // ── Debounced search trigger ───────────────────────────────────────────────

  useEffect(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    setResults([]);
    setHasMore(false);
    setOldestTimestamp(null);

    const { textQuery, inlineFilters } = parseInlineOperators(query);
    const effectiveFilters = mergeFilters(filters, inlineFilters);
    const hasAny = textQuery || countActiveFilters(effectiveFilters) > 0;
    if (!hasAny) return;

    debounceRef.current = window.setTimeout(() => {
      if (isDMMode) searchDM(textQuery, effectiveFilters);
      else void searchServer(textQuery, effectiveFilters);
    }, 350);

    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [query, filters, isDMMode, searchDM, searchServer]);

  const handleLoadMore = () => {
    if (!hasMore || loadingMore) return;
    if (isDMMode) {
      // E2E-encrypted DMs can't be searched server-side: page older history into
      // the store (decrypted locally) and re-filter. Capped per click so a huge
      // conversation can't spin an unbounded decrypt loop.
      if (!onLoadOlderDM) return;
      setLoadingMore(true);
      void (async () => {
        try {
          for (let i = 0; i < 10; i++) {
            const more = await onLoadOlderDM();
            if (!more) break;
          }
        } finally {
          setLoadingMore(false);
        }
      })();
      return;
    }
    if (!oldestTimestamp) return;
    const { textQuery, inlineFilters } = parseInlineOperators(query);
    void searchServer(textQuery, mergeFilters(filters, inlineFilters), oldestTimestamp, true);
  };

  const handleJump = (result: NormalizedResult) => {
    onJump(result.messageId, result.timestamp);
  };

  const handleApplyFilters = (f: SearchFilters) => {
    setFilters(f);
    setFilterOpen(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!open) return null;

  const hasAnySearch = query.trim() || activeFilterCount > 0 || inlineFilterCount > 0;

  return (
    <>
      {/* Backdrop for mobile / click-outside */}
      <div
        className="absolute inset-0 z-10 md:hidden"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="absolute top-0 right-0 bottom-0 w-[420px] max-w-full z-20 flex flex-col bg-bg-elevated border-l border-border shadow-2xl">
        {/* Header */}
        <div className="shrink-0 px-3 py-3 border-b border-border flex items-center gap-2">
          <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onClick={handleInputClick}
            placeholder="Search… or from:user has:image"
            className="flex-1 bg-transparent outline-none text-text-primary text-sm placeholder:text-text-muted min-w-0"
            aria-label="Search messages"
            autoComplete="off"
          />

          {/* Filter button */}
          <button
            type="button"
            onClick={() => setFilterOpen((v) => !v)}
            className={`relative shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
              filterOpen || activeFilterCount > 0
                ? 'bg-accent/20 text-accent'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
            }`}
            title="Advanced filters"
            aria-label="Advanced filters"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M3 6h18M7 12h10M11 18h2" />
            </svg>
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center rounded-full bg-accent text-white text-[9px] font-bold leading-none">
                {activeFilterCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors shrink-0 p-0.5"
            title="Close (Escape)"
            aria-label="Close search"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Autocomplete suggestions */}
        {autoCtx && autoSuggestions.length > 0 && (
          <div className="shrink-0 border-b border-border bg-bg-elevated shadow-lg z-10">
            <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              {autoCtx.type === 'in' ? 'Channels' : autoCtx.type === 'has' ? 'Content type' : 'Members'}
            </div>
            {autoSuggestions.map((s, i) => (
              <div
                key={s.id}
                className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors ${
                  i === autoIdx ? 'bg-accent/20' : 'hover:bg-bg-hover'
                }`}
                onMouseEnter={() => setAutoIdx(i)}
                onMouseDown={(e) => { e.preventDefault(); completeSuggestion(s, autoCtx); }}
              >
                {s.isHas ? (
                  <span className="w-6 h-6 flex items-center justify-center text-base shrink-0">{s.icon}</span>
                ) : s.isChannel ? (
                  <span className="w-6 h-6 rounded flex items-center justify-center bg-bg-hover text-text-muted text-sm font-bold shrink-0">#</span>
                ) : s.avatarUrl ? (
                  <AvatarImage
                    src={s.avatarUrl}
                    alt={s.label}
                    size={24}
                    className="w-6 h-6 rounded-full object-cover shrink-0"
                    fallback={<span className="text-[10px]">{s.label.charAt(0).toUpperCase()}</span>}
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-bg-hover flex items-center justify-center text-[10px] text-text-muted shrink-0">
                    {s.label.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-sm text-text-primary font-medium truncate">{s.label}</span>
                {s.sublabel && <span className="text-xs text-text-muted truncate">@{s.sublabel}</span>}
                {i === autoIdx && (
                  <span className="ml-auto text-[10px] text-text-muted shrink-0 opacity-60">Tab</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Active filter chips summary */}
        {activeFilterCount > 0 && !filterOpen && (
          <div className="shrink-0 px-3 py-2 bg-accent/5 border-b border-border/60 flex flex-wrap gap-1.5 items-center">
            {filters.from.map((u) => (
              <span key={`from:${u}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-bg-hover border border-border text-text-secondary">
                from: <span className="font-medium text-text-primary">{u}</span>
                <button
                  type="button"
                  onClick={() => setFilters((f) => ({ ...f, from: f.from.filter((x) => x !== u) }))}
                  className="text-text-muted hover:text-text-primary leading-none"
                >×</button>
              </span>
            ))}
            {filters.has.map((h) => (
              <span key={`has:${h}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-bg-hover border border-border text-text-secondary">
                has: <span className="font-medium text-text-primary">{h}</span>
                <button
                  type="button"
                  onClick={() => setFilters((f) => ({ ...f, has: f.has.filter((x) => x !== h) }))}
                  className="text-text-muted hover:text-text-primary leading-none"
                >×</button>
              </span>
            ))}
            {filters.mentions.map((u) => (
              <span key={`mentions:${u}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-bg-hover border border-border text-text-secondary">
                mentions: <span className="font-medium text-text-primary">@{u}</span>
                <button
                  type="button"
                  onClick={() => setFilters((f) => ({ ...f, mentions: f.mentions.filter((x) => x !== u) }))}
                  className="text-text-muted hover:text-text-primary leading-none"
                >×</button>
              </span>
            ))}
            {filters.dates.map((d, i) => (
              <span key={`date:${i}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-bg-hover border border-border text-text-secondary">
                {d.op}: <span className="font-medium text-text-primary">{d.date}</span>
                <button
                  type="button"
                  onClick={() => setFilters((f) => ({ ...f, dates: f.dates.filter((_, j) => j !== i) }))}
                  className="text-text-muted hover:text-text-primary leading-none"
                >×</button>
              </span>
            ))}
          </div>
        )}

        {/* Inline-parsed operator chips */}
        {inlineFilterCount > 0 && !filterOpen && (
          <div className="shrink-0 px-3 py-2 border-b border-border/60 flex flex-wrap gap-1.5 items-center">
            <span className="text-[10px] text-text-muted uppercase tracking-wide shrink-0">Inline:</span>
            {inlineFilters.from.map((u) => (
              <span key={`ifrom:${u}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-sky-500/10 border border-sky-500/30 text-sky-300">
                from: <span className="font-medium">{u}</span>
              </span>
            ))}
            {inlineFilters.has.map((h) => (
              <span key={`ihas:${h}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-sky-500/10 border border-sky-500/30 text-sky-300">
                has: <span className="font-medium">{h}</span>
              </span>
            ))}
            {inlineFilters.mentions.map((u) => (
              <span key={`imentions:${u}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-sky-500/10 border border-sky-500/30 text-sky-300">
                mentions: <span className="font-medium">@{u}</span>
              </span>
            ))}
            {inlineFilters.dates.map((d, i) => (
              <span key={`idate:${i}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-sky-500/10 border border-sky-500/30 text-sky-300">
                {d.op}: <span className="font-medium">{d.date}</span>
              </span>
            ))}
          </div>
        )}

        {/* DM note */}
        {isDMMode && (
          <div className="shrink-0 px-4 py-2 bg-bg-chat/50 border-b border-border/40 text-xs text-text-muted">
            Messages are end-to-end encrypted — search runs on this device and can page in older history.
          </div>
        )}

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {/* Empty / idle state */}
          {!hasAnySearch && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted px-6 text-center">
              <svg className="w-10 h-10 opacity-30" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <p className="text-sm">Search for messages in this {isDMMode ? 'conversation' : 'channel'}</p>
              <p className="text-xs opacity-60">Use the filter button, or type operators directly:</p>
              <p className="text-xs opacity-50 font-mono">from:user  has:image  mentions:user</p>
              <p className="text-xs opacity-50 font-mono">before:2026-03-01  after:2026-01-01</p>
            </div>
          )}

          {/* Loading spinner */}
          {loading && (
            <div className="flex justify-center py-8">
              <svg className="w-5 h-5 animate-spin text-text-muted" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            </div>
          )}

          {/* No results */}
          {!loading && hasAnySearch && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-muted px-6 text-center">
              <svg className="w-8 h-8 opacity-30" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {query.trim()
                ? <p className="text-sm">No results for <strong className="text-text-secondary">"{query}"</strong></p>
                : <p className="text-sm">No results matching the applied filters</p>
              }
              {isDMMode && hasMore && (
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="text-sm text-accent hover:underline disabled:opacity-50 transition-opacity"
                >
                  {loadingMore ? 'Searching…' : 'Search older messages'}
                </button>
              )}
            </div>
          )}

          {/* Result list */}
          {!loading && results.length > 0 && (
            <>
              <div className="px-4 py-2 text-xs text-text-muted border-b border-border/40 flex items-center justify-between">
                <span>{results.length}{hasMore ? '+' : ''} result{results.length !== 1 ? 's' : ''}</span>
                {isDMMode && (
                  <span className="opacity-60">
                    Searched {dmMessages?.length ?? 0} message{(dmMessages?.length ?? 0) !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {results.map((r) => (
                <ResultCard
                  key={r.messageId}
                  result={r}
                  query={query}
                  timeFormat={timeFormat}
                  onJump={() => handleJump(r)}
                />
              ))}

              {hasMore && (
                <div className="px-4 py-3 flex justify-center">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="text-sm text-accent hover:underline disabled:opacity-50 transition-opacity"
                  >
                    {loadingMore ? 'Searching…' : (isDMMode ? 'Search older messages' : 'Load more results')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Filter modal (overlays the panel) */}
        {filterOpen && (
          <SearchFilterModal
            filters={filters}
            onApply={handleApplyFilters}
            onClose={() => setFilterOpen(false)}
            isDMMode={isDMMode}
          />
        )}
      </div>
    </>
  );
}
