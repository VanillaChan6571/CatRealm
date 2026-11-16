import { memo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { CornerUpRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { BotBadge } from './BotBadge';
import { Pressable } from './Pressable';
import { TranslatableMarkdownText } from './TranslatableMarkdownText';
import { RoleNameText } from '@/lib/roleStyles';
import { resolveEmoteFromCache, type ExpressionLookup } from '@/lib/expressionCache';
import { debugLog } from '@/lib/debugLog';
import { formatMessageTimestamp } from '@/utils/formatTime';
import type { Message } from '@/types';

/** Realm chat message row: grouping, reply quote, bot interaction, reactions. Used by channels and threads. */
export interface ChannelMessageRowProps {
  message: Message;
  prevMessage: Message | null;
  selfUserId: string | undefined;
  avatarBaseUrl?: string | null;
  serverUrl?: string | null;
  expressionLookup?: ExpressionLookup | null;
  isPinned?: boolean;
  onAvatarPress: (userId: string) => void;
  onMessageLongPress: (message: Message, isSelf: boolean) => void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  onOpenReactions?: (message: Message, emoji?: string) => void;
}

// Matches compact emote tokens: :server:name:, :name:, :name:ownerId:, etc.
// (same renderer as the DM screen's reaction chips)
const REACTION_TOKEN_RE = /^:(https?:\/\/[^\s:]+(?::\d{1,5})?):(?:sticker:)?([a-z0-9_-]{1,64})(?::([a-z0-9_-]{3,128}))?:|^:(?:sticker:)?([a-z0-9_-]{1,64})(?::([a-z0-9_-]{3,128}))?:/i;

function ReactionEmoji({ emoji, serverUrl }: { emoji: string; serverUrl?: string | null }) {
  const m = REACTION_TOKEN_RE.exec(emoji);
  if (m) {
    const tokenServerUrl = m[1] ?? null;
    const name = m[2] || m[4] || '';
    const ownerId = m[3] || m[5] || null;
    const url = resolveEmoteFromCache(name, false, serverUrl, tokenServerUrl, ownerId);
    if (url) {
      return <Image source={{ uri: url }} style={{ width: 18, height: 18 }} resizeMode="contain" />;
    }
    return <Text style={{ fontSize: 11 }}>:{name}:</Text>;
  }
  return <Text style={{ fontSize: 14 }}>{emoji}</Text>;
}

const GROUP_THRESHOLD_MS = 5 * 60 * 1000;
const PERF_ROW_WARN_MS = 8;

function toTimestampMs(value: number): number {
  return value < 10_000_000_000 ? value * 1000 : value;
}

export const ChannelMessageRow = memo(function ChannelMessageRow({
  message,
  prevMessage,
  selfUserId,
  avatarBaseUrl,
  serverUrl,
  expressionLookup,
  isPinned,
  onAvatarPress,
  onMessageLongPress,
  onToggleReaction,
  onOpenReactions,
}: ChannelMessageRowProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  // System messages render as a centered notice row (no avatar, no long-press)
  if (message.message_type === 'system') {
    return (
      <View style={styles.systemRow}>
        <Text style={styles.systemIcon}>🛠</Text>
        <Text variant="caption" color={theme.colors.text3} style={{ flex: 1 }}>
          {message.content}
        </Text>
      </View>
    );
  }

  const isGrouped =
    prevMessage !== null &&
    prevMessage.message_type !== 'system' &&
    prevMessage.user_id === message.user_id &&
    toTimestampMs(message.created_at) - toTimestampMs(prevMessage.created_at) < GROUP_THRESHOLD_MS;

  const isSelf = message.user_id === selfUserId;
  const timestamp = formatMessageTimestamp(toTimestampMs(message.created_at));

  const renderStartMs = globalThis.performance?.now?.() ?? Date.now();

  const rowNode = (
    <Pressable minHit={0} onLongPress={() => onMessageLongPress(message, isSelf)} style={[styles.msgRow, { paddingTop: isGrouped ? 2 : 12 }]}>
      {isGrouped ? (
        <View style={styles.avatarPlaceholder} />
      ) : (
        // minHit matches the avatar so a grouped follow-up's 36pt spacer lines its text up with
        // this one (the default 44pt minimum widened the column); hitSlop keeps the tap target big.
        <Pressable haptic minHit={36} onPress={() => onAvatarPress(message.user_id)}>
          <Avatar
            username={message.username}
            uri={message.avatar}
            baseUrl={avatarBaseUrl}
            size={36}
          />
        </Pressable>
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
        {message.reply_to && (
          <View style={[styles.replyQuote, { borderLeftColor: theme.colors.text3 }]}>
            <Text variant="caption" color={theme.colors.accent} style={{ fontWeight: '600' }}>
              {message.reply_to.username}
            </Text>
            <Text variant="caption" color={theme.colors.text3} numberOfLines={1} style={{ flex: 1 }}>
              {'  '}{message.reply_to.content}
            </Text>
          </View>
        )}
        {!isGrouped && (
          <View style={styles.msgMeta}>
            <Pressable haptic onPress={() => onAvatarPress(message.user_id)}>
              <RoleNameText
                color={message.role_color}
                styleType={message.role_style_type}
                styleColors={message.role_style_colors}
                numberOfLines={1}
              >
                {message.display_name ?? message.username}
              </RoleNameText>
            </Pressable>
            {message.is_bot ? <BotBadge /> : null}
            {message.ephemeral ? (
              <Text variant="caption" color="#FACC15" style={{ marginLeft: 4, fontWeight: '600' }}>Only you can see this</Text>
            ) : null}
            {isPinned ? null : null}
            <Text variant="caption" color={theme.colors.text3} style={{ marginLeft: 6 }}>
              {timestamp}
            </Text>
          </View>
        )}
        <TranslatableMarkdownText
          messageId={message.id}
          text={message.content}
          color={theme.colors.text}
          attachments={message.attachments}
          serverUrl={serverUrl}
          expressionLookup={expressionLookup}
          nsfwTags={message.nsfw_tags}
          voiceExpiresAt={message.voice_expires_at}
          allowEmbeds={message.embeds_enabled !== 0}
          linkPreviews
        />
        {message.edited ? (
          <Text variant="caption" color={theme.colors.text3}>{t('common.edited')}</Text>
        ) : null}
        {(message.reactions?.length ?? 0) > 0 && (
          <View style={styles.reactionsRow}>
            {message.reactions!.map((reaction) => {
              const reacted = reaction.reacted || Boolean(selfUserId && reaction.users?.includes(selfUserId));
              return (
                <Pressable
                  key={reaction.emoji}
                  disabled={!onToggleReaction}
                  onPress={() => onToggleReaction?.(message.id, reaction.emoji)}
                  onLongPress={() => onOpenReactions?.(message, reaction.emoji)}
                  style={[
                    styles.reactionChip,
                    reacted
                      ? { backgroundColor: theme.colors.accent + '33', borderColor: theme.colors.accent }
                      : { backgroundColor: theme.colors.bgElev2, borderColor: theme.colors.lineSoft },
                  ]}
                >
                  <ReactionEmoji emoji={reaction.emoji} serverUrl={serverUrl} />
                  <Text variant="caption" style={{ marginLeft: 4, color: reacted ? theme.colors.accent : theme.colors.text2 }}>
                    {reaction.count}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    </Pressable>
  );

  const renderEndMs = globalThis.performance?.now?.() ?? Date.now();
  const renderCostMs = renderEndMs - renderStartMs;
  if (renderCostMs >= PERF_ROW_WARN_MS) {
    debugLog('ChannelScreen', 'perf:message-row-expensive', {
      messageId: message.id,
      channelId: message.channel_id,
      costMs: Math.round(renderCostMs * 100) / 100,
      contentLength: message.content?.length ?? 0,
      attachmentCount: message.attachments?.length ?? 0,
      hasReply: Boolean(message.reply_to),
      messageType: message.message_type ?? 'basic',
      hasRoleStyle: Boolean(message.role_style_type),
      edited: Boolean(message.edited),
      grouped: isGrouped,
    });
  }

  return rowNode;
}, (prev, next) =>
  prev.message === next.message &&
  prev.prevMessage === next.prevMessage &&
  prev.isPinned === next.isPinned &&
  prev.expressionLookup === next.expressionLookup &&
  prev.selfUserId === next.selfUserId &&
  prev.avatarBaseUrl === next.avatarBaseUrl &&
  prev.serverUrl === next.serverUrl &&
  prev.onAvatarPress === next.onAvatarPress &&
  prev.onMessageLongPress === next.onMessageLongPress &&
  prev.onToggleReaction === next.onToggleReaction &&
  prev.onOpenReactions === next.onOpenReactions,
);

const styles = StyleSheet.create({
  msgRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingBottom: 2,
    gap: 10,
  },
  avatarPlaceholder: {
    width: 36,
  },
  systemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 8,
    opacity: 0.7,
  },
  systemIcon: {
    fontSize: 13,
  },
  msgMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
    flexWrap: 'wrap',
  },
  botInteraction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
    overflow: 'hidden',
  },
  replyQuote: {
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 2,
    paddingLeft: 6,
    marginBottom: 2,
    opacity: 0.75,
    overflow: 'hidden',
  },
  reactionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
});
