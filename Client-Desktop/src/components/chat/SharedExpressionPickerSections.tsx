import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

type PickerTab = 'emojis' | 'stickers';

export type SharedPickerServerLike = {
  url: string;
  name: string;
  icon?: string;
  isDefault?: boolean;
  isPersonal?: boolean;
};

interface SharedExpressionPickerSidebarProps<TEntry extends SharedPickerServerLike> {
  entries: TEntry[];
  selectedUrl: string | null;
  pickerTab: PickerTab;
  isExternalBlocked: (entry: TEntry, tab: PickerTab) => boolean;
  onSelect: (entry: TEntry) => void;
}

export function SharedExpressionPickerSidebar<TEntry extends SharedPickerServerLike>({
  entries,
  selectedUrl,
  pickerTab,
  isExternalBlocked,
  onSelect,
}: SharedExpressionPickerSidebarProps<TEntry>) {
  const { t } = useTranslation();
  return (
    <>
      {entries.map((entry) => {
        const externalBlocked = isExternalBlocked(entry, pickerTab);
        return (
          <button
            key={entry.url}
            type="button"
            disabled={externalBlocked}
            onClick={() => onSelect(entry)}
            className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
              selectedUrl === entry.url
                ? 'bg-accent text-white'
                : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            } ${externalBlocked ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={externalBlocked ? t('emotePicker.externalBlocked') : entry.name}
          >
            {entry.icon ? (
              <img src={entry.icon} alt={entry.name} loading="lazy" className="w-5 h-5 rounded" />
            ) : (
              <div className="w-5 h-5 rounded bg-bg-hover text-[10px] flex items-center justify-center uppercase">
                {entry.isDefault ? '★' : entry.isPersonal ? 'P' : entry.name.charAt(0)}
              </div>
            )}
            <span className="truncate">{entry.name}</span>
          </button>
        );
      })}
    </>
  );
}

interface SharedExpressionPickerBodyStateProps {
  hasSelectedServer: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  noServerText?: string;
  loadingText?: string;
  children: ReactNode;
}

export function SharedExpressionPickerBodyState({
  hasSelectedServer,
  loading = false,
  error = null,
  onRetry,
  noServerText = 'No servers available.',
  loadingText = 'Loading expressions...',
  children,
}: SharedExpressionPickerBodyStateProps) {
  const { t } = useTranslation();
  return (
    <>
      {!hasSelectedServer && (
        <div className="text-xs text-text-muted">{noServerText === 'No servers available.' ? t('emotePicker.noServers') : noServerText}</div>
      )}
      {hasSelectedServer && loading && (
        <div className="text-xs text-text-muted">{loadingText === 'Loading expressions...' ? t('emotePicker.loadingExpressions') : loadingText}</div>
      )}
      {hasSelectedServer && error && (
        <div className="space-y-2">
          <div className="text-xs text-danger">{error}</div>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="px-2 py-1 rounded text-xs bg-bg-hover text-text-secondary hover:text-text-primary"
            >
              {t('common.retry')}
            </button>
          ) : null}
        </div>
      )}
      {children}
    </>
  );
}

type DefaultEmojiCategoryLike = {
  name: string;
};

type DefaultEmojiEntryLike = {
  key: string;
  emoji: string;
  category: string;
};

interface SharedDefaultEmojiPickerProps<TCategory extends DefaultEmojiCategoryLike, TEntry extends DefaultEmojiEntryLike> {
  hasSearchQuery: boolean;
  selectedCategoryName: string;
  categories: TCategory[];
  onSelectCategory: (categoryName: string) => void;
  emojiMetadataLoaded: boolean;
  entries: TEntry[];
  onSelectEmoji: (emoji: string) => void;
}

export function SharedDefaultEmojiPicker<TCategory extends DefaultEmojiCategoryLike, TEntry extends DefaultEmojiEntryLike>({
  hasSearchQuery,
  selectedCategoryName,
  categories,
  onSelectCategory,
  emojiMetadataLoaded,
  entries,
  onSelectEmoji,
}: SharedDefaultEmojiPickerProps<TCategory, TEntry>) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-text-muted mb-2">
        {hasSearchQuery ? t('emotePicker.defaultEmojiResults') : selectedCategoryName}
      </div>
      {!hasSearchQuery && (
        <div className="flex flex-wrap gap-1 mb-2">
          {categories.map((category) => (
            <button
              key={category.name}
              type="button"
              onClick={() => onSelectCategory(category.name)}
              className={`px-2 py-1 rounded text-[10px] border ${
                selectedCategoryName === category.name
                  ? 'bg-accent text-white border-accent'
                  : 'bg-bg-input text-text-muted border-border hover:text-text-primary hover:border-accent'
              }`}
              title={category.name}
            >
              {category.name}
            </button>
          ))}
        </div>
      )}
      {hasSearchQuery && !emojiMetadataLoaded && (
        <div className="text-xs text-text-muted mb-2">{t('emotePicker.loadingEmojiMetadata')}</div>
      )}
      {entries.length === 0 ? (
        <div className="text-xs text-text-muted">{t('emotePicker.noMatchingDefaultEmojis')}</div>
      ) : (
        <div className="grid grid-cols-8 gap-1">
          {entries.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => onSelectEmoji(entry.emoji)}
              className="h-8 rounded bg-bg-input border border-border hover:border-accent text-base"
              title={hasSearchQuery ? `${entry.emoji} • ${entry.category}` : entry.emoji}
            >
              {entry.emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type PickerExpressionLike = {
  name: string;
};

type PickerExpressionItemLike<TExpression extends PickerExpressionLike> = {
  key: string;
  expression: TExpression;
  sourceUrl: string;
};

interface SharedEmotePickerGridProps<TExpression extends PickerExpressionLike, TItem extends PickerExpressionItemLike<TExpression>> {
  isPersonal: boolean;
  hasSearchQuery: boolean;
  items: TItem[];
  disabled?: boolean;
  resolveAssetUrl: (item: TItem) => string;
  onSelect: (item: TItem) => void;
}

export function SharedEmotePickerGrid<
  TExpression extends PickerExpressionLike,
  TItem extends PickerExpressionItemLike<TExpression>,
>({
  isPersonal,
  hasSearchQuery,
  items,
  disabled = false,
  resolveAssetUrl,
  onSelect,
}: SharedEmotePickerGridProps<TExpression, TItem>) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-text-muted mb-2">
        {isPersonal ? t('emotePicker.personalEmotes') : t('emotePicker.serverEmotes')}
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-text-muted">
          {hasSearchQuery
            ? t(isPersonal ? 'emotePicker.noMatchingPersonalEmotes' : 'emotePicker.noMatchingServerEmotes')
            : t(isPersonal ? 'emotePicker.noPersonalEmotes' : 'emotePicker.noServerEmotes')}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1.5">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(item)}
              className="p-1 rounded bg-bg-input border border-border hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed"
              title={item.expression.name}
            >
              <img src={resolveAssetUrl(item)} alt={item.expression.name} className="w-7 h-7 object-contain mx-auto" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface SharedStickerPickerGridProps<TExpression extends PickerExpressionLike, TItem extends PickerExpressionItemLike<TExpression>> {
  isPersonal: boolean;
  hasSearchQuery: boolean;
  items: TItem[];
  disabled?: boolean;
  resolveAssetUrl: (item: TItem) => string;
  onSelect: (item: TItem) => void;
}

export function SharedStickerPickerGrid<
  TExpression extends PickerExpressionLike,
  TItem extends PickerExpressionItemLike<TExpression>,
>({
  isPersonal,
  hasSearchQuery,
  items,
  disabled = false,
  resolveAssetUrl,
  onSelect,
}: SharedStickerPickerGridProps<TExpression, TItem>) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-text-muted mb-2">
        {isPersonal ? t('emotePicker.personalStickers') : t('emotePicker.serverStickers')}
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-text-muted">
          {hasSearchQuery
            ? t(isPersonal ? 'emotePicker.noMatchingPersonalStickers' : 'emotePicker.noMatchingServerStickers')
            : t(isPersonal ? 'emotePicker.noPersonalStickers' : 'emotePicker.noServerStickers')}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(item)}
              className="rounded border border-border bg-bg-input hover:border-accent p-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              title={item.expression.name}
            >
              <img src={resolveAssetUrl(item)} alt={item.expression.name} className="w-full h-16 object-contain rounded" loading="lazy" />
              <div className="mt-1 text-[10px] text-text-muted truncate">{item.expression.name}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface SharedExpressionTabContentProps {
  warningText?: string | null;
  isDefault: boolean;
  defaultContent?: ReactNode;
  nonDefaultContent: ReactNode;
  defaultFallbackText?: string;
}

export function SharedExpressionTabContent({
  warningText = null,
  isDefault,
  defaultContent,
  nonDefaultContent,
  defaultFallbackText,
}: SharedExpressionTabContentProps) {
  return (
    <div className="space-y-3">
      {warningText ? (
        <div className="text-xs text-warning">
          {warningText}
        </div>
      ) : null}
      {isDefault
        ? (defaultContent ?? (
          defaultFallbackText ? <div className="text-xs text-text-muted">{defaultFallbackText}</div> : null
        ))
        : nonDefaultContent}
    </div>
  );
}
