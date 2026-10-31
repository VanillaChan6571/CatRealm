// Emote/sticker tokens as both clients write them: [[emote:…|…]], :origin:sticker:name:owner:, :name:.
const EXPRESSION_TOKEN_REGEX = /\[\[(emote|sticker):([^|\]]+)\|([^\]]+)\]\]|:(https?:\/\/[^\s:]+(?::\d{1,5})?):(?:(sticker):)?([a-z0-9_-]{1,64})(?::([a-z0-9_-]{3,128}))?:|:(?:(sticker):)?([a-z0-9_-]{1,64})(?::([a-z0-9_-]{3,128}))?:/i;

export type Segment = { text: string; protect: boolean };

// Parts of a message the MT model must never see: code, links, mentions (@name, <@id>, <#id>),
// inline images, emote/sticker tokens and quoted lines (someone else's words, often in another
// language). They are kept verbatim and left out of language detection.
const PROTECTED_REGEX = new RegExp(
  [
    /^>>>[\s\S]*/.source,
    /^>(?: .*)?$/.source,
    /```[\s\S]*?```/.source,
    /`[^`\n]+`/.source,
    /https?:\/\/\S+|www\.\S+/.source,
    /<[@#][\w-]+>/.source,
    /@[\p{L}\p{N}_]+/u.source,
    /<\?img\d+>/.source,
    EXPRESSION_TOKEN_REGEX.source,
  ].join('|'),
  'gimu',
);

/** Splits text into protected tokens and translatable prose, in order. */
export function splitProtected(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(PROTECTED_REGEX)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start), protect: false });
    segments.push({ text: match[0], protect: true });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), protect: false });
  return segments;
}

/** The translatable prose of a message, with every protected token removed. */
export function proseOf(text: string): string {
  return splitProtected(text)
    .filter((segment) => !segment.protect)
    .map((segment) => segment.text)
    .join(' ')
    .trim();
}

/**
 * Translates only the prose segments, keeping each segment's surrounding whitespace and every
 * protected token untouched. Segments without letters (punctuation, emoji) are passed through.
 */
export async function translateProse(text: string, translate: (prose: string) => Promise<string>): Promise<string> {
  const parts = await Promise.all(
    splitProtected(text).map(async (segment) => {
      if (segment.protect || !/\p{L}/u.test(segment.text)) return segment.text;
      const [, lead, body, trail] = segment.text.match(/^(\s*)([\s\S]*?)(\s*)$/) ?? ['', '', segment.text, ''];
      return `${lead}${(await translate(body)).trim()}${trail}`;
    }),
  );
  return parts.join('');
}
