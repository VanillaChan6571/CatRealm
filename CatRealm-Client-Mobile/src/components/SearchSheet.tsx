import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Pressable } from './Pressable';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { useUIStore } from '@/stores/uiStore';
import { createApi } from '@/lib/api';
import type { Message } from '@/types';
import { formatMessageTimestamp } from '@/utils/formatTime';

const EMPTY_RESULTS: Message[] = [];

function formatTime(value: number) {
  const ms = value < 10_000_000_000 ? value * 1000 : value;
  return formatMessageTimestamp(ms);
}

export function SearchSheet() {
  const theme = useTheme();
  const { t } = useTranslation();
  const open = useUIStore((s) => s.searchOpen);
  const setOpen = useUIStore((s) => s.setSearchOpen);
  const channelId = useUIStore((s) => s.activeChannelId);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[]>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [oldestAt, setOldestAt] = useState<number | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Reset state when sheet closes or channel changes
  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults(EMPTY_RESULTS);
      setHasMore(false);
      setOldestAt(null);
    }
  }, [open]);

  const runSearch = useCallback((q: string, before?: number | null) => {
    if (!channelId || !q.trim()) {
      setResults(EMPTY_RESULTS);
      setHasMore(false);
      setOldestAt(null);
      return;
    }
    const isPaginating = before != null;
    if (isPaginating) setLoadingMore(true);
    else setLoading(true);

    const params: Record<string, string | number> = { q: q.trim(), limit: 25 };
    if (before != null) params.before = before;

    void createApi()
      .get<{ results: Message[]; hasMore: boolean }>(`/api/messages/${channelId}/search`, { params })
      .then((res) => {
        const msgs = res.data?.results ?? [];
        const more = res.data?.hasMore ?? false;
        if (isPaginating) {
          setResults((prev) => {
            const ids = new Set(prev.map((m) => m.id));
            return [...prev, ...msgs.filter((m) => !ids.has(m.id))];
          });
        } else {
          setResults(msgs);
        }
        setHasMore(more);
        if (msgs.length > 0) setOldestAt(msgs[msgs.length - 1]?.created_at ?? null);
      })
      .catch(() => {
        if (!isPaginating) setResults(EMPTY_RESULTS);
      })
      .finally(() => {
        if (isPaginating) setLoadingMore(false);
        else setLoading(false);
      });
  }, [channelId]);

  const handleChangeText = (text: string) => {
    setQuery(text);
    clearTimeout(debounceRef.current);
    if (!text.trim()) {
      setResults(EMPTY_RESULTS);
      setHasMore(false);
      setOldestAt(null);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(text), 350);
  };

  const handleLoadMore = () => {
    if (loadingMore || !hasMore || !oldestAt) return;
    runSearch(query, oldestAt);
  };

  return (
    <Sheet open={open} onClose={() => setOpen(false)} maxHeightFraction={0.82}>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
        <Text variant="subtitle">{t('chat.searchTitle')}</Text>
        <TextInput
          value={query}
          onChangeText={handleChangeText}
          placeholder={t('chat.searchPlaceholder')}
          placeholderTextColor={theme.colors.text3}
          autoCapitalize="none"
          style={{
            marginTop: theme.spacing.md,
            backgroundColor: theme.colors.bgElev2,
            borderRadius: theme.radius.lg,
            color: theme.colors.text,
            paddingHorizontal: 12,
            paddingVertical: 10,
            fontSize: 15,
          }}
        />
      </View>

      {loading ? (
        <View style={{ padding: theme.spacing.lg, alignItems: 'center' }}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : results.length === 0 ? (
        <View style={{ padding: theme.spacing.lg }}>
          <Text variant="bodySmall" color={theme.colors.text3}>
            {query.trim() ? t('chat.noResultsFound') : t('chat.typeToSearch')}
          </Text>
        </View>
      ) : (
        <FlatList
          keyboardShouldPersistTaps="handled"
          data={results}
          keyExtractor={(item) => item.id}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore
              ? <ActivityIndicator color={theme.colors.accent} style={{ margin: 12 }} />
              : null
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setOpen(false)}
              style={{
                paddingHorizontal: theme.spacing.lg,
                paddingVertical: 10,
                borderTopWidth: 1,
                borderTopColor: theme.colors.lineSoft,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text variant="subtitle" numberOfLines={1}>
                  {item.display_name ?? item.username}
                </Text>
                <Text variant="caption" color={theme.colors.text3}>
                  {formatTime(item.created_at)}
                </Text>
              </View>
              <Text variant="bodySmall" color={theme.colors.text2} numberOfLines={3}>
                {item.content}
              </Text>
            </Pressable>
          )}
        />
      )}
    </Sheet>
  );
}
