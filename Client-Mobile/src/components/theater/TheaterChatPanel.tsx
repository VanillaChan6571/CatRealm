import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSharedValue } from 'react-native-reanimated';
import { useTheme } from '@/theme';
import { Text } from '../Text';
import { Avatar } from '../Avatar';
import { MarkdownText } from '../MarkdownText';
import { MobileComposer, type UploadedComposerAttachment } from '../MobileComposer';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { useMessageStore } from '@/stores/messageStore';
import { useChannelStore } from '@/stores/channelStore';
import { useBlockedUsersStore } from '@/stores/blockedUsersStore';
import { useTheaterStore } from '@/stores/theaterStore';
import { getSocket } from '@/lib/socket';
import { createAuthenticatedApi } from '@/lib/api';
import { useExpressionLookup } from '@/lib/expressionCache';
import { hasChannelPermission, PERMISSIONS } from '@/utils/permissions';
import { formatMessageTimestamp } from '@/utils/formatTime';
import type { Message } from '@/types';

const EMPTY_MESSAGES: Message[] = [];

/** The theater's ordinary channel chat, embedded without leaving the video stage. */
export function TheaterChatPanel({ serverId, channelId }: { serverId: string; channelId: string }) {
  const theme = useTheme();
  const account = useAuthStore((s) => s.user);
  const localUrl = useAuthStore((s) => s.serverUrl);
  const localToken = useAuthStore((s) => s.token);
  const server = useServerStore((s) => s.byId(serverId));
  const channel = useServerStore((s) => s.channels[serverId]?.find((c) => c.id === channelId));
  const realmUser = useTheaterStore((s) => s.realmUser);
  const serverUrl = account?.accountType === 'central' ? server?.url : localUrl;
  const token = account?.accountType === 'central' ? server?.token : localToken;
  const messages = useMessageStore((s) => s.byChannel[channelId] ?? EMPTY_MESSAGES);
  const loading = useMessageStore((s) => !!s.loading[channelId]);
  const error = useMessageStore((s) => s.errors[channelId]);
  const hasMore = useMessageStore((s) => s.hasMore[channelId]);
  const earliest = useMessageStore((s) => s.earliestId[channelId]);
  const fetchMessages = useMessageStore((s) => s.fetchMessages);
  const blocked = useBlockedUsersStore((s) => s.blockedUsers);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomInset = useSharedValue(0);
  const lookup = useExpressionLookup(serverUrl);
  const owner = !!(realmUser?.isOwner || realmUser?.role === 'owner');
  const canRead = owner || hasChannelPermission(realmUser?.permissions, channel?.effective_permissions, PERMISSIONS.READ_CHAT_HISTORY);
  const canSend = canRead && (owner
    || hasChannelPermission(realmUser?.permissions, channel?.effective_permissions, PERMISSIONS.SEND_MESSAGES));
  const rows = useMemo(() => messages.filter((m) => !m.thread_id && !blocked.has(m.user_id)).slice().reverse(), [messages, blocked]);
  const fetchPage = useCallback((before?: string) => {
    if (canRead && serverUrl && token) void fetchMessages(channelId, before, { serverUrl, token });
  }, [canRead, channelId, fetchMessages, serverUrl, token]);

  useFocusEffect(useCallback(() => {
    // Always fetch: the cache may contain only messages received while watching.
    if (!canRead) return;
    fetchPage();
    useChannelStore.getState().setActiveChannel(channelId);
    const socket = serverUrl ? getSocket(serverUrl) : null;
    socket?.emit('channel:join', channelId);
    const reconnect = () => { socket?.emit('channel:join', channelId); fetchPage(); };
    socket?.on('connect', reconnect);
    return () => {
      socket?.off('connect', reconnect);
      if (useChannelStore.getState().activeChannelId === channelId) useChannelStore.getState().setActiveChannel(null);
    };
  }, [canRead, channelId, fetchPage, serverUrl]));

  useEffect(() => {
    if (useChannelStore.getState().activeChannelId !== channelId) return;
    useChannelStore.getState().resetCounts(channelId);
    if (account?.accountType === 'central' && serverUrl) {
      void createAuthenticatedApi().post('/api/notifications/read-stream', {
        streamKind: 'server', streamId: serverUrl, subsourceId: channelId,
      }).catch(() => {});
    }
  }, [account?.accountType, channelId, serverUrl, messages.length]);

  const send = (content = draft, attachments: UploadedComposerAttachment[] = []) => {
    const socket = serverUrl ? getSocket(serverUrl) : null;
    if (!socket?.connected) { setSendError('Chat is disconnected. Reconnect and try again.'); return; }
    if (!canSend || (!content.trim() && !attachments.length)) return;
    socket.emit('message:send', {
      channelId, content, attachments: attachments.map((a) => ({ url: a.url, mime: a.mime, size: a.size, thumbnailUrl: a.thumbnailUrl })),
      nsfwTags: attachments.some((a) => a.isNsfw) ? ['nsfw'] : [],
    });
    setDraft(''); setSendError(null);
  };

  return <View testID="theater-chat-panel" style={styles.root}>
    {!serverUrl || !token ? <Text style={styles.notice}>Connecting to chat…</Text>
      : !canRead ? <Text style={styles.notice}>You do not have permission to read this chat.</Text> : <>
      {!!error && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry chat history" onPress={() => fetchPage()} style={styles.notice}>
        <Text style={{ color: theme.colors.danger }}>{error} Tap to retry.</Text>
      </TouchableOpacity>}
      {loading && <ActivityIndicator accessibilityLabel="Loading chat history" color={theme.colors.accent} />}
      <FlatList inverted data={rows} keyExtractor={(m) => m.id} keyboardShouldPersistTaps="handled"
        style={styles.root} contentContainerStyle={styles.messages} windowSize={5} initialNumToRender={20}
        ListEmptyComponent={!loading && !error ? <Text style={styles.empty}>No messages yet.</Text> : null}
        ListFooterComponent={hasMore && earliest ? <TouchableOpacity accessibilityRole="button" disabled={loading}
          onPress={() => fetchPage(earliest)} style={styles.notice}><Text color={theme.colors.accent}>Load older messages</Text></TouchableOpacity> : null}
        renderItem={({ item }) => <View style={styles.message}>
          <Avatar username={item.display_name || item.username} uri={item.avatar} baseUrl={serverUrl}
            size={32} showStatus={false} style={styles.avatar} />
          <View style={styles.messageBody}>
            <View style={styles.meta}>
              <Text variant="caption" numberOfLines={1} style={{ color: theme.colors.text, fontWeight: '700', flexShrink: 1 }}>{item.display_name || item.username}</Text>
              <Text variant="caption" color={theme.colors.text3}>{formatMessageTimestamp(item.created_at < 1e12 ? item.created_at * 1000 : item.created_at)}</Text>
            </View>
            <MarkdownText text={item.content} color={theme.colors.text} attachments={item.attachments ?? (item.attachment_url
              ? [{ url: item.attachment_url, mime: item.attachment_type, size: item.attachment_size }] : null)}
              nsfwTags={item.nsfw_tags} serverUrl={serverUrl} expressionLookup={lookup} />
          </View>
        </View>} />
      {!!sendError && <Text accessibilityRole="alert" color={theme.colors.danger}>{sendError}</Text>}
      {canSend ? <MobileComposer value={draft} onChangeText={setDraft} onSend={send} bottomInset={bottomInset}
        serverUrl={serverUrl} channelId={channelId} expressionLookup={lookup} placeholder="Message theater…" mentionsEnabled />
        : <Text style={styles.notice} color={theme.colors.text3}>You do not have permission to send messages.</Text>}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 }, messages: { paddingHorizontal: 12, paddingVertical: 6 },
  message: { paddingVertical: 6, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  avatar: { flexShrink: 0 }, messageBody: { flex: 1, minWidth: 0 },
  meta: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 3 },
  notice: { padding: 10, minHeight: 44 }, empty: { padding: 16 },
});
