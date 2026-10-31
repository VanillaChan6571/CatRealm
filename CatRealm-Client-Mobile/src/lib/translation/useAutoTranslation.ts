import { useCallback, useEffect, useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  bumpTranslation,
  forceTranslateMessage,
  peekTranslation,
  setShowOriginal,
  translateMessage,
  useTranslationPacks,
  useTranslationView,
  type MessageTranslation,
  type TranslationLanguage,
} from './index';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5_000;

export type AutoTranslation = {
  translation: MessageTranslation | null;
  showOriginal: boolean;
  toggleOriginal: () => void;
  /** Language the reader would translate into; null when the experiment is off or there's no text. */
  target: TranslationLanguage | null;
  /** Long-press "Translate to …" for messages auto-translate skipped. */
  requestTranslation: () => void;
};

/** Reader's language when it can be translated into: English, or an installed pack. */
export function useTranslationTarget(): TranslationLanguage | null {
  const enabled = useSettingsStore((s) => s.catLabAutoTranslate);
  const language = useSettingsStore((s) => s.language);
  const installed = useTranslationPacks((s) => s.installed);
  if (!enabled || installed.length === 0) return null;
  return language === 'en' || installed.includes(language) ? language : null;
}

/**
 * CatLab auto-translate for one message row (desktop's useAutoTranslation). Chat lists are
 * virtualized, so a row mounting means it's near the screen; translation starts then, and
 * results are cached by message id so re-renders and re-mounts are free.
 */
export function useAutoTranslation(messageId: string, text: string | null | undefined): AutoTranslation {
  const enabled = useSettingsStore((s) => s.catLabAutoTranslate);
  const packsChecked = useTranslationPacks((s) => s.checked);
  const installed = useTranslationPacks((s) => s.installed);
  const target = useTranslationTarget();
  const source = target && text ? text : null;
  // Re-render this row (only) when its translation lands or is toggled.
  useTranslationView((s) => s.revision[messageId] ?? 0);
  const showOriginal = useTranslationView((s) => !!s.showOriginal[messageId]);
  // Failures (e.g. the engine restarting mid model load) aren't cached; retry a couple of times.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (enabled && !packsChecked) void useTranslationPacks.getState().refresh();
  }, [enabled, packsChecked]);

  useEffect(() => {
    if (!source || !target || peekTranslation(messageId, source, target) !== undefined) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    translateMessage(messageId, source, target).then(
      () => { if (!cancelled) bumpTranslation(messageId); },
      (error: unknown) => {
        console.warn('[CatLab] auto-translate failed', error);
        if (!cancelled && attempt < MAX_RETRIES) retryTimer = setTimeout(() => setAttempt(attempt + 1), RETRY_DELAY_MS);
      },
    );
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [messageId, source, target, attempt, installed]);

  const toggleOriginal = useCallback(() => setShowOriginal(messageId, !showOriginal), [messageId, showOriginal]);

  const requestTranslation = useCallback(() => {
    if (!source || !target) return;
    setShowOriginal(messageId, false);
    forceTranslateMessage(messageId, source, target).then(
      () => bumpTranslation(messageId),
      (error: unknown) => console.warn('[CatLab] translate failed', error),
    );
  }, [messageId, source, target]);

  return {
    translation: source && target ? peekTranslation(messageId, source, target) ?? null : null,
    showOriginal,
    toggleOriginal,
    target: source ? target : null,
    requestTranslation,
  };
}

export type MessageTranslationAction =
  | { kind: 'toggle'; showingOriginal: boolean; run: () => void }
  | { kind: 'translate'; target: TranslationLanguage; run: () => void };

/**
 * The long-press sheet's translation row for a message: flip an existing translation, or
 * translate one auto-translate skipped. null when the experiment is off or there's no text.
 */
export function useMessageTranslationAction(
  messageId: string | null | undefined,
  text: string | null | undefined,
): MessageTranslationAction | null {
  const target = useTranslationTarget();
  const key = messageId ?? '';
  useTranslationView((s) => s.revision[key] ?? 0);
  const showingOriginal = useTranslationView((s) => !!s.showOriginal[key]);
  if (!messageId || !text?.trim() || !target) return null;
  const existing = peekTranslation(messageId, text, target);
  if (existing) {
    return { kind: 'toggle', showingOriginal, run: () => setShowOriginal(messageId, !showingOriginal) };
  }
  return {
    kind: 'translate',
    target,
    run: () => {
      setShowOriginal(messageId, false);
      forceTranslateMessage(messageId, text, target).then(
        () => bumpTranslation(messageId),
        (error: unknown) => console.warn('[CatLab] translate failed', error),
      );
    },
  };
}
