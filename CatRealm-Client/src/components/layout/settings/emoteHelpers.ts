import type { EmotePreviewItem, PersonalExpressionGroups } from './settingsTypes';

export const EMOTE_SIZE_OPTIONS = [24, 32, 48, 64, 96, 128, 256, 512] as const;
export const DEFAULT_PREVIEW_EMOJIS = ['😀', '🔥', '✨', '🎉', '😺', '🍎', '🚀', '💫', '🌈', '😎'];
export const EMPTY_PERSONAL_EXPRESSIONS: PersonalExpressionGroups = {
  emotes: [],
  'anim-emotes': [],
  stickers: [],
  'anim-stickers': [],
};

export function sanitizeExpressionName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 64);
}

export function pickRandomItems<T>(items: T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

// Re-export EmotePreviewItem for convenience
export type { EmotePreviewItem };
