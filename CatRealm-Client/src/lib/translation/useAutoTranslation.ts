import { useCallback, useEffect, useReducer, useState, type RefObject } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  forceTranslateMessage,
  peekTranslation,
  translateMessage,
  useTranslationPacks,
  type MessageTranslation,
  type TranslationLanguage,
} from './index';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5_000;

export type AutoTranslation = {
  translation: MessageTranslation | null;
  /** Language the reader would translate into; null when the experiment is off or there's no text. */
  target: TranslationLanguage | null;
  /** Context-menu "Translate to …" for messages auto-translate skipped. */
  requestTranslation: () => void;
};

/**
 * CatLab auto-translate for one message row. Translation is lazy: it only starts once the row
 * scrolls into view, and results are cached by message id so re-renders and re-mounts are free.
 * Messages it skips (low confidence, links, mentions…) can still be translated on request.
 */
export function useAutoTranslation(
  messageId: string,
  text: string | null | undefined,
  rowRef: RefObject<HTMLElement | null>,
): AutoTranslation {
  const enabled = useSettingsStore((s) => s.catLabAutoTranslate);
  const language = useSettingsStore((s) => s.language);
  const installed = useTranslationPacks((s) => s.installed);
  const packsChecked = useTranslationPacks((s) => s.checked);
  // The reader's language needs its pack too (English is built in).
  const target: TranslationLanguage | null = language === 'en' || installed.includes(language) ? language : null;
  // The cache holds the result; this only re-renders the row once it lands.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const source = enabled && target && installed.length > 0 ? text : null;
  // Failures (e.g. the worker restarting mid model load) aren't cached; retry a couple of times.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (enabled && !packsChecked) void useTranslationPacks.getState().refresh();
  }, [enabled, packsChecked]);

  useEffect(() => {
    if (!source || !target || peekTranslation(messageId, source, target) !== undefined) return;
    const node = rowRef.current;
    if (!node) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      translateMessage(messageId, source, target).then(
        () => { if (!cancelled) rerender(); },
        (error: unknown) => {
          console.warn('[CatLab] auto-translate failed', error);
          if (!cancelled && attempt < MAX_RETRIES) retryTimer = setTimeout(() => setAttempt(attempt + 1), RETRY_DELAY_MS);
        },
      );
    }, { rootMargin: '200px 0px' });
    observer.observe(node);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      observer.disconnect();
    };
  }, [messageId, source, target, rowRef, attempt, installed]);

  const requestTranslation = useCallback(() => {
    if (!source || !target) return;
    forceTranslateMessage(messageId, source, target).then(
      () => rerender(),
      (error: unknown) => console.warn('[CatLab] translate failed', error),
    );
  }, [messageId, source, target]);

  return {
    translation: source && target ? peekTranslation(messageId, source, target) ?? null : null,
    target: source ? target : null,
    requestTranslation,
  };
}
