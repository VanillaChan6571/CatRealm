import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Crown } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { Pressable } from './Pressable';
import { Sheet } from './Sheet';
import { createAuthenticatedApi } from '@/lib/api';
import { usePresenceStore } from '@/stores/presenceStore';
import type { UserStatus } from '@/types';

interface GroupMember {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  status: UserStatus | null;
  customStatusText: string | null;
  isOwner: boolean;
}

const isOffline = (status: UserStatus | null) => !status || status === 'invisible';

/** Group chat member list. Live presence wins over the status snapshot from the group detail. */
export function GroupMembersSheet({
  open,
  onClose,
  groupChatId,
  mediaUrl,
  onOpenProfile,
}: {
  open: boolean;
  onClose: () => void;
  groupChatId: string;
  mediaUrl?: string | null;
  onOpenProfile: (userId: string) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const presence = usePresenceStore((s) => s.centralByUserId);
  const [members, setMembers] = useState<GroupMember[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void createAuthenticatedApi()
      .get<{ members?: GroupMember[] }>(`/api/group-chats/${groupChatId}`)
      .then((res) => { if (!cancelled) setMembers(res.data.members ?? []); })
      .catch(() => { if (!cancelled) setMembers((prev) => prev ?? []); });
    return () => { cancelled = true; };
  }, [open, groupChatId]);

  const resolveAvatar = (uri: string | null): string | undefined => {
    if (!uri) return undefined;
    if (uri.startsWith('http')) return uri;
    const base = mediaUrl?.replace(/\/$/, '') ?? '';
    return base + (uri.startsWith('/') ? uri : '/' + uri);
  };

  const rows = (members ?? [])
    .map((m) => {
      const live = presence[m.id];
      return {
        ...m,
        status: live?.status ?? m.status,
        customStatusText: live?.customStatusText ?? m.customStatusText,
      };
    })
    .sort((a, b) => Number(isOffline(a.status)) - Number(isOffline(b.status)) || Number(b.isOwner) - Number(a.isOwner));

  return (
    <Sheet open={open} onClose={onClose} maxHeightFraction={0.7}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <Text variant="subtitle">{t('chat.members')}</Text>
      </View>
      {members === null ? (
        <ActivityIndicator color={theme.colors.accent} style={{ margin: 24 }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 16 }}>
          {rows.map((m) => {
            const offline = isOffline(m.status);
            const subtitle = m.customStatusText?.trim()
              || (m.status && m.status !== 'online' && !offline ? t(`status.${m.status}`) : null);
            return (
              <Pressable
                key={m.id}
                haptic
                onPress={() => { onClose(); onOpenProfile(m.id); }}
                style={[styles.row, offline && { opacity: 0.5 }]}
              >
                <Avatar username={m.username} uri={resolveAvatar(m.avatar)} size={36} shape="square" status={offline ? null : m.status} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.nameRow}>
                    {m.isOwner ? <Crown size={14} color={theme.colors.warning} /> : null}
                    <Text variant="body" numberOfLines={1} style={{ flexShrink: 1 }}>{m.displayName || m.username}</Text>
                  </View>
                  {subtitle ? (
                    <Text variant="caption" color={theme.colors.text3} numberOfLines={1}>{subtitle}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
