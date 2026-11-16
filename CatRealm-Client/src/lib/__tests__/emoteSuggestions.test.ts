import { describe, it, expect } from 'vitest';
import {
  buildDefaultEmojiTypeaheadEntries,
  buildEmoteSuggestions,
  parseEmoteSuggestionQuery,
  EMOTE_SUGGESTION_TOTAL_LIMIT,
  type EmoteSuggestionSource,
} from '../emoteSuggestions';
import { buildExpressionToken, type ExpressionItem } from '../expressions';
import type { EmojiMetadataLookup } from '../emojiMetadata';

function emote(name: string): ExpressionItem {
  return {
    id: name,
    name,
    type: 'emotes',
    file_url: `/ugc/expressions/${name}.png`,
    mime_type: 'image/png',
    file_size: 1,
    created_by: 'u',
    created_at: 0,
  };
}

const CURRENT = 'https://current.example';

function realm(url: string, names: string[]): EmoteSuggestionSource {
  return {
    key: url,
    items: names.map(emote),
    buildInsert: (entry) => buildExpressionToken('emote', entry.name, '', url, CURRENT),
    buildPreview: (entry) => `${url}${entry.file_url}`,
  };
}

describe('parseEmoteSuggestionQuery', () => {
  it('finds the shortcode under the caret', () => {
    expect(parseEmoteSuggestionQuery('hi :Ca', 6)).toEqual({ anchor: 3, query: 'ca' });
  });
  it('ignores colons glued to a word, finished tokens and short queries', () => {
    expect(parseEmoteSuggestionQuery('a:ca', 4)).toBeNull();
    expect(parseEmoteSuggestionQuery(':cat: x', 7)).toBeNull();
    expect(parseEmoteSuggestionQuery(':c', 2, 2)).toBeNull();
  });
});

describe('buildEmoteSuggestions', () => {
  it('includes emotes from other realms, tokenized with their origin', () => {
    const items = buildEmoteSuggestions({
      query: 'cat',
      sources: [realm(CURRENT, ['catjam']), realm('https://other.example', ['catwave'])],
      defaultEntries: [],
    });
    expect(items.map((i) => i.insert)).toEqual([':catjam:', ':https://other.example:catwave:']);
  });

  it('does not let earlier sources crowd later realms out of the list', () => {
    // Personal + current realm alone have 16 matches, more than the 12 visible rows.
    // Previously the other realm was cut off entirely, depending on load order.
    const many = (prefix: string) => Array.from({ length: 8 }, (_, i) => `${prefix}cat${i}`);
    const items = buildEmoteSuggestions({
      query: 'cat',
      sources: [
        realm('https://personal.example', many('p')),
        realm(CURRENT, many('c')),
        realm('https://other.example', ['xcat']),
      ],
      defaultEntries: [],
    });
    expect(items).toHaveLength(EMOTE_SUGGESTION_TOTAL_LIMIT);
    expect(items.some((i) => i.insert === ':https://other.example:xcat:')).toBe(true);
  });

  it('ranks exact and prefix matches from any realm above substring matches', () => {
    const items = buildEmoteSuggestions({
      query: 'cat',
      sources: [realm(CURRENT, ['bigcat', 'smallcat']), realm('https://other.example', ['catnap', 'cat'])],
      defaultEntries: [],
    });
    expect(items.map((i) => i.label)).toEqual([':cat:', ':catnap:', ':bigcat:', ':smallcat:']);
  });

  it('keeps same-named emotes from different realms, drops identical tokens', () => {
    const items = buildEmoteSuggestions({
      query: 'wave',
      sources: [realm(CURRENT, ['wave']), realm('https://other.example', ['wave']), realm(CURRENT, ['wave'])],
      defaultEntries: [],
    });
    expect(items.map((i) => i.insert)).toEqual([':wave:', ':https://other.example:wave:']);
  });

  it('still offers Unicode emojis alongside custom ones', () => {
    const items = buildEmoteSuggestions({
      query: 'cat',
      sources: [realm('https://other.example', ['catwave'])],
      defaultEntries: [
        { emoji: '🐱', alias: 'cat_face', searchIndex: 'cat face animal' },
        { emoji: '🦁', alias: 'lion', searchIndex: 'lion cat animal' },
      ],
    });
    expect(items.map((i) => i.label)).toEqual([':catwave:', ':cat_face:', ':lion:']);
  });

  it('does not match Unicode emojis on tags that merely contain the query', () => {
    const items = buildEmoteSuggestions({
      query: 'si',
      sources: [realm(CURRENT, ['sip'])],
      defaultEntries: [
        { emoji: '🎵', alias: 'musical_note', searchIndex: 'musical note music' },
        { emoji: '😮‍💨', alias: 'face_exhaling', searchIndex: 'face exhaling sigh' },
      ],
    });
    expect(items.map((i) => i.label)).toEqual([':sip:', ':face_exhaling:']);
  });
});

describe('buildEmoteSuggestions Unicode ranking', () => {
  it('ranks a Unicode name match above earlier tag-only matches', () => {
    const tagOnly = Array.from({ length: 12 }, (_, i) => ({ emoji: `t${i}`, alias: `thing_${i}`, searchIndex: `thing ${i} sun` }));
    const items = buildEmoteSuggestions({
      query: 'sun',
      sources: [],
      defaultEntries: [...tagOnly, { emoji: '☀️', alias: 'sun', searchIndex: 'sun' }],
    });
    expect(items[0].label).toBe(':sun:');
  });
});

describe('buildDefaultEmojiTypeaheadEntries', () => {
  it('offers nothing until emoji names are loaded, instead of emoji_N placeholders', () => {
    expect(buildDefaultEmojiTypeaheadEntries(null)).toEqual([]);
  });

  it('uses real names and tags, never category keywords', () => {
    const lookup: EmojiMetadataLookup = new Map([
      ['❤️', { label: 'red heart', tags: ['love'] }],
    ]);
    const entries = buildDefaultEmojiTypeaheadEntries(lookup);
    expect(entries).toEqual([{ emoji: '❤️', alias: 'red_heart', searchIndex: 'red heart love' }]);
    // "si" used to match every Symbols emoji through the category keyword "sign".
    expect(buildEmoteSuggestions({ query: 'si', sources: [], defaultEntries: entries })).toEqual([]);
  });
});
