import { useCallback, useEffect, useMemo } from 'react';
import type { ClipboardEvent as ReactClipboardEvent } from 'react';
import type { ChangeEvent } from 'react';
import type { Dispatch, SetStateAction } from 'react';

type PickerTab = 'emojis' | 'stickers';

type ComposerEventMessage = { id: string };

type ReplyForwardBridgeOptions<TMessage extends ComposerEventMessage> = {
  setReplying: Dispatch<SetStateAction<TMessage | null>>;
  setForwarding: Dispatch<SetStateAction<TMessage | null>>;
  focusInput?: () => void;
};

export function useReplyForwardComposerBridge<TMessage extends ComposerEventMessage>({
  setReplying,
  setForwarding,
  focusInput,
}: ReplyForwardBridgeOptions<TMessage>) {
  useEffect(() => {
    const onReplyEvent = (event: Event) => {
      const message = (event as CustomEvent<{ message?: TMessage }>).detail?.message;
      if (!message) return;
      setForwarding(null);
      setReplying((prev) => (prev?.id === message.id ? null : message));
      if (focusInput) requestAnimationFrame(focusInput);
    };

    const onForwardEvent = (event: Event) => {
      const message = (event as CustomEvent<{ message?: TMessage }>).detail?.message;
      if (!message) return;
      setReplying(null);
      setForwarding((prev) => (prev?.id === message.id ? null : message));
      if (focusInput) requestAnimationFrame(focusInput);
    };

    window.addEventListener('message:reply', onReplyEvent as EventListener);
    window.addEventListener('message:forward', onForwardEvent as EventListener);
    return () => {
      window.removeEventListener('message:reply', onReplyEvent as EventListener);
      window.removeEventListener('message:forward', onForwardEvent as EventListener);
    };
  }, [focusInput, setForwarding, setReplying]);
}

type MessageInputShortcutAction = 'focusText' | 'uploadFile' | 'togglePicker';

type MessageInputKeybindBridgeOptions = {
  onFocusText?: () => void;
  onUploadFile?: () => void;
  onTogglePicker?: (tab: PickerTab) => void;
};

export function useMessageInputKeybindBridge({
  onFocusText,
  onUploadFile,
  onTogglePicker,
}: MessageInputKeybindBridgeOptions) {
  useEffect(() => {
    const onKeybindAction = (event: Event) => {
      const custom = event as CustomEvent<{ action?: MessageInputShortcutAction; tab?: PickerTab }>;
      const action = custom.detail?.action;
      if (!action) return;

      if (action === 'focusText') {
        onFocusText?.();
        return;
      }
      if (action === 'uploadFile') {
        onUploadFile?.();
        return;
      }
      if (action === 'togglePicker') {
        onTogglePicker?.(custom.detail?.tab ?? 'emojis');
      }
    };

    window.addEventListener('catrealm:keybind:message-input', onKeybindAction as EventListener);
    return () => window.removeEventListener('catrealm:keybind:message-input', onKeybindAction as EventListener);
  }, [onFocusText, onUploadFile, onTogglePicker]);
}

export type ComposerActionAdapter = {
  focusText?: () => void;
  uploadFile?: () => void;
  togglePicker?: (tab: PickerTab) => void;
};

export type ComposerUiButtonAction = {
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  onClick?: () => void;
};

export function useComposerActionAdapter(adapter: ComposerActionAdapter) {
  useMessageInputKeybindBridge({
    onFocusText: adapter.focusText,
    onUploadFile: adapter.uploadFile,
    onTogglePicker: adapter.togglePicker,
  });
}

type ComposerUiActionsAdapterOptions = {
  upload?: ComposerUiButtonAction;
  picker?: ComposerUiButtonAction;
  send?: ComposerUiButtonAction;
};

export function useComposerUiActionsAdapter({
  upload,
  picker,
  send,
}: ComposerUiActionsAdapterOptions) {
  return useMemo(
    () => ({
      uploadAction: upload,
      pickerAction: picker,
      sendAction: send,
    }),
    [upload, picker, send]
  );
}

type ComposerTransportAdapterOptions = {
  keybind?: ComposerActionAdapter;
  uiActions?: ComposerUiActionsAdapterOptions;
  pasteFiles?: ComposerPasteFilesAdapterOptions;
  fileInputChange?: ComposerFileInputChangeAdapterOptions;
};

export function useComposerTransportAdapter({
  keybind,
  uiActions,
  pasteFiles,
  fileInputChange,
}: ComposerTransportAdapterOptions) {
  useComposerActionAdapter(keybind ?? {});
  const ui = useComposerUiActionsAdapter(uiActions ?? {});
  const onPasteFiles = useComposerPasteFilesAdapter(pasteFiles ?? { enabled: false, onFiles: async () => {} });
  const onFileInputChange = useComposerFileInputChangeAdapter(fileInputChange ?? { enabled: false, onFiles: async () => {} });

  return {
    ...ui,
    onPasteFiles,
    onFileInputChange,
  };
}

export function getClipboardFiles(event: Pick<ClipboardEvent, 'clipboardData'> | Pick<ReactClipboardEvent<HTMLTextAreaElement>, 'clipboardData'>): File[] {
  return Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file);
}

type ComposerPasteFilesAdapterOptions = {
  enabled?: boolean;
  mode?: 'single' | 'multiple';
  onFiles: (files: File[]) => void | Promise<void>;
};

export function useComposerPasteFilesAdapter({
  enabled = true,
  mode = 'multiple',
  onFiles,
}: ComposerPasteFilesAdapterOptions) {
  return useCallback(async (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    if (!enabled) return;
    const files = getClipboardFiles(event);
    if (files.length === 0) return;
    event.preventDefault();
    const nextFiles = mode === 'single' ? files.slice(0, 1) : files;
    await onFiles(nextFiles);
  }, [enabled, mode, onFiles]);
}

type ComposerFileInputChangeAdapterOptions = {
  enabled?: boolean;
  mode?: 'single' | 'multiple';
  resetInput?: boolean;
  onFiles: (files: File[]) => void | Promise<void>;
};

export function useComposerFileInputChangeAdapter({
  enabled = true,
  mode = 'multiple',
  resetInput = false,
  onFiles,
}: ComposerFileInputChangeAdapterOptions) {
  return useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    if (!enabled) return;
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    const nextFiles = mode === 'single' ? files.slice(0, 1) : files;
    const input = event.currentTarget;
    await onFiles(nextFiles);
    if (resetInput && input) {
      input.value = '';
    }
  }, [enabled, mode, onFiles, resetInput]);
}

type ComposerExpressionPickerActionsOptions = {
  pickerTab: PickerTab;
  setPickerTab: Dispatch<SetStateAction<PickerTab>>;
  setPickerOpen: Dispatch<SetStateAction<boolean>>;
  primePickerSelection?: () => unknown;
  beforeToggle?: () => void;
};

export function useComposerExpressionPickerActions({
  pickerTab,
  setPickerTab,
  setPickerOpen,
  primePickerSelection,
  beforeToggle,
}: ComposerExpressionPickerActionsOptions) {
  const prime = useCallback(() => {
    if (primePickerSelection) primePickerSelection();
  }, [primePickerSelection]);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
  }, [setPickerOpen]);

  const togglePickerButton = useCallback(() => {
    if (beforeToggle) beforeToggle();
    setPickerOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) prime();
      return nextOpen;
    });
  }, [beforeToggle, prime, setPickerOpen]);

  const togglePickerTab = useCallback((targetTab: PickerTab) => {
    if (beforeToggle) beforeToggle();
    setPickerTab(targetTab);
    setPickerOpen((open) => {
      const shouldClose = open && pickerTab === targetTab;
      const nextOpen = !shouldClose;
      if (nextOpen) prime();
      return nextOpen;
    });
  }, [beforeToggle, pickerTab, prime, setPickerOpen, setPickerTab]);

  const openPickerTab = useCallback((targetTab: PickerTab) => {
    setPickerTab(targetTab);
    setPickerOpen(true);
    prime();
  }, [prime, setPickerOpen, setPickerTab]);

  return {
    closePicker,
    togglePickerButton,
    togglePickerTab,
    openPickerTab,
  };
}

type ExpressionPickerServerLike = {
  url: string;
  isDefault?: boolean;
  isPersonal?: boolean;
  isCurrent?: boolean;
};

type ExpressionPickerServerLoadState<TData = unknown> = {
  loading: boolean;
  data: TData | null;
  error: string | null;
};

type ExpressionManifestLike<TExpression> = {
  emotes: TExpression[];
  'anim-emotes': TExpression[];
  stickers: TExpression[];
  'anim-stickers': TExpression[];
};

type ExpressionPickerAdapterOptions<TServer extends ExpressionPickerServerLike, TData = unknown> = {
  visibleServers: TServer[];
  selectedServerUrl: string | null;
  setSelectedServerUrl: Dispatch<SetStateAction<string | null>>;
  stateByServer: Record<string, ExpressionPickerServerLoadState<TData> | undefined>;
  loadManifest: (entry: TServer) => void | Promise<void>;
  ensurePersonalManifest?: () => void | Promise<void>;
  clearServerState?: (url: string) => void;
};

export function useExpressionPickerAdapter<TServer extends ExpressionPickerServerLike, TData = unknown>({
  visibleServers,
  selectedServerUrl,
  setSelectedServerUrl,
  stateByServer,
  loadManifest,
  ensurePersonalManifest,
  clearServerState,
}: ExpressionPickerAdapterOptions<TServer, TData>) {
  const effectiveSelectedServerUrl = useMemo(() => {
    if (selectedServerUrl && visibleServers.some((server) => server.url === selectedServerUrl)) {
      return selectedServerUrl;
    }
    const currentServerEntry = visibleServers.find((entry) => entry.isCurrent && !entry.isDefault && !entry.isPersonal);
    if (currentServerEntry) return currentServerEntry.url;
    const personalEntry = visibleServers.find((entry) => entry.isPersonal);
    if (personalEntry) return personalEntry.url;
    return visibleServers[0]?.url ?? null;
  }, [selectedServerUrl, visibleServers]);

  const selectedServer = useMemo(
    () => (effectiveSelectedServerUrl
      ? visibleServers.find((server) => server.url === effectiveSelectedServerUrl) ?? null
      : null),
    [effectiveSelectedServerUrl, visibleServers]
  );

  const selectedServerState = useMemo(
    () => (selectedServer && !selectedServer.isDefault && !selectedServer.isPersonal
      ? (stateByServer[selectedServer.url] ?? null)
      : null),
    [selectedServer, stateByServer]
  );

  const loadServerIfNeeded = useCallback((entry: TServer | null) => {
    if (!entry || entry.isDefault || entry.isPersonal) return;
    const state = stateByServer[entry.url];
    if (state?.loading || state?.data || state?.error) return;
    void loadManifest(entry);
  }, [loadManifest, stateByServer]);

  const selectServer = useCallback((entry: TServer) => {
    setSelectedServerUrl(entry.url);
    loadServerIfNeeded(entry);
  }, [loadServerIfNeeded, setSelectedServerUrl]);

  const primePickerSelection = useCallback(() => {
    if (visibleServers.length === 0) return null;
    if (ensurePersonalManifest) void ensurePersonalManifest();
    const nextUrl = effectiveSelectedServerUrl || visibleServers[0].url;
    const nextServer = visibleServers.find((server) => server.url === nextUrl) ?? null;
    if (!nextServer) return null;
    setSelectedServerUrl(nextServer.url);
    loadServerIfNeeded(nextServer);
    return nextServer;
  }, [
    effectiveSelectedServerUrl,
    ensurePersonalManifest,
    loadServerIfNeeded,
    setSelectedServerUrl,
    visibleServers,
  ]);

  const retrySelectedServer = useCallback(() => {
    if (!selectedServer) return;
    if (clearServerState) clearServerState(selectedServer.url);
    void loadManifest(selectedServer);
  }, [clearServerState, loadManifest, selectedServer]);

  return {
    effectiveSelectedServerUrl,
    selectedServer,
    selectedServerState,
    selectServer,
    primePickerSelection,
    retrySelectedServer,
  };
}

type ExpressionPickerDataAdapterOptions<
  TServer extends ExpressionPickerServerLike,
  TExpression extends { id: string | number; name: string },
  TManifest extends ExpressionManifestLike<TExpression>,
  TPickerItem,
> = {
  selectedServer: TServer | null;
  selectedServerState?: ExpressionPickerServerLoadState<TManifest> | null;
  personalManifest?: TManifest | null;
  emptyManifest: TManifest;
  currentServerUrl?: string | null;
  serverUrl?: string | null;
  authBase: string;
  canUseExternalEmojis: boolean;
  canUseExternalStickers: boolean;
  searchQuery: string;
  buildPickerItem: (params: {
    expression: TExpression;
    sourceUrl: string;
    kind: 'emote' | 'sticker';
    isPersonal: boolean;
    selectedServer: TServer | null;
    index: number;
  }) => TPickerItem;
};

export function useExpressionPickerDataAdapter<
  TServer extends ExpressionPickerServerLike,
  TExpression extends { id: string | number; name: string },
  TManifest extends ExpressionManifestLike<TExpression>,
  TPickerItem,
>({
  selectedServer,
  selectedServerState = null,
  personalManifest = null,
  emptyManifest,
  currentServerUrl = null,
  serverUrl = null,
  authBase,
  canUseExternalEmojis,
  canUseExternalStickers,
  searchQuery,
  buildPickerItem,
}: ExpressionPickerDataAdapterOptions<TServer, TExpression, TManifest, TPickerItem>) {
  const selectedManifest = useMemo<TManifest | null>(() => {
    if (!selectedServer) return null;
    if (selectedServer.isDefault) return emptyManifest;
    if (selectedServer.isPersonal) return personalManifest ?? emptyManifest;
    return selectedServerState?.data ?? null;
  }, [emptyManifest, personalManifest, selectedServer, selectedServerState]);

  const selectedIsExternal = useMemo(
    () => !!(
      selectedServer &&
      !selectedServer.isDefault &&
      (
        selectedServer.isPersonal
        || !!(currentServerUrl && selectedServer.url !== currentServerUrl)
      )
    ),
    [currentServerUrl, selectedServer]
  );

  const canUseSelectedEmojiServer = !selectedIsExternal || canUseExternalEmojis;
  const canUseSelectedStickerServer = !selectedIsExternal || canUseExternalStickers;

  const selectedPickerSourceUrl = useMemo(
    () => (
      selectedServer?.isPersonal
        ? authBase
        : (selectedServer?.url || currentServerUrl || serverUrl || authBase)
    ),
    [authBase, currentServerUrl, selectedServer, serverUrl]
  );

  const baseEmoteItems = useMemo(
    () => (selectedManifest ? [...selectedManifest.emotes, ...selectedManifest['anim-emotes']] : []),
    [selectedManifest]
  );

  const baseStickerItems = useMemo(
    () => (selectedManifest ? [...selectedManifest.stickers, ...selectedManifest['anim-stickers']] : []),
    [selectedManifest]
  );

  const selectedEmotePickerItems = useMemo(
    () => baseEmoteItems.map((expression, index) => buildPickerItem({
      expression,
      sourceUrl: selectedPickerSourceUrl,
      kind: 'emote',
      isPersonal: !!selectedServer?.isPersonal,
      selectedServer,
      index,
    })),
    [baseEmoteItems, buildPickerItem, selectedPickerSourceUrl, selectedServer]
  );

  const selectedStickerPickerItems = useMemo(
    () => baseStickerItems.map((expression, index) => buildPickerItem({
      expression,
      sourceUrl: selectedPickerSourceUrl,
      kind: 'sticker',
      isPersonal: !!selectedServer?.isPersonal,
      selectedServer,
      index,
    })),
    [baseStickerItems, buildPickerItem, selectedPickerSourceUrl, selectedServer]
  );

  const trimmedSearchQuery = searchQuery.trim();
  const lowerSearchQuery = trimmedSearchQuery.toLowerCase();
  const hasSearchQuery = trimmedSearchQuery.length > 0;

  const filteredSelectedEmoteItems = useMemo(
    () => (
      hasSearchQuery
        ? selectedEmotePickerItems.filter((item) => {
          const expression = (item as unknown as { expression?: { name?: string } }).expression;
          return (expression?.name ?? '').toLowerCase().includes(lowerSearchQuery);
        })
        : selectedEmotePickerItems
    ),
    [hasSearchQuery, lowerSearchQuery, selectedEmotePickerItems]
  );

  const filteredSelectedStickerItems = useMemo(
    () => (
      hasSearchQuery
        ? selectedStickerPickerItems.filter((item) => {
          const expression = (item as unknown as { expression?: { name?: string } }).expression;
          return (expression?.name ?? '').toLowerCase().includes(lowerSearchQuery);
        })
        : selectedStickerPickerItems
    ),
    [hasSearchQuery, lowerSearchQuery, selectedStickerPickerItems]
  );

  return {
    selectedManifest,
    selectedIsExternal,
    canUseSelectedEmojiServer,
    canUseSelectedStickerServer,
    selectedPickerSourceUrl,
    selectedEmotePickerItems,
    selectedStickerPickerItems,
    filteredSelectedEmoteItems,
    filteredSelectedStickerItems,
    hasSearchQuery,
    trimmedSearchQuery,
  };
}

type DefaultEmojiSearchEntryLike = {
  emoji: string;
  category: string;
  searchIndex: string;
};

type DefaultEmojiSearchAdapterOptions<TEntry extends DefaultEmojiSearchEntryLike> = {
  searchQuery: string;
  selectedCategory: string;
  entries: TEntry[];
  toSearchTerms: (value: string) => string[];
};

export function useDefaultEmojiSearchAdapter<TEntry extends DefaultEmojiSearchEntryLike>({
  searchQuery,
  selectedCategory,
  entries,
  toSearchTerms,
}: DefaultEmojiSearchAdapterOptions<TEntry>) {
  const trimmedEmojiSearchQuery = searchQuery.trim();
  const emojiSearchTerms = useMemo(
    () => toSearchTerms(trimmedEmojiSearchQuery),
    [toSearchTerms, trimmedEmojiSearchQuery]
  );
  const hasEmojiSearchQuery = trimmedEmojiSearchQuery.length > 0;
  const lowerQuery = trimmedEmojiSearchQuery.toLowerCase();

  const filteredEntries = useMemo(
    () => (
      hasEmojiSearchQuery
        ? entries.filter((entry) => {
          const matchesGlyph = entry.emoji.includes(trimmedEmojiSearchQuery);
          const matchesTerms = emojiSearchTerms.length > 0 && emojiSearchTerms.every((term) => entry.searchIndex.includes(term));
          return matchesGlyph || matchesTerms;
        })
        : entries.filter((entry) => entry.category === selectedCategory)
    ),
    [emojiSearchTerms, entries, hasEmojiSearchQuery, selectedCategory, trimmedEmojiSearchQuery]
  );

  return {
    trimmedEmojiSearchQuery,
    emojiSearchTerms,
    hasEmojiSearchQuery,
    lowerSearchQuery: lowerQuery,
    filteredEntries,
  };
}

export function focusTextInputToEnd(input: HTMLTextAreaElement | null) {
  if (!input) return;
  input.focus();
  const len = input.value.length;
  try {
    input.setSelectionRange(len, len);
  } catch {
    // ignore selection errors
  }
}
