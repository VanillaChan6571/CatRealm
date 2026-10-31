import { useEffect, useRef, useState } from 'react';
import type * as ClipboardModule from 'expo-clipboard';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Pressable } from './Pressable';
import { Text } from './Text';

export function PasteCodeButton({ disabled = false, onCode }: {
  disabled?: boolean;
  onCode: (code: string) => Promise<void>;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reading = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ disabled, onCode });
  latest.current = { disabled, onCode };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const paste = async () => {
    if (latest.current.disabled || reading.current) return;
    reading.current = true;
    setBusy(true);
    setError(null);
    try {
      let text: string;
      try {
        // Read only after a tap. Lazy loading keeps older development clients usable.
        const Clipboard: typeof ClipboardModule = require('expo-clipboard');
        text = await Clipboard.getStringAsync();
      } catch {
        if (mounted.current) setError(t('auth.clipboardReadFailed'));
        return;
      }
      if (!mounted.current || latest.current.disabled) return;
      // Authenticator apps sometimes copy a space-separated code. Never truncate
      // arbitrary clipboard text into a code or lose leading zeroes.
      const code = text.replace(/\s/g, '');
      if (!/^\d{6}$/.test(code)) {
        setError(t('auth.clipboardInvalidCode'));
        return;
      }
      await latest.current.onCode(code);
    } finally {
      reading.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <View style={{ marginTop: theme.spacing.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || busy, busy }}
        disabled={disabled || busy}
        onPress={() => { void paste(); }}
        style={{
          borderWidth: 1,
          borderColor: theme.colors.line,
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.spacing.md,
          opacity: disabled || busy ? 0.5 : 1,
        }}
      >
        <Text variant="bodySmall" color={theme.colors.text}>
          {t('auth.pasteAndGo')}
        </Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" variant="bodySmall" color={theme.colors.danger} style={{ marginTop: theme.spacing.sm }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
