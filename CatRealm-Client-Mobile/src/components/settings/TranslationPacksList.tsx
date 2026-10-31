import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { PACK_LANGUAGES, packBytes, useTranslationPacks, type PackLanguage } from '@/lib/translation';
import type { PackStatus } from '@/lib/translation/packStore';
import { Pressable } from '../Pressable';
import { Text } from '../Text';

const NATIVE_NAMES: Record<'en' | PackLanguage, string> = { en: 'English', es: 'Español', ru: 'Русский', ja: '日本語' };
const formatMb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

function useLanguageName() {
  const { t } = useTranslation();
  return (code: 'en' | PackLanguage) => {
    const local = t(`chat.languageName_${code}`);
    const native = NATIVE_NAMES[code];
    return local.toLowerCase() === native.toLowerCase() ? local : `${local} · ${native}`;
  };
}

function ActionButton({ label, onPress, tone = 'accent' }: { label: string; onPress: () => void; tone?: 'accent' | 'muted' | 'danger' }) {
  const theme = useTheme();
  const color = tone === 'accent' ? theme.colors.accentText : tone === 'danger' ? theme.colors.danger : theme.colors.text2;
  return (
    // 32pt pill; Pressable's 8pt hitSlop keeps the touch target at 48.
    <Pressable haptic minHit={32} onPress={onPress} style={[styles.button, { borderColor: theme.colors.lineSoft, backgroundColor: theme.colors.bgElev3 }]}>
      <Text variant="caption" color={color} style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function PackActions({ lang, status }: { lang: PackLanguage; status: PackStatus }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const install = useTranslationPacks((s) => s.install);
  const remove = useTranslationPacks((s) => s.remove);
  switch (status.state) {
    case 'downloading': {
      const percent = Math.floor((status.loadedBytes / Math.max(1, status.totalBytes)) * 100);
      return (
        <View style={styles.progressRow}>
          <View style={[styles.progressTrack, { backgroundColor: theme.colors.bgElev3 }]}>
            <View style={[styles.progressFill, { width: `${percent}%`, backgroundColor: theme.colors.accent }]} />
          </View>
          <Text variant="caption" color={theme.colors.text3} style={styles.percent}>{percent}%</Text>
        </View>
      );
    }
    case 'installed':
      return (
        <>
          <View style={styles.installed}>
            <Check size={14} color={theme.colors.online} />
            <Text variant="caption" color={theme.colors.online}>{t('settings.translatePackInstalled')}</Text>
          </View>
          <ActionButton label={t('settings.translatePackRemove')} tone="muted" onPress={() => void remove(lang)} />
        </>
      );
    case 'outdated':
      return (
        <>
          <ActionButton label={t('settings.translatePackUpdate')} onPress={() => void install(lang)} />
          <ActionButton label={t('settings.translatePackRemove')} tone="muted" onPress={() => void remove(lang)} />
        </>
      );
    case 'error':
      return (
        <>
          <Text variant="caption" color={theme.colors.danger}>{t('settings.translatePackFailed')}</Text>
          <ActionButton label={t('settings.translatePackRetry')} onPress={() => void install(lang)} />
        </>
      );
    default:
      return <ActionButton label={t('settings.translatePackInstall')} onPress={() => void install(lang)} />;
  }
}

/** Per-language model packs for Cat Lab auto-translate: install, update or remove each, or all at once. */
export function TranslationPacksList() {
  const theme = useTheme();
  const { t } = useTranslation();
  const languageName = useLanguageName();
  const packs = useTranslationPacks((s) => s.packs);
  const checked = useTranslationPacks((s) => s.checked);
  const install = useTranslationPacks((s) => s.install);
  const remove = useTranslationPacks((s) => s.remove);
  const refresh = useTranslationPacks((s) => s.refresh);

  // The engine WebView mounts with the toggle; ask again until it has answered once.
  useEffect(() => {
    if (checked) return;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 1500);
    return () => clearInterval(timer);
  }, [checked, refresh]);

  const busy = PACK_LANGUAGES.some((lang) => packs[lang].state === 'downloading');
  const pending = PACK_LANGUAGES.filter((lang) => packs[lang].state !== 'installed' && packs[lang].state !== 'downloading');
  const onlyUpdates = pending.length > 0 && pending.every((lang) => packs[lang].state === 'outdated');
  // Packs install one after another; parallel downloads only slow each other down.
  const installAll = async () => { for (const lang of pending) await install(lang); };
  const removeAll = () => Promise.all(PACK_LANGUAGES.map((lang) => remove(lang)));
  const divider = { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.lineSoft };

  return (
    <View style={[styles.card, { borderColor: theme.colors.lineSoft }]}>
      <View style={[styles.row, { backgroundColor: theme.colors.bgElev2 }]}>
        <View style={styles.label}>
          <Text variant="body" style={styles.bold}>{t('settings.translateAllLanguages')}</Text>
          <Text variant="caption" color={theme.colors.text3}>{t('settings.translateAllLanguagesDesc')}</Text>
        </View>
        {!checked ? (
          <ActivityIndicator color={theme.colors.accent} />
        ) : busy ? (
          <Text variant="caption" color={theme.colors.text3}>{t('settings.translatePackDownloading')}</Text>
        ) : pending.length > 0 ? (
          <ActionButton label={t(onlyUpdates ? 'settings.translateUpdateAll' : 'settings.translateInstallAll')} onPress={() => void installAll()} />
        ) : (
          <ActionButton label={t('settings.translateRemoveAll')} tone="muted" onPress={() => void removeAll()} />
        )}
      </View>
      <View style={[styles.row, divider]}>
        <Text variant="body" style={styles.label}>{languageName('en')}</Text>
        <Text variant="caption" color={theme.colors.text3}>{t('settings.translatePackBuiltIn')}</Text>
      </View>
      {PACK_LANGUAGES.map((lang) => (
        <View key={lang} style={[styles.row, divider]}>
          <View style={styles.label}>
            <Text variant="body" numberOfLines={1}>{languageName(lang)}</Text>
            <Text variant="caption" color={theme.colors.text3}>{formatMb(packBytes(lang))}</Text>
          </View>
          {checked ? <PackActions lang={lang} status={packs[lang]} /> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  label: {
    flex: 1,
    minWidth: 0,
  },
  bold: {
    fontWeight: '600',
  },
  button: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  buttonText: {
    fontWeight: '600',
  },
  installed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: 120,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  percent: {
    width: 34,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
