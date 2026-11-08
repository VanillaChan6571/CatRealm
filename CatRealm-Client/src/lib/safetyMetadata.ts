export type SafetyMessageMetadata = {
  version: 1;
  containsLinks: boolean;
  normalizedUrls: string[];
};

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const EXPRESSION_TOKEN_RE = /:https?:\/\/[^\s:]+(?::\d{1,5})?:(?:sticker:)?[a-z0-9_-]{1,64}(?::[a-z0-9_-]{3,128})?:/gi;

export function buildSafetyMessageMetadata(text: string): SafetyMessageMetadata {
  const scanText = String(text || '').replace(EXPRESSION_TOKEN_RE, '');
  const urls = new Set<string>();
  for (const match of scanText.match(URL_RE) ?? []) {
    const candidate = match.replace(/[),.!?\]}]+$/g, '');
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      parsed.hostname = parsed.hostname.toLowerCase();
      urls.add(parsed.toString());
    } catch {
      // Keep this aligned with the client's actual link parser.
    }
  }
  const normalizedUrls = [...urls].slice(0, 20);
  return { version: 1, containsLinks: normalizedUrls.length > 0, normalizedUrls };
}
