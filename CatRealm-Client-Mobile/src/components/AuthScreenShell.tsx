import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useTheme } from '@/theme';
import { Pressable } from './Pressable';
import { Text } from './Text';

export function AuthScreenShell({
  children,
}: {
  children: ReactNode;
  /** Deprecated: every auth screen scrolls now so the keyboard can never cover the submit button. */
  scroll?: boolean;
}) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  // iOS keyboard handling is done by hand: pad the scroll content by the real
  // keyboard height and scroll the card's bottom (2FA field + submit button)
  // above it. KeyboardAvoidingView and inset-adjustment both left the lower
  // half of the card hidden — insets only keep the FOCUSED field visible.
  const [keyboardPad, setKeyboardPad] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillShow', (e) => {
      setKeyboardPad(e.endCoordinates?.height ?? 0);
      // Let the padding land before measuring the new content end.
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    });
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardPad(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const contentStyle = [
    styles.content,
    {
      paddingHorizontal: theme.spacing.xl,
      paddingVertical: theme.spacing.xl,
      paddingBottom: theme.spacing.xl + 24 + keyboardPad,
    },
  ];

  // Always a ScrollView: the old static branch had no keyboard handling on iOS,
  // so the keyboard covered the sign-in button with no way to reach it.
  // persistTaps lets the button take the first tap while the keyboard is up.
  const body = (
    <ScrollView
      ref={scrollRef}
      keyboardDismissMode="none"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={contentStyle}
    >
      <View style={styles.column}>{children}</View>
    </ScrollView>
  );

  if (Platform.OS === 'ios') {
    return <View style={styles.keyboardAvoider}>{body}</View>;
  }

  // Android's adjustResize already shrinks the root window. A second height
  // adjustment can cover the submit buttons or leave them outside hit-testing.
  return <View style={styles.keyboardAvoider}>{body}</View>;
}

export function AuthScreenHeader({
  title,
  subtitle,
  backLabel,
  onBack,
  large = false,
}: {
  title: string;
  subtitle?: string;
  backLabel?: string;
  onBack?: () => void;
  large?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center', marginBottom: theme.spacing.xl }}>
      <Text
        variant={large ? 'display' : 'title'}
        color={theme.colors.text}
        style={{ textAlign: 'center', marginBottom: theme.spacing.xs }}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text variant="bodySmall" color={theme.colors.text2} style={{ textAlign: 'center' }}>
          {subtitle}
        </Text>
      ) : null}
      {backLabel && onBack ? (
        <Pressable minHit={32} onPress={onBack} style={{ marginTop: theme.spacing.xs }}>
          <Text variant="caption" color={theme.colors.text3}>
            {backLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function AuthCard({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.bgSidebar,
          borderColor: theme.colors.line,
          borderRadius: theme.radius.lg,
          padding: theme.spacing.xl,
          gap: theme.spacing.lg,
        },
      ]}
    >
      {children}
    </View>
  );
}

export function AuthTabRow({
  active,
  onLogin,
  onRegister,
}: {
  active: 'login' | 'register';
  onLogin: () => void;
  onRegister: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.tabs, { borderBottomColor: theme.colors.line }]}>
      <Pressable minHit={32} onPress={onLogin} style={styles.tabButton}>
        <Text
          variant="bodySmall"
          weight="600"
          color={active === 'login' ? theme.colors.text : theme.colors.text3}
          style={[
            styles.tabText,
            active === 'login' && { borderBottomColor: theme.colors.accent },
          ]}
        >
          Log In
        </Text>
      </Pressable>
      <Pressable minHit={32} onPress={onRegister} style={styles.tabButton}>
        <Text
          variant="bodySmall"
          weight="600"
          color={active === 'register' ? theme.colors.text : theme.colors.text3}
          style={[
            styles.tabText,
            active === 'register' && { borderBottomColor: theme.colors.accent },
          ]}
        >
          Register
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  keyboardAvoider: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    minHeight: '100%',
    justifyContent: 'center',
  },
  column: {
    alignSelf: 'center',
    maxWidth: 390,
    width: '100%',
  },
  card: {
    borderWidth: 1,
  },
  tabs: {
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 16,
    paddingBottom: 8,
  },
  tabButton: {
    alignItems: 'flex-start',
  },
  tabText: {
    borderBottomColor: 'transparent',
    borderBottomWidth: 2,
    paddingBottom: 4,
  },
});
