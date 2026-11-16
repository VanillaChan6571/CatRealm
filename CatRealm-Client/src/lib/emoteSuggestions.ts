import type { EmoteSuggestion, ExpressionItem } from './expressions';
import {
  DEFAULT_EMOJI_CATEGORIES,
  normalizeEmojiGlyph,
  normalizeEmojiSearchText,
  type EmojiMetadataLookup,
} from './emojiMetadata';

/** Max custom emotes taken from any single source (personal, one realm). */
export const EMOTE_SUGGESTION_PER_SOURCE_LIMIT = 8;
/** Max Unicode emoji candidates considered. */
export const EMOTE_SUGGESTION_DEFAULT_LIMIT = 10;
/** Max rows shown in the `:` typeahead. */
export const EMOTE_SUGGESTION_TOTAL_LIMIT = 12;

export type EmoteSuggestionQuery = {
  /** Index of the `:` that opened the query. */
  anchor: number;
  /** Lowercased text typed after the `:`. */
  query: string;
};

/**
 * Finds the `:query` the caret is in, e.g. "hi :ca|" → { anchor: 3, query: 'ca' }.
 * Returns null when the caret is not inside an emote shortcode.
 */
export function parseEmoteSuggestionQuery(
  value: string,
  caret: number,
  minLength = 1
): EmoteSuggestionQuery | null {
  const upto = value.slice(0, caret);
  const colon = upto.lastIndexOf(':');
  if (colon === -1) return null;
  const before = colon === 0 ? ' ' : upto[colon - 1];
  if (before && !/\s/.test(before)) return null;
  const query = upto.slice(colon + 1);
  if (!query || /[\s:]/.test(query) || query.length < minLength) return null;
  return { anchor: colon, query: query.toLowerCase() };
}

export type EmoteSuggestionSource = {
  /** Stable identity for ordering (realm URL, or 'personal'). */
  key: string;
  items: ExpressionItem[];
  /** Turns a matching emote into the token inserted into the composer. */
  buildInsert: (entry: ExpressionItem) => string;
  /** Resolves the preview image for a matching emote. */
  buildPreview: (entry: ExpressionItem) => string;
};

export type DefaultEmojiSuggestionEntry = {
  emoji: string;
  alias: string;
  /** Space-separated words (the emoji's own name and tags) that can also match. */
  searchIndex: string;
};

/**
 * Unicode emojis the `:` typeahead can offer. Only emojis with real metadata are
 * included: until the metadata lookup loads there is no `:name:` to show (the picker's
 * `emoji_N` placeholders mean nothing to a user). Category keywords are left out on
 * purpose: they match whole categories (`:si` → "sign" → every Symbols emoji).
 */
export function buildDefaultEmojiTypeaheadEntries(
  lookup: EmojiMetadataLookup | null
): DefaultEmojiSuggestionEntry[] {
  if (!lookup) return [];
  const entries: DefaultEmojiSuggestionEntry[] = [];
  const seen = new Set<string>();
  for (const category of DEFAULT_EMOJI_CATEGORIES) {
    for (const emoji of category.emojis) {
      const metadata = lookup.get(emoji) ?? lookup.get(normalizeEmojiGlyph(emoji));
      const alias = normalizeEmojiSearchText(metadata?.label ?? '').replace(/ /g, '_');
      if (!alias || seen.has(emoji)) continue;
      seen.add(emoji);
      entries.push({
        emoji,
        alias,
        searchIndex: normalizeEmojiSearchText([metadata?.label ?? '', ...(metadata?.tags ?? [])].join(' ')),
      });
    }
  }
  return entries;
}

function hasWordStartingWith(index: string, q: string): boolean {
  return index.split(' ').some((word) => word.startsWith(q));
}

type Candidate = {
  suggestion: EmoteSuggestion;
  tier: number;
  rank: number;
  group: number;
};

function matchTier(name: string, q: string): number {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  return 2;
}

/**
 * Builds the `:` typeahead list from every custom-emote source plus the Unicode set.
 *
 * Results are ordered by match quality first (exact → prefix → substring), then
 * round-robin across sources in the order given, so every realm gets a fair
 * share of the visible rows. Ordering never depends on which manifest happened
 * to finish loading first, and one busy source can't crowd the others out.
 */
export function buildEmoteSuggestions({
  query,
  sources,
  defaultEntries,
}: {
  query: string;
  sources: EmoteSuggestionSource[];
  defaultEntries: DefaultEmojiSuggestionEntry[];
}): EmoteSuggestion[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const candidates: Candidate[] = [];

  sources.forEach((source, group) => {
    source.items
      .map((entry, index) => ({ entry, index, name: entry.name.toLowerCase() }))
      .filter(({ name }) => name.includes(q))
      .sort((a, b) => matchTier(a.name, q) - matchTier(b.name, q) || a.index - b.index)
      .slice(0, EMOTE_SUGGESTION_PER_SOURCE_LIMIT)
      .forEach(({ entry, name }, rank) => {
        const insert = source.buildInsert(entry);
        if (!insert) return;
        candidates.push({
          suggestion: { label: `:${entry.name}:`, insert, previewImage: source.buildPreview(entry) },
          tier: matchTier(name, q),
          rank,
          group,
        });
      });
  });

  const defaultGroup = sources.length;
  defaultEntries
    .filter((entry) => hasWordStartingWith(entry.alias.replace(/_/g, ' '), q) || hasWordStartingWith(entry.searchIndex, q))
    // Unicode names match on word starts (`:si` shouldn't hit "musical"); a name that
    // only matches past its first word, or only through a tag, ranks below the rest.
    .map((entry, index) => ({
      entry,
      index,
      tier: entry.alias.startsWith(q)
        ? matchTier(entry.alias, q)
        : hasWordStartingWith(entry.alias.replace(/_/g, ' '), q) ? 2 : 3,
    }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .slice(0, EMOTE_SUGGESTION_DEFAULT_LIMIT)
    .forEach(({ entry, tier }, rank) => {
      candidates.push({
        suggestion: { label: `:${entry.alias}:`, insert: entry.emoji, previewEmoji: entry.emoji },
        tier,
        rank,
        group: defaultGroup,
      });
    });

  candidates.sort((a, b) => a.tier - b.tier || a.rank - b.rank || a.group - b.group);

  const seen = new Set<string>();
  const out: EmoteSuggestion[] = [];
  for (const { suggestion } of candidates) {
    if (seen.has(suggestion.insert)) continue;
    seen.add(suggestion.insert);
    out.push(suggestion);
    if (out.length >= EMOTE_SUGGESTION_TOTAL_LIMIT) break;
  }
  return out;
}
