/** Languages offered as downloadable packs. Each pack holds that language ↔ English models. */
export const PACK_LANGUAGES = ['es', 'ru', 'ja'] as const;

export type PackLanguage = (typeof PACK_LANGUAGES)[number];

/** Every language the on-device engine can translate between; English is the hub. */
export type TranslationLanguage = 'en' | PackLanguage;

export const ALL_LANGUAGES: ReadonlySet<TranslationLanguage> = new Set(['en', ...PACK_LANGUAGES]);

export function isTranslationLanguage(value: string): value is TranslationLanguage {
  return ALL_LANGUAGES.has(value as TranslationLanguage);
}
