/**
 * Discover Servers — Central's public realm directory (desktop Home
 * "Discover" tab). Joining accepts the listing's invite, then adds the realm.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from '@/components/SafeAreaView';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Search } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { Text, Pressable, Avatar, FadeInImage, ImagePlaceholder } from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { normalizeServerUrl, useServerStore } from '@/stores/serverStore';
import { useJoinServer } from '@/hooks/useJoinServer';
import { useOpenServer } from '@/hooks/useOpenServer';
import { fetchDiscovery, type DiscoveryEntry } from '@/lib/serverDirectory';
import { resolveMediaUrl } from '@/utils/mediaUrl';

const SEARCH_DEBOUNCE_MS = 350;

export default function DiscoverServersScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const isCentral = useAuthStore((s) => s.user?.accountType === 'central');
  const servers = useServerStore((s) => s.servers);
  const { join, joiningKey, error: joinError } = useJoinServer();
  const openServer = useOpenServer();
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<DiscoveryEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async (text: string) => {
    const seq = ++requestSeq.current;
    setLoadError(null);
    setEntries(null);
    try {
      const result = await fetchDiscovery(text);
      if (seq === requestSeq.current) setEntries(result);
    } catch (err) {
      if (seq === requestSeq.current) setLoadError(err instanceof Error ? err.message : 'Could not load discoverable servers.');
    }
  }, []);

  useEffect(() => {
    if (!isCentral) return;
    const handle = setTimeout(() => { void load(query); }, query ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(handle);
  }, [isCentral, load, query]);

  const renderEntry = ({ item }: { item: DiscoveryEntry }) => {
    const joined = servers.find((server) => server.id === normalizeServerUrl(item.serverUrl));
    const busy = joiningKey === item.inviteCode;
    const icon = resolveMediaUrl(item.serverIcon, item.serverUrl);
    const banner = resolveMediaUrl(item.serverBanner, item.serverUrl);
    return (
      <View style={[styles.card, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.lineSoft }]}>
        {banner ? <FadeInImage uri={banner} style={styles.banner} /> : <View style={[styles.banner, { backgroundColor: theme.colors.bgElev2 }]} />}
        <View style={styles.cardBody}>
          <View style={styles.titleRow}>
            <Avatar username={item.serverName} uri={icon} size={44} shape="square" showStatus={false} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="subtitle" numberOfLines={1}>{item.serverName}</Text>
              <Text variant="caption" color={theme.colors.text3}>{t('joinServers.members', { count: item.memberCount })}</Text>
            </View>
            <Pressable
              haptic
              accessibilityLabel={`${joined ? t('joinServers.open') : t('joinServers.join')} ${item.serverName}`}
              disabled={joiningKey !== null}
              onPress={() => void (joined ? openServer(joined) : join({ serverUrl: item.serverUrl, inviteCode: item.inviteCode }))}
              style={[styles.joinBtn, { backgroundColor: joined ? theme.colors.bgElev2 : theme.colors.accent, opacity: joiningKey && !busy ? 0.6 : 1 }]}
            >
              {busy ? <ActivityIndicator accessibilityLabel={t('joinServers.joining')} color="#fff" /> : (
                <Text variant="bodySmall" style={{ color: joined ? theme.colors.text : '#fff', fontWeight: '700' }}>
                  {joined ? t('joinServers.open') : t('joinServers.join')}
                </Text>
              )}
            </Pressable>
          </View>
          {!!item.serverDescription && (
            <Text variant="bodySmall" color={theme.colors.text2} numberOfLines={3}>{item.serverDescription}</Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bgApp }} edges={['top']}>
      <View style={styles.header}>
        <Pressable haptic accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
          <ChevronLeft size={24} color={theme.colors.text2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text variant="display">{t('joinServers.discoverTitle')}</Text>
          <Text variant="caption" color={theme.colors.text3}>{t('joinServers.discoverHint')}</Text>
        </View>
      </View>
      {!isCentral ? (
        <Text variant="body" color={theme.colors.text2} style={styles.notice}>{t('joinServers.centralOnly')}</Text>
      ) : (
        <FlatList
          data={entries ?? []}
          keyExtractor={(item) => `${item.serverUrl}-${item.inviteCode}`}
          renderItem={renderEntry}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <>
              <View style={[styles.search, { backgroundColor: theme.colors.bgElev2, borderColor: theme.colors.lineSoft }]}>
                <Search size={18} color={theme.colors.text3} />
                <TextInput value={query} onChangeText={setQuery} placeholder={t('joinServers.searchPlaceholder')}
                  placeholderTextColor={theme.colors.text3} accessibilityLabel={t('joinServers.searchPlaceholder')}
                  autoCapitalize="none" autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing"
                  style={[styles.searchInput, { color: theme.colors.text }]} />
              </View>
              {!!joinError && <Text accessibilityRole="alert" variant="bodySmall" color={theme.colors.danger}>{joinError}</Text>}
            </>
          }
          ListEmptyComponent={
            loadError ? (
              <View style={styles.notice}>
                <Text variant="bodySmall" color={theme.colors.danger}>{loadError}</Text>
                <Pressable haptic onPress={() => void load(query)} style={[styles.joinBtn, { backgroundColor: theme.colors.bgElev2, alignSelf: 'flex-start' }]}>
                  <Text variant="bodySmall">{t('joinServers.retry')}</Text>
                </Pressable>
              </View>
            ) : entries === null ? (
              // Loading: placeholder cards in the CatRealm style.
              <View testID="discover-loading" style={{ gap: 12 }}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={[styles.card, styles.skeleton, { borderColor: theme.colors.lineSoft }]}>
                    <ImagePlaceholder mark />
                  </View>
                ))}
              </View>
            ) : (
              <Text variant="bodySmall" color={theme.colors.text3} style={styles.notice}>
                {query.trim() ? t('joinServers.noMatches') : t('joinServers.empty')}
              </Text>
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, gap: 4 },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, paddingTop: 4, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, marginBottom: 4 },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: 16 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  skeleton: { height: 190 },
  banner: { height: 96 },
  cardBody: { padding: 14, gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  joinBtn: { minWidth: 72, minHeight: 40, paddingHorizontal: 16, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  notice: { padding: 16, gap: 10 },
});
