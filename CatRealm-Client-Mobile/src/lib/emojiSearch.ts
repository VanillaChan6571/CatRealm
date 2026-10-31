/** Name/keyword search over plain Unicode emoji, backed by emojibase (same data as desktop). */

type CompactEmoji = { unicode: string; label: string; tags?: string[] };

// Picker lists and emojibase disagree on the U+FE0F presentation selector.
const normalize = (emoji: string) => emoji.replace(/️/g, '');

let keywordsByEmoji: Map<string, string> | null = null;

function keywordIndex(): Map<string, string> {
  if (!keywordsByEmoji) {
    // Loaded on first search so the 0.5 MB table stays off the startup path.
    const data = require('emojibase-data/en/compact.json') as CompactEmoji[];
    keywordsByEmoji = new Map(data.map((e) => [normalize(e.unicode), [e.label, ...(e.tags ?? [])].join(' ').toLowerCase()]));
  }
  return keywordsByEmoji;
}

/** Emoji from `emojis` whose name or tags contain every word of `query`. */
export function searchEmoji(emojis: readonly string[], query: string): string[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...emojis];
  const index = keywordIndex();
  return emojis.filter((emoji) => {
    const keywords = index.get(normalize(emoji));
    return !!keywords && terms.every((term) => keywords.includes(term));
  });
}
