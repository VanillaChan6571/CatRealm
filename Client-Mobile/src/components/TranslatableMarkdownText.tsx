import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { Languages } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { useAutoTranslation } from '@/lib/translation/useAutoTranslation';
import { MarkdownText } from './MarkdownText';
import { Text } from './Text';

type Props = ComponentProps<typeof MarkdownText> & { messageId: string };

/**
 * A message body with Cat Lab auto-translate: shows the on-device translation when there is
 * one, with desktop's "Translated from Spanish · 94% confidence · Show original" note.
 * Attachments, embeds and emotes render the same either way.
 */
export function TranslatableMarkdownText({ messageId, text, ...props }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { translation, showOriginal, toggleOriginal } = useAutoTranslation(messageId, text);

  if (!translation) return <MarkdownText text={text} {...props} />;

  return (
    <>
      <MarkdownText text={showOriginal ? text : translation.text} {...props} />
      <View style={styles.note}>
        <Languages size={12} color={theme.colors.text3} />
        {/* One text run so the toggle wraps inline with the note instead of jumping lines. */}
        <Text variant="caption" color={theme.colors.text3} style={styles.noteText}>
          {t('chat.translatedFrom', { language: t(`chat.languageName_${translation.from}`) })}
          {translation.confidence !== null
            ? `\u00A0· ${t('chat.translationConfidence', { percent: Math.round(translation.confidence * 100) })}`
            : ''}
          {'\u00A0· '}
          <Text
            variant="caption"
            color={theme.colors.accentText}
            style={styles.toggle}
            onPress={toggleOriginal}
            suppressHighlighting
            accessibilityRole="button"
          >
            {/* Non-breaking spaces keep the link and each "·" on one line. */}
            {(showOriginal ? t('chat.showTranslation') : t('chat.showOriginal')).replace(/ /g, '\u00A0')}
          </Text>
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    marginTop: 2,
  },
  noteText: {
    flex: 1,
  },
  toggle: {
    fontWeight: '600',
  },
});
