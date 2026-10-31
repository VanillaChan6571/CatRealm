import { useState, useCallback } from 'react';
import type { RefObject } from 'react';
import { buildExpressionToken, type EmoteSuggestion, type ExpressionItem } from '../lib/expressions';

type SearchableDefaultEmojiEntry = {
  emoji: string;
  alias: string;
  searchIndex: string;
};

type EmoteSuggestionAdapterOptions = {
  personalEmoteItems: ExpressionItem[];
  currentServerEmoteItems: ExpressionItem[];
  currentServerUrl: string | null;
  currentExpressionServerUrl: string | null;
  authBase: string;
  defaultEmojiTypeaheadEntries: SearchableDefaultEmojiEntry[];
  canUsePersonalEmotes: boolean;
  userId: string | null | undefined;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  setValue: (value: string) => void;
};

export function useEmoteSuggestionAdapter({
  personalEmoteItems,
  currentServerEmoteItems,
  currentServerUrl,
  currentExpressionServerUrl,
  authBase,
  defaultEmojiTypeaheadEntries,
  canUsePersonalEmotes,
  userId,
  textareaRef,
  value,
  setValue,
}: EmoteSuggestionAdapterOptions) {
  const [emoteSuggestOpen, setEmoteSuggestOpen] = useState(false);
  const [emoteSuggestItems, setEmoteSuggestItems] = useState<EmoteSuggestion[]>([]);
  const [emoteSuggestIndex, setEmoteSuggestIndex] = useState(0);
  const [emoteSuggestAnchor, setEmoteSuggestAnchor] = useState<number>(-1);

  const applyEmoteSuggestion = useCallback((item: EmoteSuggestion) => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? value.length;
    const anchor = emoteSuggestAnchor;
    if (anchor < 0 || anchor > caret) return;
    const before = value.slice(0, anchor);
    const after = value.slice(caret);
    const next = `${before}${item.insert} ${after}`;
    setValue(next);
    setEmoteSuggestOpen(false);
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = (before + item.insert + ' ').length;
      el.selectionStart = pos;
      el.selectionEnd = pos;
      el.focus();
    });
  }, [value, emoteSuggestAnchor, textareaRef, setValue]);

  const updateEmoteSuggestions = useCallback((inputValue: string, caret: number): boolean => {
    const upto = inputValue.slice(0, caret);
    const colon = upto.lastIndexOf(':');
    if (colon === -1) {
      setEmoteSuggestOpen(false);
      return false;
    }
    const before = colon === 0 ? ' ' : upto[colon - 1];
    if (before && !/\s/.test(before)) {
      setEmoteSuggestOpen(false);
      return false;
    }
    const query = upto.slice(colon + 1);
    if (!query || query.includes(' ') || query.includes('\n') || query.includes(':')) {
      setEmoteSuggestOpen(false);
      return false;
    }

    const q = query.toLowerCase();
    const next: EmoteSuggestion[] = [];
    const seen = new Set<string>();

    if (canUsePersonalEmotes && personalEmoteItems.length > 0) {
      personalEmoteItems
        .filter((entry) => entry.name.toLowerCase().includes(q))
        .slice(0, 8)
        .forEach((entry) => {
          const label = `:${entry.name}:`;
          if (seen.has(label)) return;
          seen.add(label);
          next.push({
            label,
            insert: buildExpressionToken('emote', entry.name, '', authBase, currentServerUrl, entry.owner_id || userId || null),
            previewImage: entry.absolute_url || (/^https?:\/\//i.test(entry.file_url) ? entry.file_url : `${authBase}${entry.file_url}`),
          });
        });
    }

    if (currentExpressionServerUrl && currentServerEmoteItems.length > 0) {
      currentServerEmoteItems
        .filter((entry) => entry.name.toLowerCase().includes(q))
        .slice(0, 8)
        .forEach((entry) => {
          const label = `:${entry.name}:`;
          if (seen.has(label)) return;
          seen.add(label);
          next.push({
            label,
            insert: buildExpressionToken('emote', entry.name, '', currentExpressionServerUrl, currentServerUrl),
            previewImage: entry.absolute_url || (/^https?:\/\//i.test(entry.file_url) ? entry.file_url : `${currentExpressionServerUrl}${entry.file_url}`),
          });
        });
    }

    defaultEmojiTypeaheadEntries
      .filter((entry) => entry.searchIndex.includes(q) || entry.alias.includes(q))
      .slice(0, 10)
      .forEach((entry) => {
        const label = `:${entry.alias}:`;
        if (seen.has(label)) return;
        seen.add(label);
        next.push({
          label,
          insert: entry.emoji,
          previewEmoji: entry.emoji,
        });
      });

    const items = next.slice(0, 12);
    setEmoteSuggestItems(items);
    setEmoteSuggestIndex(0);
    setEmoteSuggestAnchor(colon);
    setEmoteSuggestOpen(items.length > 0);
    return items.length > 0;
  }, [
    canUsePersonalEmotes,
    personalEmoteItems,
    currentExpressionServerUrl,
    currentServerEmoteItems,
    currentServerUrl,
    defaultEmojiTypeaheadEntries,
    userId,
    authBase,
  ]);

  const handleEmoteSuggestionKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!emoteSuggestOpen || emoteSuggestItems.length === 0) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setEmoteSuggestIndex((prev) => (prev + 1) % emoteSuggestItems.length);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setEmoteSuggestIndex((prev) => (prev - 1 + emoteSuggestItems.length) % emoteSuggestItems.length);
      return true;
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      applyEmoteSuggestion(emoteSuggestItems[emoteSuggestIndex]);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setEmoteSuggestOpen(false);
      return true;
    }
    return false;
  }, [emoteSuggestOpen, emoteSuggestItems, emoteSuggestIndex, applyEmoteSuggestion]);

  return {
    emoteSuggestOpen,
    emoteSuggestItems,
    emoteSuggestIndex,
    setEmoteSuggestIndex,
    updateEmoteSuggestions,
    applyEmoteSuggestion,
    handleEmoteSuggestionKeyDown,
    closeEmoteSuggestions: useCallback(() => setEmoteSuggestOpen(false), []),
  };
}
