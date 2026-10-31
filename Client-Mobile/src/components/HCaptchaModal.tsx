import { useMemo, useState } from 'react';
import { Linking, Modal, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from './Text';
import { Pressable } from './Pressable';
import { buildCaptchaHtml, HCAPTCHA_BASE_URL, parseCaptchaMessage } from '@/lib/hcaptcha';

interface HCaptchaModalProps {
  visible: boolean;
  siteKey: string;
  onToken: (token: string) => void;
  onCancel: () => void;
}

export function HCaptchaModal({ visible, siteKey, onToken, onCancel }: HCaptchaModalProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const html = useMemo(() => buildCaptchaHtml(siteKey), [siteKey]);

  const handleMessage = (event: WebViewMessageEvent) => {
    const msg = parseCaptchaMessage(event.nativeEvent.data);
    if (msg?.type === 'token') onToken(msg.token);
    else if (msg?.type === 'error') setFailed(true);
  };

  // hCaptcha's own iframes load freely; its privacy/terms links open in the browser.
  const handleNavigation = (req: ShouldStartLoadRequest) => {
    if (req.isTopFrame === false || req.url.startsWith('about:') || req.url.startsWith(HCAPTCHA_BASE_URL)) return true;
    void Linking.openURL(req.url);
    return false;
  };

  const retry = () => {
    setFailed(false);
    setAttempt((n) => n + 1);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}>
      <View style={[styles.backdrop, { backgroundColor: theme.colors.scrim }]}>
        <View style={[styles.card, { backgroundColor: theme.colors.bgElev1, borderRadius: theme.radius.xl }]}>
          <Text variant="subtitle">{t('auth.captchaTitle')}</Text>
          <Text variant="bodySmall" color={theme.colors.text3}>{t('auth.captchaHint')}</Text>

          {failed ? (
            <View style={styles.failed}>
              <Text variant="bodySmall" color={theme.colors.danger} style={{ textAlign: 'center' }}>
                {t('auth.captchaFailed')}
              </Text>
              <Pressable haptic onPress={retry}
                style={[styles.btn, { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md }]}>
                <Text variant="body" color={theme.colors.textOnAccent}>{t('auth.captchaRetry')}</Text>
              </Pressable>
            </View>
          ) : (
            <WebView
              key={attempt}
              source={{ html, baseUrl: HCAPTCHA_BASE_URL }}
              originWhitelist={['*']}
              onMessage={handleMessage}
              onShouldStartLoadWithRequest={handleNavigation}
              onError={() => setFailed(true)}
              setSupportMultipleWindows={false}
              style={styles.webview}
              containerStyle={styles.webview}
            />
          )}

          <Pressable haptic onPress={onCancel} style={styles.cancel}>
            <Text variant="body" color={theme.colors.text3}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  // The challenge grid opens inside the page, so the WebView needs room for it.
  card: { width: '100%', maxWidth: 420, height: 600, maxHeight: '92%', padding: 16, gap: 8 },
  webview: { flex: 1, backgroundColor: 'transparent' },
  failed: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  btn: { paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  cancel: { alignItems: 'center', padding: 8 },
});
