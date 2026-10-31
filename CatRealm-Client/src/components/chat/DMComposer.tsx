import { useEffect, useMemo } from 'react';
import type { ReactNode, RefObject } from 'react';
import { ComposerSingleAttachmentChip } from './ComposerAttachments';
import { ComposerFileButton, ComposerSendButton, ComposerIconButton } from './ComposerActionButtons';
import { ComposerActionStripLeft } from './ComposerActionStrip';
import { DMComposerCore, type DMComposerCoreHandle } from './DMComposerCore';
import { SharedComposerShell } from './SharedComposerShell';
import { ComposerEmoteSuggestionList } from './ComposerEmoteSuggestionList';
import { ComposerMentionSuggestionList } from './ComposerMentionSuggestionList';
import { AUTH_BASE } from '../../lib/authApi';
import { SharedExpressionPickerPanel } from './SharedExpressionPickerPanel';
import {
  SharedDefaultEmojiPicker,
  SharedEmotePickerGrid,
  SharedExpressionPickerBodyState,
  SharedExpressionPickerSidebar,
  SharedExpressionTabContent,
  SharedStickerPickerGrid,
} from './SharedExpressionPickerSections';
import { DEFAULT_EMOJI_CATEGORIES, type DefaultEmojiCategory } from '../../lib/emojiMetadata';
import { useUIStore } from '../../stores/uiStore';
import { useVoiceStore } from '../../stores/voiceStore';

type NsfwTagKey = 'gore' | 'blood' | 'lewd' | 'spoiler';

function MultiFileThumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  return (
    <div className="relative shrink-0 w-20 h-20 rounded border border-border overflow-hidden bg-bg-elevated group">
      {isImage && <img src={url} alt={file.name} className="w-full h-full object-cover" />}
      {isVideo && <video src={url} className="w-full h-full object-cover" muted />}
      {!isImage && !isVideo && (
        <div className="w-full h-full flex items-center justify-center text-text-muted text-xs px-1 text-center truncate">
          {file.name}
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        title="Remove"
      >
        ×
      </button>
    </div>
  );
}

function DMMultiAttachmentStrip({
  files,
  error,
  nsfwTagState,
  onToggleNsfwTag,
  onRemove,
}: {
  files: File[];
  error: string | null;
  nsfwTagState: Record<NsfwTagKey, boolean>;
  onToggleNsfwTag: (tag: NsfwTagKey, value: boolean) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap gap-2 mb-2">
        {files.map((file, i) => (
          <MultiFileThumb key={`${file.name}-${i}`} file={file} onRemove={() => onRemove(i)} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-text-secondary">
        <span className="text-text-muted">NSFW tags (all):</span>
        {(['lewd', 'blood', 'gore', 'spoiler'] as NsfwTagKey[]).map((tag) => (
          <label key={tag} className="inline-flex items-center gap-1 capitalize">
            <input
              type="checkbox"
              checked={!!nsfwTagState[tag]}
              onChange={(e) => onToggleNsfwTag(tag, e.target.checked)}
            />
            {tag}
          </label>
        ))}
      </div>
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
}

type DMComposerProps = {
  otherUsername: string;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  selectedAttachments: File[];
  attachmentError: string | null;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  onAttachmentChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveAttachment: (index?: number) => void;
  selectedAttachmentNsfwTags: Record<NsfwTagKey, boolean>;
  onToggleAttachmentNsfwTag: (tag: NsfwTagKey, value: boolean) => void;
  replyBanner: { label: ReactNode; onClear: () => void } | null;
  forwardBanner: { label: ReactNode; onClear: () => void } | null;
  uploadButtonAction: Record<string, any> | null;
  pickerRef: RefObject<HTMLDivElement | null>;
  pickerButtonAction: Record<string, any> | null;
  pickerOpen: boolean;
  pickerFloatingPosition?: { x: number; y: number } | null;
  pickerTab: 'emojis' | 'stickers';
  onPickerTabChange: (tab: 'emojis' | 'stickers') => void;
  /** Cat Lab GIF picker: enables the GIFs tab and sends the chosen GIF URL. */
  gifPickerEnabled?: boolean;
  onSelectGif?: (gifUrl: string) => void;
  emojiSearchQuery: string;
  onEmojiSearchQueryChange: (value: string) => void;
  onClosePicker: () => void;
  reactionPickerMode: boolean;
  visibleExpressionServers: any[];
  effectiveSelectedServerUrl: string | null;
  currentServerUrl: string | null;
  canUseExternalEmojis: boolean;
  canUseExternalStickers: boolean;
  onSelectExpressionPickerServer: (entry: any) => void;
  selectedServer: any | null;
  selectedServerState: { loading?: boolean; error?: string | null } | null | undefined;
  onRetrySelectedExpressionServer?: () => void;
  selectedManifest: any | null;
  selectedIsExternal: boolean;
  canUseSelectedEmojiServer: boolean;
  canUseSelectedStickerServer: boolean;
  hasEmojiSearchQuery: boolean;
  defaultEmojiCategory: DefaultEmojiCategory;
  onSelectDefaultEmojiCategory: (category: DefaultEmojiCategory) => void;
  emojiMetadataLoaded: boolean;
  defaultEmojiEntries: any[];
  onInsertUnicodeEmoji: (value: string) => void;
  filteredSelectedEmoteItems: any[];
  filteredSelectedStickerItems: any[];
  resolveExpressionAssetUrl: (expression: any, sourceUrl: string, size?: number) => string;
  onInsertExpression: (kind: 'emote' | 'sticker', expression: any, sourceUrl: string, isPersonal?: boolean) => void;
  composerRef: RefObject<DMComposerCoreHandle | null>;
  onInput: (text: string, caret: number) => void;
  onFilePaste: (files: FileList) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  loading: boolean;
  sendButtonAction: Record<string, any> | null;
  emoteSuggestOpen: boolean;
  emoteSuggestItems: Array<{ label: string; previewImage?: string; previewEmoji?: string }>;
  emoteSuggestIndex: number;
  onApplyEmoteSuggestion: (item: any) => void;
  mentionOpen: boolean;
  mentionItems: Array<{ label: string; insert: string; type: string; description?: string; avatar?: string | null; accountType?: 'local' | 'central' }>;
  mentionIndex: number;
  onApplyMentionSuggestion: (item: any) => void;
  voiceMode?: boolean;
  onVoiceToggle?: () => void;
  voiceRecorderSlot?: ReactNode;
  /** Cat Lab live self-view preview, rendered above the input box. */
  previewSlot?: ReactNode;
};

export function DMComposer({
  otherUsername,
  onSubmit,
  selectedAttachments,
  attachmentError,
  attachmentInputRef,
  onAttachmentChange,
  onRemoveAttachment,
  selectedAttachmentNsfwTags,
  onToggleAttachmentNsfwTag,
  replyBanner,
  forwardBanner,
  uploadButtonAction,
  pickerRef,
  pickerButtonAction,
  pickerOpen,
  pickerFloatingPosition = null,
  pickerTab,
  onPickerTabChange,
  gifPickerEnabled = false,
  onSelectGif,
  emojiSearchQuery,
  onEmojiSearchQueryChange,
  onClosePicker,
  reactionPickerMode,
  visibleExpressionServers,
  effectiveSelectedServerUrl,
  currentServerUrl,
  canUseExternalEmojis,
  canUseExternalStickers,
  onSelectExpressionPickerServer,
  selectedServer,
  selectedServerState,
  onRetrySelectedExpressionServer,
  selectedManifest,
  selectedIsExternal,
  canUseSelectedEmojiServer,
  canUseSelectedStickerServer,
  hasEmojiSearchQuery,
  defaultEmojiCategory,
  onSelectDefaultEmojiCategory,
  emojiMetadataLoaded,
  defaultEmojiEntries,
  onInsertUnicodeEmoji,
  filteredSelectedEmoteItems,
  filteredSelectedStickerItems,
  resolveExpressionAssetUrl,
  onInsertExpression,
  composerRef,
  onInput,
  onFilePaste,
  onKeyDown,
  loading,
  sendButtonAction,
  emoteSuggestOpen,
  emoteSuggestItems,
  emoteSuggestIndex,
  onApplyEmoteSuggestion,
  mentionOpen,
  mentionItems,
  mentionIndex,
  onApplyMentionSuggestion,
  voiceMode = false,
  onVoiceToggle,
  voiceRecorderSlot,
  previewSlot,
}: DMComposerProps) {
  const voiceBarRetracted = useUIStore((s) => s.voiceBarRetracted);
  const activeVoiceChannelId = useVoiceStore((s) => s.activeChannelId);
  const composerPaddingClass = activeVoiceChannelId && !voiceBarRetracted ? 'pb-24' : 'pb-3 sm:pb-6';
  return (
    <form onSubmit={(e) => void onSubmit(e)} className={`${composerPaddingClass} border-t border-border px-3 sm:px-6 pt-3 sm:pt-6`}>
      {previewSlot}
      {selectedAttachments.length === 1 && (
        <ComposerSingleAttachmentChip
          file={selectedAttachments[0]}
          error={attachmentError}
          sizeLabel={null}
          onRemove={() => onRemoveAttachment(0)}
          nsfwTagState={selectedAttachmentNsfwTags}
          onToggleNsfwTag={onToggleAttachmentNsfwTag}
        />
      )}
      {selectedAttachments.length > 1 && (
        <DMMultiAttachmentStrip
          files={selectedAttachments}
          error={attachmentError}
          nsfwTagState={selectedAttachmentNsfwTags}
          onToggleNsfwTag={onToggleAttachmentNsfwTag}
          onRemove={(index) => onRemoveAttachment(index)}
        />
      )}
      {selectedAttachments.length === 0 && attachmentError && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-danger">{attachmentError}</span>
        </div>
      )}
      <SharedComposerShell
        replyBanner={replyBanner ? { kind: 'reply', label: replyBanner.label, onClear: replyBanner.onClear } : null}
        forwardBanner={forwardBanner ? { kind: 'forward', label: forwardBanner.label, onClear: forwardBanner.onClear } : null}
      >
        <ComposerActionStripLeft
          uploadControl={(
            <ComposerFileButton
              inputRef={attachmentInputRef}
              action={uploadButtonAction ?? {}}
              multiple
              onChange={onAttachmentChange}
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm,audio/mpeg,audio/mp4,audio/ogg,audio/wav,application/pdf,application/zip,text/plain,text/markdown,text/csv,application/json"
              className="px-3 py-2.5 text-text-muted hover:text-accent disabled:opacity-40 transition-colors"
            />
          )}
          pickerRef={pickerRef}
          pickerAction={pickerButtonAction ?? {}}
          pickerButtonClassName="px-3 py-2.5 text-text-muted hover:text-accent disabled:opacity-40 transition-colors"
          pickerPanel={pickerOpen ? (
            <SharedExpressionPickerPanel
              className="w-[30rem] max-w-[calc(100vw-2rem)]"
              floatingPosition={pickerFloatingPosition}
              pickerTab={pickerTab}
              onPickerTabChange={onPickerTabChange}
              gifPickerEnabled={gifPickerEnabled && !reactionPickerMode}
              onSelectGif={onSelectGif}
              searchValue={emojiSearchQuery}
              onSearchChange={onEmojiSearchQueryChange}
              onClose={onClosePicker}
              headerPrefix={reactionPickerMode ? (
                <span className="text-[11px] uppercase tracking-wide text-accent">Add Reaction</span>
              ) : null}
              sidebar={(
                <SharedExpressionPickerSidebar
                  entries={visibleExpressionServers}
                  selectedUrl={effectiveSelectedServerUrl}
                  pickerTab={pickerTab}
                  isExternalBlocked={(entry, tab) => {
                    const requiresExternalPermission = !entry.isDefault && (
                      entry.isPersonal || !!(currentServerUrl && entry.url !== currentServerUrl)
                    );
                    return requiresExternalPermission && ((tab === 'emojis' && !canUseExternalEmojis) || (tab === 'stickers' && !canUseExternalStickers));
                  }}
                  onSelect={onSelectExpressionPickerServer}
                />
              )}
            >
              <SharedExpressionPickerBodyState
                hasSelectedServer={!!selectedServer}
                loading={!!selectedServer && !!selectedServerState?.loading}
                error={selectedServer ? (selectedServerState?.error ?? null) : null}
                onRetry={selectedServer ? onRetrySelectedExpressionServer : undefined}
              >
                {selectedServer && selectedManifest && pickerTab === 'emojis' && (
                  <SharedExpressionTabContent
                    warningText={!selectedServer.isDefault && selectedIsExternal && !canUseSelectedEmojiServer
                      ? 'External emojis are not allowed for your current permissions.'
                      : null}
                    isDefault={!!selectedServer.isDefault}
                    defaultContent={(
                      <SharedDefaultEmojiPicker
                        hasSearchQuery={hasEmojiSearchQuery}
                        selectedCategoryName={defaultEmojiCategory}
                        categories={DEFAULT_EMOJI_CATEGORIES}
                        onSelectCategory={(categoryName) => onSelectDefaultEmojiCategory(categoryName as DefaultEmojiCategory)}
                        emojiMetadataLoaded={emojiMetadataLoaded}
                        entries={defaultEmojiEntries}
                        onSelectEmoji={onInsertUnicodeEmoji}
                      />
                    )}
                    nonDefaultContent={(
                      <SharedEmotePickerGrid
                        isPersonal={!!selectedServer.isPersonal}
                        hasSearchQuery={hasEmojiSearchQuery}
                        items={filteredSelectedEmoteItems}
                        disabled={selectedIsExternal && !canUseSelectedEmojiServer}
                        resolveAssetUrl={(item) => resolveExpressionAssetUrl(item.expression, item.sourceUrl, 32)}
                        onSelect={(item) => onInsertExpression('emote', item.expression, item.sourceUrl, !!selectedServer.isPersonal)}
                      />
                    )}
                  />
                )}
                {selectedServer && selectedManifest && pickerTab === 'stickers' && (
                  <SharedExpressionTabContent
                    warningText={!selectedServer.isDefault && selectedIsExternal && !canUseSelectedStickerServer
                      ? 'External stickers are not allowed for your current permissions.'
                      : null}
                    isDefault={!!selectedServer.isDefault}
                    defaultFallbackText="Default stickers are not available."
                    nonDefaultContent={(
                      <SharedStickerPickerGrid
                        isPersonal={!!selectedServer.isPersonal}
                        hasSearchQuery={hasEmojiSearchQuery}
                        items={filteredSelectedStickerItems}
                        disabled={selectedIsExternal && !canUseSelectedStickerServer}
                        resolveAssetUrl={(item) => resolveExpressionAssetUrl(item.expression, item.sourceUrl, 320)}
                        onSelect={(item) => onInsertExpression('sticker', item.expression, item.sourceUrl, !!selectedServer.isPersonal)}
                      />
                    )}
                  />
                )}
              </SharedExpressionPickerBodyState>
            </SharedExpressionPickerPanel>
          ) : null}
        />
        {voiceMode && voiceRecorderSlot ? (
          <div className="flex-1 px-2 py-1">
            {voiceRecorderSlot}
          </div>
        ) : (
          <DMComposerCore
            ref={composerRef}
            onInput={onInput}
            onKeyDown={onKeyDown}
            onFilePaste={onFilePaste}
            placeholder={`Message ${otherUsername}...`}
            disabled={loading}
            rightSlot={(
              <div className="flex items-center">
                {onVoiceToggle && (
                  <ComposerIconButton
                    action={{
                      onClick: onVoiceToggle,
                      title: 'Record voice message',
                      disabled: loading,
                    }}
                    className="px-2 py-2.5 text-text-muted hover:text-accent disabled:opacity-40 transition-colors"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z" />
                    </svg>
                  </ComposerIconButton>
                )}
                <ComposerSendButton action={sendButtonAction ?? {}} submit />
              </div>
            )}
          />
        )}
      </SharedComposerShell>
      <ComposerEmoteSuggestionList
        open={emoteSuggestOpen}
        items={emoteSuggestItems}
        activeIndex={emoteSuggestIndex}
        onSelect={onApplyEmoteSuggestion}
      />
      <ComposerMentionSuggestionList
        open={mentionOpen}
        items={mentionItems}
        activeIndex={mentionIndex}
        authBase={AUTH_BASE}
        onSelect={onApplyMentionSuggestion}
      />
    </form>
  );
}
