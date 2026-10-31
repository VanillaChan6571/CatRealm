/**
 * Thread chat screen — message list + composer for a single thread.
 * `channelId` param is actually the thread ID (matching the file-based route slot name).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { useComposerKeyboardInset } from '@/hooks/useComposerKeyboardInset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, CornerUpRight, MessageSquareText } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text, Avatar, BotBadge, Pressable, MobileComposer, TranslatableMarkdownText } from '@/components';
import { useAuthStore } from '@/stores/authStore';
import { createApi } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { formatMessageTimestamp } from '@/utils/formatTime';
import type { Message } from '@/types';
import type { ComposerSendOptions } from '@/components/MobileComposer';
import { useServerStore } from '@/stores/serverStore';
import { ServerMentionProvider } from '@/components/MentionText';

const EMPTY: Message[] = [];
const GROUP_THRESHOLD_MS = 5 * 60 * 1000;

function toMs(v: number) { return v < 10_000_000_000 ? v * 1000 : v; }

interface ThreadInfo {
  id: string;
  name: string;
  channel_id: string;
}

// ─── MessageRow (simplified — no long-press actions for threads yet) ──────────

function MessageRow({
  message,
  prev,
  selfId,
  serverUrl,
}: {
  message: Message;
  prev: Message | null;
  selfId?: string;
  serverUrl?: string | null;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const grouped =
    prev !== null &&
    prev.user_id === message.user_id &&
    toMs(message.created_at) - toMs(prev.created_at) < GROUP_THRESHOLD_MS;

  return (
    <View style={[styles.row, { paddingTop: grouped ? 2 : 12 }]}>
      {grouped ? (
        <View style={styles.avatarPlaceholder} />
      ) : (
        <Avatar username={message.username} uri={message.avatar} baseUrl={serverUrl ?? undefined} size={34} />
      )}
      <View style={{ flex: 1 }}>
        {message.interaction ? (
          <View style={styles.botInteraction}>
            <CornerUpRight size={12} color={theme.colors.text3} />
            <Text variant="caption" color={theme.colors.text3} numberOfLines={1} style={{ flex: 1 }}>
              <Text variant="caption" color={theme.colors.text2}>{message.interaction.invokerName}</Text>
              {' used '}
              <Text variant="caption" color="#818CF8" style={{ fontWeight: '600' }}>
                /{message.interaction.command}
              </Text>
            </Text>
          </View>
        ) : null}
        {!grouped && (
          <View style={styles.meta}>
            <Text variant="subtitle" style={{ color: message.role_color ?? undefined }} numberOfLines={1}>
              {message.display_name ?? message.username}
              {message.user_id === selfId ? ` (${t('common.you')})` : ''}
            </Text>
            {message.is_bot ? <BotBadge /> : null}
            <Text variant="caption" color={theme.colors.text3} style={{ marginLeft: 6 }}>
              {formatMessageTimestamp(toMs(message.created_at))}
            </Text>
          </View>
        )}
        <TranslatableMarkdownText
          messageId={message.id}
          text={message.content}
          color={theme.colors.text}
          attachments={message.attachments}
          serverUrl={serverUrl}
          nsfwTags={message.nsfw_tags}
          allowEmbeds={message.embeds_enabled !== 0}
          linkPreviews
          voiceExpiresAt={message.voice_expires_at}
        />
        {message.edited ? (
          <Text variant="caption" color={theme.colors.text3}>{t('common.edited')}</Text>
        ) : null}
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ThreadScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // File slot is named [channelId] but holds the thread ID
  const { channelId: threadId, serverId } = useLocalSearchParams<{ serverId: string; channelId: string }>();
  const threadServer = useServerStore((s) => (serverId ? s.byId(serverId) : undefined));

  const selfUser = useAuthStore((s) => s.user);
  const serverUrl = useAuthStore((s) => s.serverUrl);

  const [threadInfo, setThreadInfo] = useState<ThreadInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>(EMPTY);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [earliestAt, setEarliestAt] = useState<number | null>(null);

  const flatListRef = useRef<FlatList<Message>>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const typingActiveRef = useRef(false);
  const typingSentAtRef = useRef(0);
  const composerBottom = useComposerKeyboardInset({ restInset: insets.bottom + 4 });


  // Load thread info + initial messages
  useEffect(() => {
    if (!threadId) return;
    setLoading(true);
    setMessages(EMPTY);
    setHasMore(true);
    setEarliestAt(null);

    const api = createApi();
    void Promise.all([
      api.get<Message[]>(`/api/threads/${threadId}/messages`, { params: { limit: 50 } }),
      api.get<ThreadInfo>(`/api/threads/${threadId}`).catch(() => ({ data: null })),
    ]).then(([msgsRes, threadRes]) => {
      const msgs = msgsRes.data ?? [];
      setMessages(msgs);
      setHasMore(msgs.length >= 50);
      setEarliestAt(msgs[0]?.created_at ?? null);
      if (threadRes.data) setThreadInfo(threadRes.data);
    }).catch(() => {}).finally(() => setLoading(false));

    // Listen for new thread messages on the socket
    const socket = getSocket();
    const handler = (msg: Message) => {
      if (msg.thread_id === threadId) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
    };
    socket?.on('message:new', handler);
    return () => { socket?.off('message:new', handler); };
  }, [threadId]);

  const handleLoadMore = useCallback(() => {
    if (loadingOlder || !hasMore || !earliestAt || !threadId) return;
    setLoadingOlder(true);
    void createApi()
      .get<Message[]>(`/api/threads/${threadId}/messages`, { params: { limit: 50, before: earliestAt } })
      .then((res) => {
        const older = res.data ?? [];
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          const fresh = older.filter((m) => !ids.has(m.id));
          return [...fresh, ...prev];
        });
        setHasMore(older.length >= 50);
        if (older[0]) setEarliestAt(older[0].created_at);
      })
      .catch(() => {})
      .finally(() => setLoadingOlder(false));
  }, [loadingOlder, hasMore, earliestAt, threadId]);

  const handleChangeText = (text: string) => {
    setDraft(text);
    const socket = getSocket();
    if (socket && threadInfo?.channel_id) {
      clearTimeout(typingTimerRef.current);
      if (!text.trim()) {
        if (typingActiveRef.current) socket.emit('typing:stop', { channelId: threadInfo.channel_id });
        typingActiveRef.current = false;
        return;
      }
      // Re-announce every 2.5s while typing continues; desktop expires silent typers.
      if (!typingActiveRef.current || Date.now() - typingSentAtRef.current > 2500) {
        socket.emit('typing:start', { channelId: threadInfo.channel_id });
        typingActiveRef.current = true;
        typingSentAtRef.current = Date.now();
      }
      typingTimerRef.current = setTimeout(() => {
        socket.emit('typing:stop', { channelId: threadInfo.channel_id });
        typingActiveRef.current = false;
      }, 3000);
    }
  };

  const handleSend = (
    serializedText?: string,
    attachments?: { url: string; mime: string; size: number; thumbnailUrl?: string | null; isNsfw: boolean }[],
    _localAttachments?: unknown,
    options?: ComposerSendOptions,
  ) => {
    const text = (serializedText ?? draft).trim();
    if ((!text && !attachments?.length) || !threadInfo?.channel_id) return;
    getSocket()?.emit('message:send', {
      channelId: threadInfo.channel_id,
      content: text,
      threadId,
      attachments: attachments?.map((attachment) => ({
        url: attachment.url,
        mime: attachment.mime,
        size: attachment.size,
        ...(attachment.thumbnailUrl ? { thumbnailUrl: attachment.thumbnailUrl } : {}),
      })) ?? [],
      nsfwTags: attachments?.some((attachment) => attachment.isNsfw) ? ['nsfw'] : [],
      voice_expires_at: options?.voiceExpiresAt ?? null,
    });
    setDraft('');
    clearTimeout(typingTimerRef.current);
    typingActiveRef.current = false;
  };

  // FlatList is inverted — display reversed
  const displayMessages = [...messages].reverse();

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.bgApp, paddingTop: insets.top }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.colors.lineSoft }]}>
        <Pressable haptic onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft color={theme.colors.accent} size={20} />
        </Pressable>
        <MessageSquareText size={16} color={theme.colors.text3} />
        <Text variant="subtitle" numberOfLines={1} style={{ flex: 1 }}>
          {threadInfo?.name ?? t('chat.threadDefault')}
        </Text>
      </View>

      <View style={{ flex: 1, overflow: 'hidden' }}>
        <View style={{ flex: 1 }}>
          {loading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={theme.colors.accent} />
            </View>
          ) : (
            <ServerMentionProvider serverId={serverId ?? ''} serverUrl={threadServer?.url ?? serverUrl} token={threadServer?.token}>
            <FlatList
              ref={flatListRef}
              style={{ flex: 1 }}
              inverted
              data={displayMessages}
              keyExtractor={(m) => m.id}
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={Keyboard.dismiss}
              onEndReached={handleLoadMore}
              onEndReachedThreshold={0.3}
              ListFooterComponent={loadingOlder ? <ActivityIndicator color={theme.colors.accent} style={{ margin: 12 }} /> : null}
              ListEmptyComponent={
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
                  <Text variant="bodySmall" color={theme.colors.text3}>{t('chats.noMessagesStart')}</Text>
                </View>
              }
              renderItem={({ item, index }) => {
                const prev = displayMessages[index + 1] ?? null;
                return (
                  <MessageRow
                    message={item}
                    prev={prev}
                    selfId={selfUser?.id}
                    serverUrl={serverUrl}
                  />
                );
              }}
            />
            </ServerMentionProvider>
          )}

          <MobileComposer
            value={draft}
            onChangeText={handleChangeText}
            placeholder={t('chat.threadReplyPlaceholder')}
            onSend={handleSend}
            disabled={false}
            bottomInset={composerBottom}
            channelId={threadInfo?.channel_id}
            mentionsEnabled
            voiceMessages
          />
        </View>
      </View>
    </KeyboardAvoidingView>
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
  backBtn: {
    padding: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingBottom: 2,
    gap: 10,
  },
  avatarPlaceholder: {
    width: 34,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 2,
  },
  botInteraction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
    overflow: 'hidden',
  },
});
