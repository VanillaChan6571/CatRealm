import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { AUTH_BASE } from '../../../lib/authApi';
import { EMOTE_SIZE_OPTIONS, sanitizeExpressionName } from './emoteHelpers';
import type { EmotePreviewItem, PersonalExpressionSummary, PersonalExpressionItem, PersonalExpressionGroups } from './settingsTypes';

type EmotesTabProps = {
  emoteSizePx: number;
  setEmoteSizePx: (px: 24 | 32 | 48 | 64 | 96 | 128 | 256 | 512) => void;
  emoteSizeIndex: number;
  emotePreviewItems: EmotePreviewItem[];
  loadingEmotePreview: boolean;
  randomizeEmotePreview: () => void;
  personalSummary: PersonalExpressionSummary;
  personalExpressions: PersonalExpressionGroups;
  personalEmoteItems: PersonalExpressionItem[];
  personalStickerItems: PersonalExpressionItem[];
  personalLoading: boolean;
  personalError: string | null;
  uploadingPersonalKind: 'emotes' | 'stickers' | null;
  personalRenameDrafts: Record<string, string>;
  setPersonalRenameDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  savingPersonalId: string | null;
  deletingPersonalId: string | null;
  personalEmoteInputRef: RefObject<HTMLInputElement | null>;
  personalStickerInputRef: RefObject<HTMLInputElement | null>;
  isCentral: boolean;
  personalTokenSuffix: string;
  uploadPersonalExpression: (kind: 'emotes' | 'stickers', file: File | null) => void;
  renamePersonalExpression: (item: PersonalExpressionItem) => void;
  deletePersonalExpression: (item: PersonalExpressionItem) => void;
  resolvePersonalTokenAlias: (item: PersonalExpressionItem) => string;
};

export function EmotesTab(props: EmotesTabProps) {
  const { t } = useTranslation();
  const {
    emoteSizePx,
    setEmoteSizePx,
    emoteSizeIndex,
    emotePreviewItems,
    loadingEmotePreview,
    randomizeEmotePreview,
    personalSummary,
    personalEmoteItems,
    personalStickerItems,
    personalLoading,
    personalError,
    uploadingPersonalKind,
    personalRenameDrafts,
    setPersonalRenameDrafts,
    savingPersonalId,
    deletingPersonalId,
    personalEmoteInputRef,
    personalStickerInputRef,
    isCentral,
    personalTokenSuffix,
    uploadPersonalExpression,
    renamePersonalExpression,
    deletePersonalExpression,
    resolvePersonalTokenAlias,
  } = props;

  return (
    <div className="space-y-6 max-w-2xl">
      <h3 className="text-xl font-bold text-text-primary">{t('settings.navEmotesSettings')}</h3>

      <div className="space-y-4 bg-bg-hover/30 p-4 rounded-lg">
        <h4 className="text-sm font-semibold text-text-primary uppercase tracking-wide">{t('emotes.settingsTitle')}</h4>
        <p className="text-sm text-text-muted">{t('emotes.settingsDesc')}</p>

        <div className="space-y-2">
          <input
            type="range"
            min={0}
            max={EMOTE_SIZE_OPTIONS.length - 1}
            value={emoteSizeIndex}
            onChange={(e) => {
              const nextIndex = Number(e.target.value);
              const nextSize = EMOTE_SIZE_OPTIONS[nextIndex] ?? 128;
              setEmoteSizePx(nextSize);
              randomizeEmotePreview();
            }}
            className="w-full"
          />
          <div className="grid grid-cols-8 text-[11px] text-text-muted">
            {EMOTE_SIZE_OPTIONS.map((size) => (
              <span key={size} className={`text-center ${size === emoteSizePx ? 'text-text-primary font-semibold' : ''}`}>
                {size}x
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-text-primary">
            {t('emotes.previewSize', { size: emoteSizePx })}
          </p>
          <div className="flex flex-wrap items-end gap-3 rounded border border-border bg-bg-input p-3 min-h-16">
            {loadingEmotePreview && (
              <span className="text-xs text-text-muted">{t('emotes.loadingPreview')}</span>
            )}
            {!loadingEmotePreview && emotePreviewItems.map((item) => (
              <div
                key={item.id}
                className="inline-flex items-center justify-center"
                style={{ width: `${emoteSizePx}px`, height: `${emoteSizePx}px` }}
                title={item.label}
              >
                {item.src ? (
                  <img
                    src={item.src}
                    alt={item.label}
                    loading="lazy"
                    className="object-contain"
                    style={{ width: `${emoteSizePx}px`, height: `${emoteSizePx}px` }}
                  />
                ) : (
                  <span style={{ fontSize: `${Math.max(16, Math.min(48, Math.round(emoteSizePx * 0.7)))}px` }}>
                    {item.emoji || '😀'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-4 bg-bg-hover/30 p-4 rounded-lg">
        <h4 className="text-sm font-semibold text-text-primary uppercase tracking-wide">{t('emotes.personalEmotes')}</h4>
        <p className="text-sm text-text-muted">
          {t('emotes.personalDesc')}
        </p>
        <p className="text-xs text-yellow-300">
          {t('emotes.externalWarning')}
        </p>
        <p className="text-xs text-text-muted">
          {t('emotes.formatExample')} <code className="bg-bg-input px-1 py-0.5 rounded">:angel:{personalTokenSuffix}:</code>
        </p>

        {personalError && (
          <div className="text-xs text-yellow-300 rounded border border-yellow-500/40 bg-yellow-500/10 px-3 py-2">
            {personalError}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between rounded border border-border bg-bg-input px-3 py-2">
            <span className="text-sm text-text-primary">
              Animated / Emotes {personalSummary.animatedEmotes}/{personalSummary.emoteLimit}
            </span>
            <button
              type="button"
              onClick={() => personalEmoteInputRef.current?.click()}
              disabled={!isCentral || uploadingPersonalKind === 'emotes'}
              className="px-2 py-1 rounded border border-border text-text-primary hover:bg-bg-hover disabled:opacity-50"
            >
              [ + ]
            </button>
          </div>
          <div className="flex items-center justify-between rounded border border-border bg-bg-input px-3 py-2">
            <span className="text-sm text-text-primary">
              Animated / Stickers {personalSummary.animatedStickers}/{personalSummary.stickerLimit}
            </span>
            <button
              type="button"
              onClick={() => personalStickerInputRef.current?.click()}
              disabled={!isCentral || uploadingPersonalKind === 'stickers'}
              className="px-2 py-1 rounded border border-border text-text-primary hover:bg-bg-hover disabled:opacity-50"
            >
              [ + ]
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-text-muted">{t('emotes.yourEmotes')}</p>
            {personalEmoteItems.length === 0 && (
              <p className="text-xs text-text-muted">{t('emotes.noPersonalEmotes')}</p>
            )}
            {personalEmoteItems.map((item) => {
              const previewUrl = item.absolute_url || (item.file_url && (/^https?:\/\//i.test(item.file_url)
                ? item.file_url
                : `${AUTH_BASE}${item.file_url}`));
              const itemId = String(item.id || '');
              const draftValue = personalRenameDrafts[itemId] ?? item.name;
              const normalizedDraft = sanitizeExpressionName(draftValue);
              const canSave = normalizedDraft.length > 0 && normalizedDraft !== sanitizeExpressionName(item.name);
              const tokenAlias = resolvePersonalTokenAlias(item);
              return (
                <div key={itemId} className="rounded border border-border bg-bg-input px-3 py-2 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 shrink-0 rounded bg-bg-hover flex items-center justify-center overflow-hidden">
                      {previewUrl ? (
                        <img src={previewUrl} alt={item.name} loading="lazy" className="h-full w-full object-contain" />
                      ) : (
                        <span className="text-xs text-text-muted">N/A</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-text-muted truncate">Token: <code>{tokenAlias}</code></p>
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          type="text"
                          value={draftValue}
                          onChange={(e) => {
                            const next = sanitizeExpressionName(e.target.value);
                            setPersonalRenameDrafts((prev) => ({ ...prev, [itemId]: next }));
                          }}
                          className="w-full rounded border border-border bg-bg-chat px-2 py-1 text-sm text-text-primary"
                          placeholder="emote-name"
                        />
                        <button
                          type="button"
                          onClick={() => void renamePersonalExpression(item)}
                          disabled={!canSave || savingPersonalId === itemId}
                          className="px-2 py-1 rounded border border-border text-text-primary hover:bg-bg-hover disabled:opacity-50"
                        >
                          {t('common.save')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deletePersonalExpression(item)}
                          disabled={deletingPersonalId === itemId}
                          className="px-2 py-1 rounded border border-red-500/50 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          {t('common.remove')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-text-muted">{t('emotes.yourStickers')}</p>
            {personalStickerItems.length === 0 && (
              <p className="text-xs text-text-muted">{t('emotes.noPersonalStickers')}</p>
            )}
            {personalStickerItems.map((item) => {
              const previewUrl = item.absolute_url || (item.file_url && (/^https?:\/\//i.test(item.file_url)
                ? item.file_url
                : `${AUTH_BASE}${item.file_url}`));
              const itemId = String(item.id || '');
              const draftValue = personalRenameDrafts[itemId] ?? item.name;
              const normalizedDraft = sanitizeExpressionName(draftValue);
              const canSave = normalizedDraft.length > 0 && normalizedDraft !== sanitizeExpressionName(item.name);
              const tokenAlias = resolvePersonalTokenAlias(item);
              return (
                <div key={itemId} className="rounded border border-border bg-bg-input px-3 py-2 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 shrink-0 rounded bg-bg-hover flex items-center justify-center overflow-hidden">
                      {previewUrl ? (
                        <img src={previewUrl} alt={item.name} loading="lazy" className="h-full w-full object-contain" />
                      ) : (
                        <span className="text-xs text-text-muted">N/A</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-text-muted truncate">Token: <code>:sticker:{tokenAlias.replace(/^:/, '')}</code></p>
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          type="text"
                          value={draftValue}
                          onChange={(e) => {
                            const next = sanitizeExpressionName(e.target.value);
                            setPersonalRenameDrafts((prev) => ({ ...prev, [itemId]: next }));
                          }}
                          className="w-full rounded border border-border bg-bg-chat px-2 py-1 text-sm text-text-primary"
                          placeholder="sticker-name"
                        />
                        <button
                          type="button"
                          onClick={() => void renamePersonalExpression(item)}
                          disabled={!canSave || savingPersonalId === itemId}
                          className="px-2 py-1 rounded border border-border text-text-primary hover:bg-bg-hover disabled:opacity-50"
                        >
                          {t('common.save')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deletePersonalExpression(item)}
                          disabled={deletingPersonalId === itemId}
                          className="px-2 py-1 rounded border border-red-500/50 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          {t('common.remove')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {personalLoading && (
          <p className="text-xs text-text-muted">{t('emotes.loadingPersonalLimits')}</p>
        )}

        <input
          ref={personalEmoteInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/apng"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            void uploadPersonalExpression('emotes', file);
            e.currentTarget.value = '';
          }}
        />
        <input
          ref={personalStickerInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/apng"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            void uploadPersonalExpression('stickers', file);
            e.currentTarget.value = '';
          }}
        />
      </div>
    </div>
  );
}
