import type { ExpressionEntry, ExpressionLookup } from './expressionCache';

function originOf(url: string | null | undefined): string | null {
  try { return url ? new URL(url).origin : null; } catch { return null; }
}

export function filterExpressionLookup(
  lookup: ExpressionLookup | null | undefined,
  serverUrl: string | null | undefined,
  canUseExternalEmotes: boolean,
  canUseExternalStickers: boolean,
): ExpressionLookup | null {
  if (!lookup) return null;
  const currentOrigin = originOf(serverUrl);
  if (!currentOrigin || (canUseExternalEmotes && canUseExternalStickers)) return lookup;

  const allowed: ExpressionLookup = new Map();
  for (const [key, entry] of lookup) {
    const external = entry.source === 'personal' || originOf(entry.origin) !== currentOrigin;
    if (!external) {
      allowed.set(key, entry);
      continue;
    }
    const emote = canUseExternalEmotes ? entry.emote : undefined;
    const sticker = canUseExternalStickers ? entry.sticker : undefined;
    if (emote || sticker) allowed.set(key, { ...entry, emote, sticker } as ExpressionEntry);
  }
  return allowed;
}
