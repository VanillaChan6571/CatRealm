export const LANGUAGE_OPTIONS = ['en', 'es', 'ru', 'ja'] as const;
export type AppLanguage = (typeof LANGUAGE_OPTIONS)[number];

export function resolveAppLanguage(locales: readonly string[]): AppLanguage {
  for (const locale of locales) {
    const base = locale.trim().toLowerCase().split(/[-_]/, 1)[0];
    if (LANGUAGE_OPTIONS.includes(base as AppLanguage)) return base as AppLanguage;
  }
  return 'en';
}

export function detectAppLanguage(): AppLanguage {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return resolveAppLanguage(locale ? [locale] : []);
  } catch {
    return 'en';
  }
}
