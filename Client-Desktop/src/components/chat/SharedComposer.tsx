import type { ReactNode, RefObject } from 'react';
import type { ExpressionPickerViewModel } from '../../hooks/useExpressionPickerViewModel';
import type { EmoteSuggestion } from '../../lib/expressions';

/**
 * Adapter interface for the SharedComposer.
 * Each chat context (server chat, DM) builds a ComposerAdapter that provides
 * all the data and callbacks the unified composer needs.
 */
export type ComposerAdapter = {
  placeholder: string;
  disabled: boolean;

  // Text state
  value: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;

  // Upload
  uploadMode: 'single' | 'multi';
  attachmentContent: ReactNode;
  uploadControl: ReactNode;

  // Context banners
  replyBanner: ComposerContextBanner | null;
  forwardBanner: ComposerContextBanner | null;

  // Expression picker
  expressionPicker: ExpressionPickerViewModel;

  // Emote suggestion
  emoteSuggest: {
    open: boolean;
    items: EmoteSuggestion[];
    index: number;
    onApply: (item: EmoteSuggestion) => void;
    onSetIndex: (index: number) => void;
  };

  // Mention suggestion (server chat only)
  mentionSuggest?: {
    open: boolean;
    items: Array<{ label: string; insert: string; type: string }>;
    index: number;
    onApply: (item: { label: string; insert: string; type: string }) => void;
    onSetIndex: (index: number) => void;
  } | null;

  // Send button
  sendButtonAction: ComposerButtonAction;

  // Extra content (slowmode banner, NSFW modal, drag overlay, etc.)
  extraContent?: ReactNode;
};

export type ComposerContextBanner = {
  kind: 'reply' | 'forward';
  label: ReactNode;
  preview?: ReactNode;
  onClear: () => void;
};

export type ComposerButtonAction = {
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  onClick?: () => void;
};

/**
 * SharedComposer is the unified composer interface type and utilities.
 * The actual rendering is still handled by the existing SharedComposerShell / SharedComposerCore
 * components — this module provides the adapter type definition for consistent wiring.
 *
 * Usage: MessageInput and DMView build a ComposerAdapter and pass it to their
 * respective render functions that use SharedComposerShell + SharedComposerCore.
 */
export type { ExpressionPickerViewModel };
