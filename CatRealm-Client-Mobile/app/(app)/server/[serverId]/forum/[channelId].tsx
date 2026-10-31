import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, View } from 'react-native';
import { SafeAreaView } from '@/components/SafeAreaView';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, MessageSquare } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text, Avatar, BotBadge, Pressable } from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { createApi } from '@/lib/api';
import { formatMessageTimestamp } from '@/utils/formatTime';

interface ForumThread {
  id: string;
  channel_id: string;
  name: string;
  created_by: string;
  created_at: number;
  author_username: string;
  author_display_name?: string | null;
  author_avatar?: string | null;
  author_account_type?: 'local' | 'central' | 'bot';
  preview_content?: string | null;
  reply_count?: number;
  last_message_at?: number | null;
  cover_image?: string | null;
  archived?: number;
}

function toMs(v: number) { return v < 10_000_000_000 ? v * 1000 : v; }

export default function ForumScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { channelId } = useLocalSearchParams<{ serverId: string; channelId: string }>();
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const channel = useServerStore((s) =>
    activeServerId ? (s.channels[activeServerId] ?? []).find((c) => c.id === channelId) : undefined,
  );

  const [threads, setThreads] = useState<ForumThread[]>([]);
  const [loading, setLoading] = useState(true);

  const resolveUrl = useCallback((path?: string | null): string | undefined => {
    if (!path) return undefined;
    if (path.startsWith('http')) return path;
    const base = serverUrl?.replace(/\/$/, '') ?? '';
    return base + (path.startsWith('/') ? path : '/' + path);
  }, [serverUrl]);

  useEffect(() => {
    if (!channelId) return;
    setLoading(true);
    void createApi()
      .get<ForumThread[]>('/api/threads/forum', { params: { channelId } })
      .then((res) => setThreads(res.data ?? []))
      .catch(() => setThreads([]))
      .finally(() => setLoading(false));
  }, [channelId]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bgApp }} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: theme.colors.lineSoft }]}>
        <Pressable haptic onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft color={theme.colors.accent} size={20} />
        </Pressable>
        <MessageSquare size={16} color={theme.colors.text3} />
        <Text variant="subtitle" numberOfLines={1} style={{ flex: 1 }}>
          {channel?.name ?? t('forum.defaultName')}
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ padding: 12, gap: 10 }}
          ListEmptyComponent={
            <View style={{ padding: 32, alignItems: 'center' }}>
              <Text variant="bodySmall" color={theme.colors.text3}>{t('forum.noPosts')}</Text>
            </View>
          }
          renderItem={({ item }) => {
            const coverUri = resolveUrl(item.cover_image);
            return (
              <Pressable
                haptic
                onPress={() =>
                  router.push({
                    pathname: '/server/[serverId]/threads/[channelId]',
                    params: { serverId: activeServerId ?? '', channelId: item.id },
                  })
                }
                style={[styles.card, { backgroundColor: theme.colors.bgElev1, borderRadius: theme.radius.lg }]}
              >
                {coverUri ? (
                  <Image
                    source={{ uri: coverUri }}
                    style={[styles.cover, { borderRadius: theme.radius.md }]}
                    resizeMode="cover"
                  />
                ) : null}
                <View style={styles.cardBody}>
                  <Text variant="subtitle" numberOfLines={2}>{item.name}</Text>
                  {item.preview_content ? (
                    <Text variant="bodySmall" color={theme.colors.text3} numberOfLines={2} style={{ marginTop: 4 }}>
                      {item.preview_content}
                    </Text>
                  ) : null}
                  <View style={styles.cardMeta}>
                    <Avatar
                      username={item.author_username}
                      uri={resolveUrl(item.author_avatar)}
                      size={18}
                    />
                    <Text variant="caption" color={theme.colors.text3} numberOfLines={1}>
                      {item.author_display_name ?? item.author_username}
                    </Text>
                    {item.author_account_type === 'bot' ? <BotBadge /> : null}
                    <Text variant="caption" color={theme.colors.text3}>·</Text>
                    <Text variant="caption" color={theme.colors.text3}>
                      {formatMessageTimestamp(toMs(item.last_message_at ?? item.created_at))}
                    </Text>
                    {item.reply_count != null && item.reply_count > 0 && (
                      <>
                        <Text variant="caption" color={theme.colors.text3}>·</Text>
                        <MessageSquare size={11} color={theme.colors.text3} />
                        <Text variant="caption" color={theme.colors.text3}>{item.reply_count}</Text>
                      </>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4 },
  card: {
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cover: {
    width: '100%',
    height: 140,
  },
  cardBody: {
    padding: 12,
    gap: 2,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    flexWrap: 'wrap',
  },
});
