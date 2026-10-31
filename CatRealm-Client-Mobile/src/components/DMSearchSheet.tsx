/**
 * DM search sheet — client-side search over the decrypted DM history in the
 * store (E2EE messages can't be searched server-side). Mirrors desktop
 * ChatSearchPanel's DM mode: "Search older messages" pages encrypted history
 * into the store (capped per tap) and the result list re-filters as it grows.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Avatar } from './Avatar';
import { MarkdownText } from './MarkdownText';
import { Pressable } from './Pressable';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { parseDmContextText } from '@/lib/dmContext';
import type { ExpressionLookup } from '@/lib/expressionCache';
import type { DMMessage } from '@/types';
import { formatMessageTimestamp } from '@/utils/formatTime';

const MAX_OLDER_PAGES_PER_TAP = 10;

interface DMSearchSheetProps {
  open: boolean;
  onClose: () => void;
  messages: DMMessage[];
  selfUserId?: string;
  selfName?: string;
  selfAvatar?: string | null;
  otherName?: string;
  otherAvatar?: string | null;
  serverUrl?: string | null;
  expressionLookup?: ExpressionLookup | null;
  hasOlder: boolean;
  /** Pages one older batch into the store; resolves to whether more remain. */
  onLoadOlder: () => Promise<boolean>;
  onSelectResult: (messageId: string) => void;
}

export function DMSearchSheet({
  open,
  onClose,
  messages,
  selfUserId,
  selfName,
  selfAvatar,
  otherName,
  otherAvatar,
  serverUrl,
  expressionLookup,
  hasOlder,
  onLoadOlder,
  onSelectResult,
}: DMSearchSheetProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!open) {
      clearTimeout(debounceRef.current);
      setQuery('');
      setDebouncedQuery('');
    }
  }, [open]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const handleChangeText = (text: string) => {
    setQuery(text);
    clearTimeout(debounceRef.current);
    if (!text.trim()) {
      setDebouncedQuery('');
      return;
    }
    debounceRef.current = setTimeout(() => setDebouncedQuery(text), 350);
  };

  // Derived from the live store slice, so paging older history in re-filters.
  const results = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return [];
    return messages
      .filter((m) => {
        if (m.messageType === 'system') return false;
        const body = parseDmContextText(m.text)?.bodyText ?? m.text;
        return body.toLowerCase().includes(q);
      })
      .slice()
      .reverse(); // newest first
  }, [messages, debouncedQuery]);

  const handleSearchOlder = () => {
    if (loadingOlder) return;
    setLoadingOlder(true);
    void (async () => {
      try {
        for (let i = 0; i < MAX_OLDER_PAGES_PER_TAP; i++) {
          const more = await onLoadOlder();
          if (!more) break;
        }
      } finally {
        setLoadingOlder(false);
      }
    })();
  };

  const showSearchOlder = hasOlder && Boolean(debouncedQuery.trim());

  return (
    <Sheet open={open} onClose={onClose} maxHeightFraction={0.82}>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
        <Text variant="subtitle">{t('chat.searchTitle')}</Text>
        <TextInput
          value={query}
          onChangeText={handleChangeText}
          placeholder={t('chat.searchDmPlaceholder')}
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

      {results.length === 0 ? (
        <View style={{ padding: theme.spacing.lg }}>
          <Text variant="bodySmall" color={theme.colors.text3}>
            {debouncedQuery.trim() ? t('chat.noResultsFound') : t('chat.typeToSearch')}
          </Text>
          {showSearchOlder ? (
            <SearchOlderButton loading={loadingOlder} onPress={handleSearchOlder} />
          ) : null}
        </View>
      ) : (
        <FlatList
          keyboardShouldPersistTaps="handled"
          data={results}
          keyExtractor={(item) => item.id}
          ListFooterComponent={
            showSearchOlder ? (
              <View style={{ paddingHorizontal: theme.spacing.lg }}>
                <SearchOlderButton loading={loadingOlder} onPress={handleSearchOlder} />
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const isOwn = item.senderId === selfUserId;
            const body = parseDmContextText(item.text)?.bodyText ?? item.text;
            return (
              <Pressable
                haptic
                onPress={() => {
                  onClose();
                  onSelectResult(item.id);
                }}
                style={{
                  flexDirection: 'row',
                  gap: 10,
                  paddingHorizontal: theme.spacing.lg,
                  paddingVertical: 10,
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.lineSoft,
                }}
              >
                <Avatar
                  username={(isOwn ? selfName : otherName) ?? ''}
                  uri={(isOwn ? selfAvatar : otherAvatar) ?? null}
                  size={32}
                  shape="square"
                  showStatus={false}
                />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                    <Text variant="subtitle" numberOfLines={1}>
                      {(isOwn ? selfName : otherName) ?? ''}
                    </Text>
                    <Text variant="caption" color={theme.colors.text3}>
                      {formatMessageTimestamp(item.createdAt)}
                    </Text>
                  </View>
                  {body ? (
                    <MarkdownText
                      text={body}
                      color={theme.colors.text2}
                      style={{ fontSize: 13 }}
                      serverUrl={serverUrl}
                      expressionLookup={expressionLookup}
                    />
                  ) : (
                    <Text variant="bodySmall" color={theme.colors.text3}>{t('chat.attachment')}</Text>
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </Sheet>
  );
}

function SearchOlderButton({ loading, onPress }: { loading: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <Pressable
      haptic
      onPress={onPress}
      disabled={loading}
      style={{
        marginVertical: 12,
        paddingVertical: 10,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.bgElev2,
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      {loading ? <ActivityIndicator size="small" color={theme.colors.accent} /> : null}
      <Text variant="bodySmall" color={theme.colors.text2}>
        {loading ? t('chat.searching') : t('chat.searchOlderMessages')}
      </Text>
    </Pressable>
  );
}
