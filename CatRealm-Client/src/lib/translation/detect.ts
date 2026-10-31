import { eld } from 'eld/extrasmall';
import { ALL_LANGUAGES, isTranslationLanguage, type TranslationLanguage } from './languages';
import { proseOf } from './segments';

export type { TranslationLanguage } from './languages';

export type DetectionResult = {
  lang: TranslationLanguage;
  /** Heuristic 0..1 confidence: ≥ CONFIDENCE_THRESHOLD only when eld calls the result reliable. */
  confidence: number;
};

export type TranslationPlan = {
  from: TranslationLanguage;
  to: TranslationLanguage;
  confidence: number;
};

/** Below this many letters of prose there is no reliable language signal. */
export const MIN_LETTERS = 8;
/** Minimum detection confidence before a message is auto-translated. */
export const CONFIDENCE_THRESHOLD = 0.7;

const LETTER_REGEX = /\p{L}/gu;
// Kanji and kana carry roughly a word each, so they count double toward MIN_LETTERS.
const DENSE_SCRIPT_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;

function countLetters(text: string): number {
  return (text.match(LETTER_REGEX)?.length ?? 0) + (text.match(DENSE_SCRIPT_REGEX)?.length ?? 0);
}

/**
 * Whether a message has enough prose to translate. Mentions, links, code, emotes and quotes
 * don't block translation; they're kept verbatim and simply don't count as prose.
 */
export function isTranslatableText(text: string): boolean {
  return !!text && countLetters(proseOf(text)) >= MIN_LETTERS;
}

/**
 * eld's per-language scores cluster closely (Spanish vs Portuguese often differ by < 0.01 even
 * when eld is right), so the decision uses eld's own reliability check and the margin only
 * spreads reliable results across 70–100%. Unreliable results always stay below the threshold.
 */
export function scoreToConfidence(reliable: boolean, margin: number): number {
  const spread = Math.min(1, Math.max(0, margin) / 0.2);
  return reliable ? CONFIDENCE_THRESHOLD + (1 - CONFIDENCE_THRESHOLD) * spread : 0.5 * spread;
}

export function detectLanguage(text: string): DetectionResult | null {
  const prose = proseOf(text);
  if (countLetters(prose) < MIN_LETTERS) return null;
  const result = eld.detect(prose);
  const lang = result.language;
  if (!isTranslationLanguage(lang)) return null;
  const [top = 0, runnerUp = 0] = Object.values(result.getScores()).sort((a, b) => b - a);
  return { lang, confidence: scoreToConfidence(result.isReliable(), top - runnerUp) };
}

/**
 * Decides whether (and how) a message should be translated for a reader using `target`.
 * `available` is English plus the installed language packs; both ends must be in it.
 */
export function planTranslation(
  text: string,
  target: TranslationLanguage,
  available: ReadonlySet<TranslationLanguage> = ALL_LANGUAGES,
  threshold = CONFIDENCE_THRESHOLD,
): TranslationPlan | null {
  if (!available.has(target)) return null;
  const detected = detectLanguage(text);
  if (!detected || detected.lang === target || !available.has(detected.lang) || detected.confidence < threshold) return null;
  return { from: detected.lang, to: target, confidence: detected.confidence };
}
