/**
 * Realm Rules channel view (channel.type === 'rules'). Mirrors the desktop
 * ServerRulesChannel: fetches /api/welcome/settings and renders the rules as
 * either a numbered structured list or markdown, over the welcome-board
 * background when one is configured.
 */
import { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';
import { createApi } from '@/lib/api';
import { debugLog } from '@/lib/debugLog';
import { realmScope } from '@/lib/imageCache';
import { useTheme } from '@/theme';
import { Text } from './Text';
import { CachedImage } from './CachedImage';
import { MarkdownText } from './MarkdownText';

interface WelcomeRule {
  id: string;
  content: string;
  position: number;
}

interface WelcomeSettings {
  bg: string;
  serverIcon?: string | null;
  rules: WelcomeRule[];
  rulesMode: 'structured' | 'markdown';
  rulesMarkdown: string;
}

function resolveAssetUrl(value: string | null | undefined, serverUrl: string | null): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || !serverUrl) return value;
  return `${serverUrl.replace(/\/$/, '')}${value.startsWith('/') ? value : `/${value}`}`;
}

type Props = {
  serverUrl: string | null;
  serverToken?: string | null;
  serverName: string;
  serverIcon?: string | null;
};

export function ServerRulesView({ serverUrl, serverToken, serverName, serverIcon }: Props) {
  const theme = useTheme();
  const [settings, setSettings] = useState<WelcomeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    createApi(serverUrl ?? undefined, serverToken ?? undefined)
      .get<WelcomeSettings>('/api/welcome/settings')
      .then((res) => {
        if (cancelled) return;
        setSettings(res.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { status?: number } }).response?.status
          : undefined;
        debugLog('ServerRulesView', 'fetch-failed', { serverUrl, status, message: err instanceof Error ? err.message : String(err) });
        setError(status ? `Failed to load server rules (HTTP ${status}).` : 'Failed to load server rules.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serverToken, serverUrl]);

  const backgroundUrl = resolveAssetUrl(settings?.bg, serverUrl);
  const serverIconUrl = useMemo(
    () => resolveAssetUrl(settings?.serverIcon || serverIcon, serverUrl),
    [settings?.serverIcon, serverIcon, serverUrl],
  );

  const scope = realmScope(serverUrl ?? 'rules');

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.bgApp }]}>
      {backgroundUrl ? (
        <>
          <CachedImage uri={backgroundUrl} scope={scope} style={StyleSheet.absoluteFill} contentFit="cover" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.65)' }]} />
        </>
      ) : null}

      <View style={styles.centerWrap}>
        <View style={[styles.card, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.line }]}>
          <View style={[styles.header, { borderBottomColor: theme.colors.line }]}>
            {serverIconUrl ? (
              <CachedImage uri={serverIconUrl} scope={scope} style={styles.icon} contentFit="cover" />
            ) : (
              <View style={[styles.icon, styles.iconFallback]}>
                <ShieldCheck size={28} color="#c4b5fd" />
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="title" numberOfLines={1}>Server Rules</Text>
              <Text variant="caption" color={theme.colors.text3} numberOfLines={1}>
                {serverName || 'This realm'}
              </Text>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {loading ? <ActivityIndicator color={theme.colors.accent} /> : null}
            {error ? <Text variant="bodySmall" color={theme.colors.danger ?? '#f87171'}>{error}</Text> : null}

            {!loading && !error && settings?.rulesMode === 'structured' ? (
              settings.rules.length === 0 ? (
                <Text variant="bodySmall" color={theme.colors.text3}>No rules have been set for this realm yet.</Text>
              ) : (
                <View style={{ gap: 12 }}>
                  {settings.rules.map((rule, index) => (
                    <View key={rule.id} style={[styles.ruleRow, { borderColor: theme.colors.line }]}>
                      <View style={styles.ruleNumber}>
                        <Text variant="caption" style={styles.ruleNumberText}>{index + 1}</Text>
                      </View>
                      <Text variant="bodySmall" color={theme.colors.text} style={{ flex: 1, lineHeight: 20 }}>
                        {rule.content}
                      </Text>
                    </View>
                  ))}
                </View>
              )
            ) : null}

            {!loading && !error && settings?.rulesMode === 'markdown' ? (
              settings.rulesMarkdown.trim() ? (
                <MarkdownText text={settings.rulesMarkdown} color={theme.colors.text} serverUrl={serverUrl} />
              ) : (
                <Text variant="bodySmall" color={theme.colors.text3}>No rules have been set for this realm yet.</Text>
              )
            ) : null}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '100%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: { width: 52, height: 52, borderRadius: 14 },
  iconFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(139,92,246,0.2)',
  },
  body: { padding: 18 },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  ruleNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(139,92,246,0.2)',
  },
  ruleNumberText: { color: '#c4b5fd', fontWeight: '700' },
});
