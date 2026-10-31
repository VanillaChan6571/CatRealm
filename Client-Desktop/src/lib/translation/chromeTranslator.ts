import type { TranslationLanguage } from './detect';

/**
 * Optional fast path: Chrome's built-in on-device Translator API. Only used when the API
 * exists AND the language pack is already installed ('available'), so we never trigger a
 * browser download or a user-activation prompt. Electron/Tauri don't ship it; Bergamot is
 * the real engine there.
 */
type ChromeTranslator = { translate(text: string): Promise<string> };
type ChromeTranslatorFactory = {
  availability(opts: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(opts: { sourceLanguage: string; targetLanguage: string }): Promise<ChromeTranslator>;
};

const translators = new Map<string, Promise<ChromeTranslator | null>>();

// Some Chromium builds (headless, missing on-device service) expose the API but never settle
// availability()/translate(), so every call is raced against a timeout and falls back to Bergamot.
const AVAILABILITY_TIMEOUT_MS = 2_000;
const TRANSLATE_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

function getFactory(): ChromeTranslatorFactory | null {
  const candidate = (globalThis as { Translator?: ChromeTranslatorFactory }).Translator;
  return candidate && typeof candidate.availability === 'function' ? candidate : null;
}

function getTranslator(from: TranslationLanguage, to: TranslationLanguage): Promise<ChromeTranslator | null> {
  const key = `${from}-${to}`;
  let translator = translators.get(key);
  if (!translator) {
    const factory = getFactory();
    translator = factory
      ? withTimeout(factory.availability({ sourceLanguage: from, targetLanguage: to }), AVAILABILITY_TIMEOUT_MS, 'timeout')
          .then((state) => (state === 'available' ? factory.create({ sourceLanguage: from, targetLanguage: to }) : null))
          .catch(() => null)
      : Promise.resolve(null);
    translators.set(key, translator);
  }
  return translator;
}

/** Translated text, or null when the built-in API can't handle this pair right now. */
export async function translateWithChrome(text: string, from: TranslationLanguage, to: TranslationLanguage): Promise<string | null> {
  const translator = await getTranslator(from, to);
  if (!translator) return null;
  try {
    return await withTimeout(translator.translate(text), TRANSLATE_TIMEOUT_MS, null);
  } catch {
    return null;
  }
}
