import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { Button } from '../../ui/Button';
import { PACK_LANGUAGES, packBytes, useTranslationPacks, type PackLanguage } from '../../../lib/translation';
import type { PackStatus } from '../../../lib/translation/packStore';

const formatMb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

function useLanguageNames() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const local = new Intl.DisplayNames([i18n.language], { type: 'language' });
    return (code: string) => {
      const name = local.of(code) ?? code;
      const native = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
      return native.toLowerCase() === name.toLowerCase() ? name : `${name} · ${native}`;
    };
  }, [i18n.language]);
}

function Progress({ status }: { status: PackStatus }) {
  const percent = Math.floor((status.loadedBytes / Math.max(1, status.totalBytes)) * 100);
  return (
    <div className="flex items-center gap-2 w-40">
      <div className="h-1.5 flex-1 rounded-full bg-bg-hover overflow-hidden">
        <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs text-text-muted tabular-nums w-9 text-right">{percent}%</span>
    </div>
  );
}

function PackActions({ lang, status }: { lang: PackLanguage; status: PackStatus }) {
  const { t } = useTranslation();
  const install = useTranslationPacks((s) => s.install);
  const remove = useTranslationPacks((s) => s.remove);
  switch (status.state) {
    case 'downloading':
      return <Progress status={status} />;
    case 'installed':
      return (
        <>
          <span className="inline-flex items-center gap-1 text-xs text-green-400">
            <Check size={14} /> {t('settingsContent.translatePackInstalled')}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void remove(lang)}>{t('settingsContent.translatePackRemove')}</Button>
        </>
      );
    case 'outdated':
      return (
        <>
          <Button size="sm" onClick={() => void install(lang)}>{t('settingsContent.translatePackUpdate')}</Button>
          <Button size="sm" variant="ghost" onClick={() => void remove(lang)}>{t('settingsContent.translatePackRemove')}</Button>
        </>
      );
    case 'error':
      return (
        <>
          <span className="text-xs text-red-400" title={status.error ?? undefined}>{t('settingsContent.translatePackFailed')}</span>
          <Button size="sm" variant="secondary" onClick={() => void install(lang)}>{t('settingsContent.translatePackRetry')}</Button>
        </>
      );
    default:
      return <Button size="sm" variant="secondary" onClick={() => void install(lang)}>{t('settingsContent.translatePackInstall')}</Button>;
  }
}

/** Per-language model packs for CatLab auto-translate: install, update or remove each, or all at once. */
export function TranslationPacksPanel() {
  const { t } = useTranslation();
  const languageName = useLanguageNames();
  const packs = useTranslationPacks((s) => s.packs);
  const install = useTranslationPacks((s) => s.install);
  const remove = useTranslationPacks((s) => s.remove);
  const refresh = useTranslationPacks((s) => s.refresh);

  useEffect(() => { void refresh(); }, [refresh]);

  const states = PACK_LANGUAGES.map((lang) => packs[lang].state);
  const busy = states.includes('downloading');
  const pending = PACK_LANGUAGES.filter((lang) => packs[lang].state !== 'installed' && packs[lang].state !== 'downloading');
  const onlyUpdates = pending.length > 0 && pending.every((lang) => packs[lang].state === 'outdated');
  // Packs install one after another; parallel 100 MB downloads only slow each other down.
  const installAll = async () => { for (const lang of pending) await install(lang); };
  const removeAll = () => Promise.all(PACK_LANGUAGES.map((lang) => remove(lang)));

  return (
    <div className="rounded-lg border border-border divide-y divide-border">
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-bg-hover/30">
        <div>
          <p className="text-sm font-semibold text-text-primary">{t('settingsContent.translateAllLanguages')}</p>
          <p className="text-xs text-text-muted">{t('settingsContent.translateAllLanguagesDesc')}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {busy ? (
            <span className="text-xs text-text-muted">{t('settingsContent.translatePackDownloading')}</span>
          ) : pending.length > 0 ? (
            <Button size="sm" onClick={() => void installAll()}>
              {t(onlyUpdates ? 'settingsContent.translateUpdateAll' : 'settingsContent.translateInstallAll')}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => void removeAll()}>{t('settingsContent.translateRemoveAll')}</Button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <p className="text-sm text-text-primary">{languageName('en')}</p>
        <span className="text-xs text-text-muted">{t('settingsContent.translatePackBuiltIn')}</span>
      </div>
      {PACK_LANGUAGES.map((lang) => (
        <div key={lang} className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-sm text-text-primary truncate">{languageName(lang)}</p>
            <p className="text-xs text-text-muted">{formatMb(packBytes(lang))}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <PackActions lang={lang} status={packs[lang]} />
          </div>
        </div>
      ))}
    </div>
  );
}
