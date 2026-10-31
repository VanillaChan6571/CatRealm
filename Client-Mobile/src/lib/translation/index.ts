import { create } from 'zustand';
import { TranslationCache } from './cache';
import type { TranslationLanguage } from './languages';
import { translateOnDevice } from './engine';
import { useTranslationPacks } from './packStore';
import { translateProse } from './segments';
import type * as DetectModule from './detect';

/**
 * CatLab auto-translate on mobile — the desktop client's lib/translation flow (detect →
 * protect links/mentions/emotes → translate prose → cache by message id) on top of the
 * on-device engine in the translation WebView.
 */
export type MessageTranslation = {
  text: string;
  from: TranslationLanguage;
  to: TranslationLanguage;
  /**
   * 0..1. The Bergamot packs ship no quality-estimation models, so this is the language
   * detection confidence. Always surfaced to users as "confidence", never "accuracy".
   * null when the user forced a translation the detector didn't back up.
   */
  confidence: number | null;
};

type Detect = typeof DetectModule;
// eld's n-gram data is only parsed once the experiment actually runs.
const detect = (): Detect => require('./detect') as Detect;

const cache = new TranslationCache<MessageTranslation>(1000);
const cacheKey = (messageId: string, target: TranslationLanguage) => `${target}:${messageId}`;

/**
 * Per-message view state shared by the message row and its long-press sheet: whether the
 * original is showing, and a revision bumped when that message's translation lands.
 */
export const useTranslationView = create<{ showOriginal: Record<string, boolean>; revision: Record<string, number> }>(() => ({
  showOriginal: {},
  revision: {},
}));

export function bumpTranslation(messageId: string): void {
  const { revision } = useTranslationView.getState();
  useTranslationView.setState({ revision: { ...revision, [messageId]: (revision[messageId] ?? 0) + 1 } });
}

export function setShowOriginal(messageId: string, value: boolean): void {
  useTranslationView.setState((state) => ({ showOriginal: { ...state.showOriginal, [messageId]: value } }));
}

// Installing or removing a pack changes what can be translated, including messages cached as
// "not translated", so start over whenever the installed set changes.
useTranslationPacks.subscribe((state, prev) => {
  if (state.installed !== prev.installed) cache.clear();
});

/** English plus every installed language pack. */
export function availableLanguages(): ReadonlySet<TranslationLanguage> {
  return new Set<TranslationLanguage>(['en', ...useTranslationPacks.getState().installed]);
}

/** Synchronous cache lookup so already-translated rows render without a flash of the original. */
export function peekTranslation(messageId: string, text: string, target: TranslationLanguage): MessageTranslation | null | undefined {
  return cache.get(cacheKey(messageId, target), text);
}

/** Translates `text` into `target` on-device, or resolves null when it shouldn't be translated. */
export function translateMessage(messageId: string, text: string, target: TranslationLanguage): Promise<MessageTranslation | null> {
  return cache.resolve(cacheKey(messageId, target), text, async () => {
    const plan = detect().planTranslation(text, target, availableLanguages());
    if (!plan) return null;
    const clean = (await translateProse(text, (prose) => translateOnDevice(prose, plan.from, plan.to))).trim();
    if (!clean || clean === text.trim()) return null;
    return { text: clean, from: plan.from, to: plan.to, confidence: plan.confidence };
  });
}

/**
 * Source language for a forced translation: what the detector saw when that's installed and
 * isn't the reader's language, else the one other installed language it could only be.
 */
function forcedSource(detected: TranslationLanguage | undefined, target: TranslationLanguage): TranslationLanguage | null {
  const available = availableLanguages();
  if (detected && detected !== target && available.has(detected)) return detected;
  const others = [...available].filter((lang) => lang !== target);
  return others.length === 1 ? others[0] : null;
}

/**
 * "Translate to …" from the long-press sheet: translates regardless of the confidence
 * threshold or minimum length. Links, mentions, code, emotes and quotes stay as-is.
 * Replaces any cached "not translated" result.
 */
export async function forceTranslateMessage(
  messageId: string,
  text: string,
  target: TranslationLanguage,
): Promise<MessageTranslation | null> {
  const detected = detect().detectLanguage(text);
  const from = availableLanguages().has(target) ? forcedSource(detected?.lang, target) : null;
  const translated = from ? (await translateProse(text, (prose) => translateOnDevice(prose, from, target))).trim() : '';
  const result = from && translated && translated !== text.trim()
    ? { text: translated, from, to: target, confidence: detected?.lang === from ? detected.confidence : null }
    : null;
  cache.set(cacheKey(messageId, target), text, result);
  return result;
}

export function clearTranslationCache(): void {
  cache.clear();
}

export { useTranslationPacks } from './packStore';
export { packBytes } from './models';
export { PACK_LANGUAGES } from './languages';
export type { PackLanguage, TranslationLanguage } from './languages';
