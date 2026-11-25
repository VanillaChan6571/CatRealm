/**
 * Thread chat screen — message list + composer for a single thread.
 * `channelId` param is actually the thread ID (matching the file-based route slot name).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable as RNPressable,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { useComposerKeyboardInset } from '@/hooks/useComposerKeyboardInset';
import { dismissKeyboard } from '@/lib/dismissKeyboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, CornerUpLeft, MessageSquareText, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text, Avatar, BotBadge, Pressable, MobileComposer, TranslatableMarkdownText, MessageActionSheet, SafetyReportSheet, type SafetyReportTarget } from '@/components';
import { ChannelMessageRow } from '@/components/ChannelMessageRow';
import { RoleNameText } from '@/lib/roleStyles';
import { useMemberRoleStyle } from '@/hooks/useMemberRoleStyle';
import { useAuthStore } from '@/stores/authStore';
import { createApi } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { formatMessageTimestamp } from '@/utils/formatTime';
import type { ForumPost, Message } from '@/types';
import type { ComposerSendOptions } from '@/components/MobileComposer';
import { useServerStore } from '@/stores/serverStore';
import { ServerMentionProvider } from '@/components/MentionText';
import { useExpressionLookup, type ExpressionLookup } from '@/lib/expressionCache';
import { hideReportedAttachments, hideReportedLinks, reportableSafetyArtifacts, safetyHiddenArtifactKeys } from '@/lib/safetyReporting';
import { useMessageStore } from '@/stores/messageStore';
import { hasChannelPermission, PERMISSIONS } from '@/utils/permissions';
import type { Reaction } from '@/types';
import { useTopBarPadding } from '@/hooks/useTopBarPadding';

const EMPTY: Message[] = [];

function toMs(v: number) { return v < 10_000_000_000 ? v * 1000 : v; }

// ─── Forum post body (top of a forum thread) ──────────────────────────────────

function ForumPostHeader({ post, replyCount, serverUrl, expressionLookup }: {
  post: ForumPost;
  replyCount: number;
  serverUrl?: string | null;
  expressionLookup?: ExpressionLookup | null;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const authorRole = useMemberRoleStyle(post.created_by);
  return (
    <View>
    <View style={[styles.postHeader, { borderBottomColor: theme.colors.lineSoft }]}>
      <View style={styles.meta}>
        <Avatar username={post.author_username} uri={post.author_avatar} baseUrl={serverUrl ?? undefined} size={28} showStatus={false} />
        {/* Spacing lives on a wrapper: rgb_flow names measure and mask their own text style. */}
        <View style={{ marginLeft: 8, flexShrink: 1 }}>
          <RoleNameText
            color={authorRole.color}
            styleType={authorRole.styleType}
            styleColors={authorRole.styleColors}
            numberOfLines={1}
          >
            {post.author_display_name ?? post.author_username}
          </RoleNameText>
        </View>
        {post.author_account_type === 'bot' ? <BotBadge /> : null}
        <Text variant="caption" color={theme.colors.text3} style={{ marginLeft: 6 }}>
          {formatMessageTimestamp(toMs(post.created_at))}
        </Text>
      </View>
      <Text variant="title" style={{ marginTop: 8, marginBottom: 4 }}>{post.name}</Text>
      <TranslatableMarkdownText
        messageId={post.parent_message_id}
        text={post.preview_content}
        color={theme.colors.text}
        attachments={post.body_attachments ?? undefined}
        serverUrl={serverUrl}
        expressionLookup={expressionLookup}
        linkPreviews
      />
    </View>
    {replyCount > 0 ? (
      <Text variant="caption" color={theme.colors.text3} style={[styles.repliesDivider, { borderBottomColor: theme.colors.lineSoft }]}>
        {t('forum.replies', { count: replyCount })}
      </Text>
    ) : (
      <Text variant="bodySmall" color={theme.colors.text3} style={styles.noReplies}>{t('forum.noReplies')}</Text>
    )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ThreadScreen() {
  const theme = useTheme();
  // The header steps clear of a side status area (the iPhone Duo's cover screen).
  const topBarPadding = useTopBarPadding(8);
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // File slot is named [channelId] but holds the thread ID
  // Realms have no single-thread endpoint, so callers pass the parent channel and title.
  const { channelId: threadId, serverId, parentChannelId, title } = useLocalSearchParams<{
    serverId: string;
    channelId: string;
    parentChannelId?: string;
    title?: string;
  }>();
  const threadServer = useServerStore((s) => (serverId ? s.byId(serverId) : undefined));
  const parentChannel = useServerStore((s) =>
    serverId ? (s.channels[serverId] ?? []).find((c) => c.id === parentChannelId) : undefined,
  );
  const isForumPost = parentChannel?.type === 'forum';

  const selfUser = useAuthStore((s) => s.user);
  const authServerUrl = useAuthStore((s) => s.serverUrl);
  // Central accounts' auth URL is Central; realm uploads and emotes resolve against the realm.
  const serverUrl = threadServer?.url ?? authServerUrl;
  const expressionLookup = useExpressionLookup(serverUrl);
  const requestEdit = useMessageStore((s) => s.requestEdit);
  const requestDelete = useMessageStore((s) => s.requestDelete);
  const isRealmOwner = Boolean(selfUser?.isOwner || selfUser?.role === 'owner');
  const can = (permission: number) =>
    isRealmOwner || hasChannelPermission(selfUser?.permissions, parentChannel?.effective_permissions, permission);
  const canReact = can(PERMISSIONS.ADD_REACTIONS);
  const canManageMessages = can(PERMISSIONS.MANAGE_MESSAGES);
  const [activeMessage, setActiveMessage] = useState<Message | null>(null);
  const [safetyReportTarget, setSafetyReportTarget] = useState<SafetyReportTarget | null>(null);
  const [locallyHiddenSafetyKeys, setLocallyHiddenSafetyKeys] = useState<Record<string, string[]>>({});
  const [replyTo, setReplyTo] = useState<Message | null>(null);

  const [forumPost, setForumPost] = useState<ForumPost | null>(null);
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
  const composerBottom = useComposerKeyboardInset();


  // Load thread info + initial messages
  useEffect(() => {
    if (!threadId) return;
    setLoading(true);
    setMessages(EMPTY);
    setHasMore(true);
    setEarliestAt(null);

    void createApi()
      .get<Message[]>(`/api/threads/${threadId}/messages`, { params: { limit: 50 } })
      .then((res) => {
        const msgs = res.data ?? [];
        setMessages(msgs);
        setHasMore(msgs.length >= 50);
        setEarliestAt(msgs[0]?.created_at ?? null);
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
    // Realms only broadcast thread replies to the thread room; rejoin after reconnects.
    const join = () => socket?.emit('thread:join', threadId);
    join();
    // Edits, deletions and reactions on thread messages also go only to the thread room.
    const patch = (messageId: string, update: (m: Message) => Message) =>
      setMessages((prev) => prev.map((m) => (m.id === messageId ? update(m) : m)));
    const onEdited = (e: { messageId: string; content: string; threadId?: string | null; embeds_enabled?: number }) => {
      if (e.threadId !== threadId) return;
      patch(e.messageId, (m) => ({ ...m, content: e.content, edited: 1, embeds_enabled: e.embeds_enabled ?? m.embeds_enabled }));
    };
    const onDeleted = (e: { messageId: string; threadId?: string | null }) => {
      if (e.threadId !== threadId) return;
      setMessages((prev) => prev.filter((m) => m.id !== e.messageId));
    };
    const onReactions = (e: { messageId: string; threadId?: string | null; reactions: Reaction[] }) => {
      if (e.threadId !== threadId) return;
      patch(e.messageId, (m) => ({ ...m, reactions: e.reactions }));
    };
    const onSafetyArtifact = (e: { messageId?: string; artifactKey?: string; state?: 'quarantined' | 'removed' | 'cleared' }) => {
      if (!e.messageId || !e.artifactKey || !e.state) return;
      patch(e.messageId, (message) => {
        const existing = (message.safety_artifacts ?? []).filter((artifact) => artifact.artifactKey !== e.artifactKey);
        return {
          ...message,
          safety_artifacts: e.state === 'cleared'
            ? existing
            : [...existing, { artifactKey: e.artifactKey!, state: e.state!, hiddenForUser: true }],
        };
      });
    };
    socket?.on('connect', join);
    socket?.on('message:new', handler);
    socket?.on('message:edited', onEdited);
    socket?.on('message:deleted', onDeleted);
    socket?.on('message:reaction:update', onReactions);
    socket?.on('safety:artifact:update', onSafetyArtifact);
    return () => {
      socket?.off('connect', join);
      socket?.off('message:new', handler);
      socket?.off('message:edited', onEdited);
      socket?.off('message:deleted', onDeleted);
      socket?.off('message:reaction:update', onReactions);
      socket?.off('safety:artifact:update', onSafetyArtifact);
    };
  }, [threadId]);

  // The post body is the thread's parent message, which the thread message list excludes.
  useEffect(() => {
    if (!isForumPost || !parentChannelId || !threadId) return;
    void createApi()
      .get<ForumPost[]>('/api/threads/forum', { params: { channelId: parentChannelId, archived: 1 } })
      .then((res) => setForumPost(res.data?.find((p) => p.id === threadId) ?? null))
      .catch(() => {});
  }, [isForumPost, parentChannelId, threadId]);

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
    if (socket && parentChannelId) {
      clearTimeout(typingTimerRef.current);
      if (!text.trim()) {
        if (typingActiveRef.current) socket.emit('typing:stop', { channelId: parentChannelId });
        typingActiveRef.current = false;
        return;
      }
      // Re-announce every 2.5s while typing continues; desktop expires silent typers.
      if (!typingActiveRef.current || Date.now() - typingSentAtRef.current > 2500) {
        socket.emit('typing:start', { channelId: parentChannelId });
        typingActiveRef.current = true;
        typingSentAtRef.current = Date.now();
      }
      typingTimerRef.current = setTimeout(() => {
        socket.emit('typing:stop', { channelId: parentChannelId });
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
    if ((!text && !attachments?.length) || !parentChannelId) return;
    getSocket()?.emit('message:send', {
      channelId: parentChannelId,
      content: text,
      threadId,
      ...(replyTo ? { replyToId: replyTo.id } : {}),
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
    setReplyTo(null);
    clearTimeout(typingTimerRef.current);
    typingActiveRef.current = false;
  };

  const handleAvatarPress = useCallback((userId: string) => {
    router.push({ pathname: '/profile/[userId]', params: { userId, context: 'server' } });
  }, [router]);

  const handleLongPress = useCallback((msg: Message) => setActiveMessage(msg), []);

  const handleToggleReaction = useCallback((messageId: string, emoji: string) => {
    const socket = getSocket();
    if (!canReact || !parentChannelId) return;
    if (!socket?.connected) {
      Alert.alert(t('common.error'), t('chat.reactionFailed'));
      return;
    }
    socket.emit('message:react', { messageId, channelId: parentChannelId, emoji }, (reply: { status?: string; error?: string }) => {
      if (reply?.status !== 'ok') Alert.alert(t('common.error'), reply?.error || t('chat.reactionFailed'));
    });
  }, [canReact, parentChannelId, t]);

  // FlatList is inverted — display reversed
  const displayMessages = [...messages].reverse();

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.bgApp, paddingTop: insets.top }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.colors.lineSoft }, topBarPadding]}>
        <Pressable haptic onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft color={theme.colors.accent} size={20} />
        </Pressable>
        <MessageSquareText size={16} color={theme.colors.text3} />
        <Text variant="subtitle" numberOfLines={1} style={{ flex: 1 }}>
          {forumPost?.name ?? title ?? t('chat.threadDefault')}
        </Text>
      </View>

      <View style={{ flex: 1, overflow: 'hidden' }}>
        <View style={{ flex: 1 }}>
          {loading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={theme.colors.accent} />
            </View>
          ) : (
            <ServerMentionProvider serverId={serverId ?? ''} serverUrl={serverUrl} token={threadServer?.token}>
            <FlatList
              ref={flatListRef}
              style={{ flex: 1 }}
              inverted
              data={displayMessages}
              keyExtractor={(m) => m.id}
              contentContainerStyle={{ paddingHorizontal: theme.spacing.md, paddingTop: 6, paddingBottom: 10 }}
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={dismissKeyboard}
              // Tapping the conversation closes the keyboard, as in other chat apps.
              onTouchStart={dismissKeyboard}
              onEndReached={handleLoadMore}
              onEndReachedThreshold={0.3}
              ListFooterComponent={loadingOlder
                ? <ActivityIndicator color={theme.colors.accent} style={{ margin: 12 }} />
                : forumPost && !hasMore ? (
                  <ForumPostHeader post={forumPost} replyCount={messages.length} serverUrl={serverUrl} expressionLookup={expressionLookup} />
                ) : null}
              ListEmptyComponent={forumPost ? null : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
                  <Text variant="bodySmall" color={theme.colors.text3}>{t('chats.noMessagesStart')}</Text>
                </View>
              )}
              renderItem={({ item, index }) => {
                const prev = displayMessages[index + 1] ?? null;
                const hiddenKeys = new Set([...(locallyHiddenSafetyKeys[item.id] ?? []), ...safetyHiddenArtifactKeys(item.safety_artifacts)]);
                const visibleItem = hiddenKeys.size ? { ...item, content: hideReportedLinks(item.content, hiddenKeys), attachments: hideReportedAttachments(item.attachments, hiddenKeys) } : item;
                return (
                  <ChannelMessageRow
                    message={visibleItem}
                    prevMessage={prev}
                    selfUserId={selfUser?.id}
                    avatarBaseUrl={serverUrl}
                    serverUrl={serverUrl}
                    expressionLookup={expressionLookup}
                    onAvatarPress={handleAvatarPress}
                    onMessageLongPress={handleLongPress}
                    onToggleReaction={canReact ? handleToggleReaction : undefined}
                  />
                );
              }}
            />
            </ServerMentionProvider>
          )}

          {replyTo ? (
            <View style={[styles.replyBar, { backgroundColor: theme.colors.bgElev1, borderTopColor: theme.colors.lineSoft }]}>
              <CornerUpLeft color={theme.colors.accent} size={14} />
              <Text variant="caption" color={theme.colors.text3} style={{ flex: 1 }} numberOfLines={1}>
                <Text variant="caption" color={theme.colors.accent}>{replyTo.display_name ?? replyTo.username}</Text>
                {'  '}{replyTo.content}
              </Text>
              <RNPressable onPress={() => setReplyTo(null)} style={{ padding: 4 }}>
                <X color={theme.colors.text3} size={14} />
              </RNPressable>
            </View>
          ) : null}
          <MobileComposer
            value={draft}
            onChangeText={handleChangeText}
            placeholder={t('chat.threadReplyPlaceholder')}
            onSend={handleSend}
            disabled={false}
            bottomInset={composerBottom}
            channelId={parentChannelId}
            serverUrl={serverUrl}
            expressionLookup={expressionLookup}
            mentionsEnabled
            voiceMessages
          />
        </View>
      </View>

      <MessageActionSheet
        open={Boolean(activeMessage)}
        onClose={() => setActiveMessage(null)}
        expressionLookup={expressionLookup}
        serverUrl={serverUrl}
        canReact={canReact}
        canUseExternalEmotes={can(PERMISSIONS.USE_EXTERNAL_EMOTES)}
        canUseExternalStickers={can(PERMISSIONS.USE_EXTERNAL_STICKERS)}
        initialEditText={activeMessage?.content ?? ''}
        translationMessageId={activeMessage?.id}
        translationText={activeMessage?.content}
        canEdit={Boolean(activeMessage && (activeMessage.user_id === selfUser?.id || canManageMessages))}
        canDelete={Boolean(activeMessage && (activeMessage.user_id === selfUser?.id || canManageMessages))}
        onReact={(emoji) => {
          if (!activeMessage) return;
          handleToggleReaction(activeMessage.id, emoji);
          setActiveMessage(null);
        }}
        onEdit={(nextText) => {
          if (activeMessage) requestEdit(activeMessage.id, nextText);
        }}
        onReply={() => {
          setReplyTo(activeMessage);
          setActiveMessage(null);
        }}
        onCopy={() => {
          if (activeMessage) void Share.share({ message: activeMessage.content });
          setActiveMessage(null);
        }}
        onDelete={() => {
          if (activeMessage) requestDelete(activeMessage.id, activeMessage.channel_id);
        }}
        onReport={activeMessage && activeMessage.user_id !== selfUser?.id && reportableSafetyArtifacts(activeMessage.content, activeMessage.attachments).length ? () => {
          const message = activeMessage;
          setActiveMessage(null);
          setSafetyReportTarget({ scopeKind: 'realm', scopeId: message.channel_id, messageId: message.id, senderLabel: message.display_name || message.username, messageText: message.content, attachments: message.attachments });
        } : undefined}
      />
      <SafetyReportSheet realm target={safetyReportTarget} onClose={() => setSafetyReportTarget(null)} onSubmitted={(messageId, artifactKey) => setLocallyHiddenSafetyKeys((current) => ({ ...current, [messageId]: [...new Set([...(current[messageId] ?? []), artifactKey])] }))} />
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
  postHeader: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 14,
    marginBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 2,
  },
  repliesDivider: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  noReplies: {
    textAlign: 'center',
    paddingVertical: 24,
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
