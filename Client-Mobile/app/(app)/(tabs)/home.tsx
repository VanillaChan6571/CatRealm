/**
 * Home tab — Friends list with banner cards, pending requests, add friend, and recent DMs.
 * Central accounts get the full friends experience; decentral accounts see recent DMs only.
 */

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { SafeAreaView } from '@/components/SafeAreaView';
import { useRouter } from 'expo-router';
import { BookText } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text, Avatar, Pressable, Sheet, FadeInImage } from '@/components';
import { useDeviceLayout } from '@/hooks/useDeviceLayout';
import { useAuthStore } from '@/stores/authStore';
import { useFriendStore } from '@/stores/friendStore';
import { useDMStore } from '@/stores/dmStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { AUTH_BASE } from '@/lib/api';
import type { Friend, FriendRequest } from '@/types';

type Tab = 'all' | 'pending' | 'add';
const ROLE_SYNC_INTERVAL_MS = 5000;

function formatStatusKey(status?: string | null): 'status.invisible' | 'status.away' | 'status.sleeping' | 'status.online' {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized || normalized === 'offline' || normalized === 'invisible') return 'status.invisible';
  if (normalized === 'away') return 'status.away';
  if (normalized === 'sleeping') return 'status.sleeping';
  return 'status.online';
}

function resolveUrl(path?: string | null): string | null {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return AUTH_BASE.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path);
}

// ─── Friend card with banner ──────────────────────────────────────────────────

function FriendCard({ friend, statusLabel, onOpenProfile, onRoles, onMessage, onRemove }: {
  friend: Friend;
  statusLabel: string;
  onOpenProfile: () => void;
  onRoles: () => void;
  onMessage: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { isTablet, width } = useDeviceLayout();
  const bannerUri = resolveUrl(friend.banner);
  const avatarUri = resolveUrl(friend.avatar);
  const bannerHeight = isTablet ? 200 : Math.max(112, Math.min(144, width * 0.34));

  return (
    <Pressable
      haptic
      minHit={1}
      onPress={onOpenProfile}
      style={[styles.card, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.lineSoft }]}
    >
      {/* Banner */}
      <View style={[styles.banner, { height: bannerHeight }]}>
        {bannerUri ? (
          <FadeInImage uri={bannerUri} style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.bannerFallback]} />
        )}
      </View>

      {/* Avatar overlapping banner */}
      <View style={styles.cardBody}>
        <View style={[styles.avatarRing, { borderColor: theme.colors.bgElev1 }]}>
          <Avatar username={friend.username} uri={avatarUri} size={48} shape="circle" />
        </View>
        <View style={styles.cardInfo}>
          <Text variant="subtitle" numberOfLines={1}>{friend.username}</Text>
          <Text variant="caption" color={theme.colors.text3}>
            {statusLabel}
          </Text>
        </View>
        <View style={styles.cardActions}>
          <Pressable
            haptic
            minHit={1}
            onPress={onRoles}
            style={[styles.actionBtn, { backgroundColor: theme.colors.bgElev2, borderRadius: theme.radius.sm }]}
          >
            <Text variant="caption" color={theme.colors.text}>{t('home.friendCardRoles')}</Text>
          </Pressable>
          <Pressable
            haptic
            minHit={1}
            onPress={onMessage}
            style={[styles.actionBtn, { backgroundColor: theme.colors.bgElev2, borderRadius: theme.radius.sm }]}
          >
            <Text variant="caption" color={theme.colors.text}>{t('home.friendCardMessage')}</Text>
          </Pressable>
          <Pressable
            haptic
            minHit={1}
            onPress={onRemove}
            style={[styles.actionBtn, { backgroundColor: theme.colors.bgElev2, borderRadius: theme.radius.sm }]}
          >
            <Text variant="caption" color={theme.colors.danger}>{t('home.friendCardRemove')}</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

// ─── Request row ──────────────────────────────────────────────────────────────

function RequestRow({ req, type, onAccept, onCancel }: {
  req: FriendRequest;
  type: 'incoming' | 'outgoing';
  onAccept?: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const isIncoming = type === 'incoming';
  const username = isIncoming ? req.from_username : req.to_username;
  const avatarUri = resolveUrl(isIncoming ? req.from_avatar : req.to_avatar);

  return (
    <View style={[styles.reqRow, { borderBottomColor: theme.colors.lineSoft }]}>
      <Avatar username={username} uri={avatarUri} size={36} shape="circle" />
      <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>{username}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {isIncoming && onAccept && (
          <Pressable
            haptic
            onPress={onAccept}
            style={[styles.actionBtn, { backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm }]}
          >
            <Text variant="caption" color={theme.colors.textOnAccent}>{t('home.requestAccept')}</Text>
          </Pressable>
        )}
        <Pressable
          haptic
          onPress={onCancel}
          style={[styles.actionBtn, { backgroundColor: theme.colors.bgElev2, borderRadius: theme.radius.sm }]}
        >
          <Text variant="caption" color={theme.colors.text2}>{isIncoming ? t('home.requestReject') : t('home.requestCancel')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function HomeTab() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { isTablet } = useDeviceLayout();
  const user = useAuthStore((s) => s.user);
  const isCentral = user?.accountType === 'central';

  const friends = useFriendStore((s) => s.friends);
  const incoming = useFriendStore((s) => s.incoming);
  const outgoing = useFriendStore((s) => s.outgoing);
  const loading = useFriendStore((s) => s.loading);
  const error = useFriendStore((s) => s.error);
  const fetchFriends = useFriendStore((s) => s.fetchFriends);
  const fetchRequests = useFriendStore((s) => s.fetchRequests);
  const sendRequest = useFriendStore((s) => s.sendRequest);
  const acceptRequest = useFriendStore((s) => s.acceptRequest);
  const rejectRequest = useFriendStore((s) => s.rejectRequest);
  const removeFriend = useFriendStore((s) => s.removeFriend);
  const clearError = useFriendStore((s) => s.clearError);
  const personalRoles = useFriendStore((s) => s.personalRoles);
  const roleAssignments = useFriendStore((s) => s.roleAssignments);
  const loadPersonalRoles = useFriendStore((s) => s.loadPersonalRoles);
  const createPersonalRole = useFriendStore((s) => s.createPersonalRole);
  const deletePersonalRole = useFriendStore((s) => s.deletePersonalRole);
  const setFriendRoleAssigned = useFriendStore((s) => s.setFriendRoleAssigned);

  const conversations = useDMStore((s) => s.conversations);
  const fetchConversations = useDMStore((s) => s.fetchConversations);
  const presence = usePresenceStore((s) => s.centralByUserId);
  const [tab, setTab] = useState<Tab>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [addUsername, setAddUsername] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [roleSheetOpen, setRoleSheetOpen] = useState(false);
  const [roleSheetFriend, setRoleSheetFriend] = useState<Friend | null>(null);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleColor, setNewRoleColor] = useState('#8B6FF7');
  const [filterRoleSheetOpen, setFilterRoleSheetOpen] = useState(false);
  const [confirmDeleteRoleId, setConfirmDeleteRoleId] = useState<string | null>(null);
  const [confirmRemoveFriend, setConfirmRemoveFriend] = useState<Friend | null>(null);

  useEffect(() => {
    if (isCentral) {
      void fetchFriends();
      void fetchRequests();
      void loadPersonalRoles();
    }
    void fetchConversations();
  }, [isCentral, fetchFriends, fetchRequests, fetchConversations, loadPersonalRoles]);

  useEffect(() => {
    if (!isCentral) return;
    const timer = setInterval(() => {
      void loadPersonalRoles();
    }, ROLE_SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isCentral, loadPersonalRoles]);

  const recentDMs = [...conversations]
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
    .slice(0, 8);

  const navigateToDM = (otherUserId: string, conversationId?: string) => {
    if (conversationId) {
      router.push({ pathname: '/dm/[conversationId]', params: { conversationId } });
    } else {
      router.push({ pathname: '/profile/[userId]', params: { userId: otherUserId, context: 'central' } });
    }
  };

  const handleSendRequest = async () => {
    if (!addUsername.trim()) return;
    setSuccessMsg('');
    clearError();
    await sendRequest(addUsername.trim());
    if (!useFriendStore.getState().error) {
      setSuccessMsg(t('home.friendRequestSentTo', { username: addUsername.trim() }));
      setAddUsername('');
    }
  };

  const handleRemove = (friend: Friend) => {
    setConfirmRemoveFriend(friend);
  };

  const openRoleSheet = (friend: Friend | null) => {
    setRoleSheetFriend(friend);
    setRoleSheetOpen(true);
  };

  const handleCreateRole = async () => {
    const name = newRoleName.trim();
    if (!name) return;
    await createPersonalRole(name, newRoleColor.trim() || null);
    if (!useFriendStore.getState().error) {
      setNewRoleName('');
    }
  };
  const rolePendingDelete = personalRoles.find((role) => role.id === confirmDeleteRoleId) ?? null;
  const openDeleteConfirm = (roleId: string) => {
    setRoleSheetOpen(false);
    setTimeout(() => {
      setConfirmDeleteRoleId(roleId);
    }, 140);
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'all', label: t('home.allCount', { count: friends.length }) },
    { key: 'pending', label: incoming.length > 0 ? t('home.pendingCount', { count: incoming.length }) : t('home.pending') },
    { key: 'add', label: t('home.addFriend') },
  ];

  const filteredFriends = roleFilter === 'all'
    ? friends
    : friends.filter((friend) => (roleAssignments[friend.id] ?? []).includes(roleFilter));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bgApp }} edges={['top']}>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.sm }}>
        <Text variant="display">{t('tabs.home')}</Text>
      </View>

      {/* Tabs — only shown for central accounts */}
      {isCentral && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.topTabsScroll}
          contentContainerStyle={[styles.tabBar, { paddingHorizontal: theme.spacing.lg, gap: 6 }]}
        >
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              haptic
              minHit={1}
              onPress={() => { setTab(t.key); clearError(); setSuccessMsg(''); }}
              style={[
                styles.tabBtn,
                {
                  backgroundColor: tab === t.key ? theme.colors.accent : theme.colors.bgElev1,
                  borderRadius: theme.radius.md,
                },
              ]}
            >
              <Text
                variant="caption"
                color={tab === t.key ? theme.colors.textOnAccent : theme.colors.text2}
                style={{ fontWeight: '600' }}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* My Notes entry — always visible */}
      <Pressable
        haptic
        onPress={() => router.push('/notes')}
        style={[
          styles.notesBtn,
          { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.lineSoft, borderRadius: theme.radius.md, marginHorizontal: theme.spacing.lg, marginBottom: theme.spacing.md },
        ]}
      >
        <View style={[styles.notesBtnIcon, { backgroundColor: theme.colors.accent + '22' }]}>
          <BookText color={theme.colors.accent} size={18} />
        </View>
        <Text variant="subtitle" style={{ flex: 1 }}>{t('home.myNotes')}</Text>
        <Text variant="caption" color={theme.colors.text3}>{t('home.privateEncrypted')}</Text>
      </Pressable>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>

        {(!isCentral || tab === 'all') && (
          <>
            {isCentral && (
              <View style={{ marginTop: theme.spacing.lg }}>
                <View style={[styles.filterHeaderRow, { paddingHorizontal: theme.spacing.lg }]}>
                  <Text
                    variant="caption"
                    color={theme.colors.text3}
                    style={styles.sectionLabel}
                  >
                    {t('home.filterByRoles')}
                  </Text>
                  <Text variant="caption" color={theme.colors.text3}>
                    {personalRoles.length}/69
                  </Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={[styles.tabBar, { paddingHorizontal: theme.spacing.lg, gap: 6, paddingTop: 0 }]}
                >
                  <Pressable
                    haptic
                    onPress={() => setRoleFilter('all')}
                    style={[
                      styles.tabBtn,
                      {
                        backgroundColor: roleFilter === 'all' ? theme.colors.accent : theme.colors.bgElev1,
                        borderRadius: theme.radius.md,
                      },
                    ]}
                  >
                    <Text variant="caption" color={roleFilter === 'all' ? theme.colors.textOnAccent : theme.colors.text2} style={{ fontWeight: '600' }}>
                      {t('home.allFriends')}
                    </Text>
                  </Pressable>
                  <Pressable
                    haptic
                    minHit={1}
                    onPress={() => setFilterRoleSheetOpen(true)}
                    style={[
                      styles.tabBtn,
                      {
                        backgroundColor: roleFilter !== 'all' ? theme.colors.accent : theme.colors.bgElev1,
                        borderRadius: theme.radius.md,
                      },
                    ]}
                  >
                    <Text variant="caption" color={roleFilter !== 'all' ? theme.colors.textOnAccent : theme.colors.text2} style={{ fontWeight: '600' }}>
                      {t('home.filterRoles')}
                    </Text>
                  </Pressable>
                  <Pressable
                    haptic
                    minHit={1}
                    onPress={() => openRoleSheet(null)}
                    style={[
                      styles.tabBtn,
                      {
                        backgroundColor: theme.colors.bgElev1,
                        borderRadius: theme.radius.md,
                      },
                    ]}
                  >
                    <Text variant="caption" color={theme.colors.text2} style={{ fontWeight: '600' }}>
                      {t('home.roleManagement')}
                    </Text>
                  </Pressable>
                </ScrollView>
              </View>
            )}

            <View style={[
              { padding: theme.spacing.lg, gap: 10 },
              isTablet && { flexDirection: 'row', flexWrap: 'wrap' },
            ]}>
              {(isCentral ? filteredFriends : friends).length === 0 ? (
                <Text variant="body" color={theme.colors.text3} style={{ textAlign: 'center', marginTop: 40 }}>
                  {isCentral && roleFilter !== 'all'
                    ? t('home.noFriendsRoleFilter')
                    : t('home.noFriendsYet')}
                </Text>
              ) : (
                (isCentral ? filteredFriends : friends).map((friend) => {
                  const convo = conversations.find((c) => c.otherUserId === friend.id);
                  const friendStatus = presence[friend.id]?.status ?? convo?.otherStatus ?? friend.status;
                  return (
                    <View key={friend.id} style={isTablet && { width: '48%' }}>
                      <FriendCard
                        friend={friend}
                        statusLabel={t(formatStatusKey(friendStatus))}
                        onOpenProfile={() => router.push({ pathname: '/profile/[userId]', params: { userId: friend.id, context: 'central' } })}
                        onRoles={() => openRoleSheet(friend)}
                        onMessage={() => navigateToDM(friend.id, convo?.id)}
                        onRemove={() => handleRemove(friend)}
                      />
                    </View>
                  );
                })
              )}
            </View>

            {!isCentral && recentDMs.length === 0 && friends.length === 0 && (
              <View style={{ padding: theme.spacing.xl, alignItems: 'center' }}>
                <Text variant="body" color={theme.colors.text3}>
                  {t('home.noRecentActivity')}
                </Text>
              </View>
            )}
          </>
        )}

        {/* ── Pending tab ── */}
        {isCentral && tab === 'pending' && (
          <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg }}>
            {incoming.length > 0 && (
              <>
                <Text variant="caption" color={theme.colors.text3} style={styles.sectionLabel}>{t('home.incoming')}</Text>
                {incoming.map((req) => (
                  <RequestRow
                    key={req.id}
                    req={req}
                    type="incoming"
                    onAccept={() => void acceptRequest(req.id)}
                    onCancel={() => void rejectRequest(req.id)}
                  />
                ))}
              </>
            )}
            {outgoing.length > 0 && (
              <>
                <Text variant="caption" color={theme.colors.text3} style={[styles.sectionLabel, { marginTop: 20 }]}>{t('home.outgoing')}</Text>
                {outgoing.map((req) => (
                  <RequestRow
                    key={req.id}
                    req={req}
                    type="outgoing"
                    onCancel={() => void rejectRequest(req.id)}
                  />
                ))}
              </>
            )}
            {incoming.length === 0 && outgoing.length === 0 && (
              <Text variant="body" color={theme.colors.text3} style={{ textAlign: 'center', marginTop: 20 }}>
                {t('home.noPendingRequests')}
              </Text>
            )}
          </View>
        )}

        {/* ── Add Friend tab ── */}
        {isCentral && tab === 'add' && (
          <View style={{ padding: theme.spacing.lg, gap: 12 }}>
            <Text variant="bodySmall" color={theme.colors.text3}>
              {t('home.addFriendDesc')}
            </Text>
            <TextInput
              value={addUsername}
              onChangeText={setAddUsername}
              placeholder={t('home.enterExactUsername')}
              placeholderTextColor={theme.colors.text3}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { backgroundColor: theme.colors.bgElev2, color: theme.colors.text, borderColor: theme.colors.lineSoft }]}
            />
            {error ? <Text variant="bodySmall" color={theme.colors.danger}>{error}</Text> : null}
            {successMsg ? <Text variant="bodySmall" color={theme.colors.online}>{successMsg}</Text> : null}
            <Pressable
              haptic
              onPress={() => void handleSendRequest()}
              style={[styles.sendBtn, { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md, opacity: (!addUsername.trim() || loading) ? 0.5 : 1 }]}
            >
              {loading
                ? <ActivityIndicator color={theme.colors.textOnAccent} size="small" />
                : <Text variant="body" color={theme.colors.textOnAccent} style={{ fontWeight: '600' }}>{t('home.sendFriendRequest')}</Text>
              }
            </Pressable>
          </View>
        )}

      </ScrollView>

      <Sheet open={filterRoleSheetOpen} onClose={() => setFilterRoleSheetOpen(false)} maxHeightFraction={0.62}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.xl }}>
          <Text variant="subtitle" style={{ marginBottom: 6 }}>{t('home.filterRoles')}</Text>
          <Text variant="caption" color={theme.colors.text3} style={{ marginBottom: 12 }}>
            {t('home.selectRoleFilter')}
          </Text>
          <Pressable
            haptic
            onPress={() => {
              setRoleFilter('all');
              setFilterRoleSheetOpen(false);
            }}
            style={[
              styles.roleRow,
              {
                borderColor: roleFilter === 'all' ? theme.colors.accent : theme.colors.lineSoft,
                backgroundColor: theme.colors.bgElev2,
              },
            ]}
          >
            <View style={[styles.roleDot, { backgroundColor: theme.colors.accent }]} />
            <Text variant="body" style={{ flex: 1 }}>{t('home.allFriends')}</Text>
            {roleFilter === 'all' ? <Text variant="caption" color={theme.colors.online}>{t('home.selected')}</Text> : null}
          </Pressable>
          {personalRoles.map((role) => (
            <Pressable
              key={role.id}
              haptic
              onPress={() => {
                setRoleFilter(role.id);
                setFilterRoleSheetOpen(false);
              }}
              style={[
                styles.roleRow,
                {
                  borderColor: roleFilter === role.id ? (role.color || theme.colors.accent) : theme.colors.lineSoft,
                  backgroundColor: theme.colors.bgElev2,
                },
              ]}
            >
              <View style={[styles.roleDot, { backgroundColor: role.color || theme.colors.accent }]} />
              <Text variant="body" style={{ flex: 1 }}>{role.name}</Text>
              {roleFilter === role.id ? <Text variant="caption" color={theme.colors.online}>{t('home.selected')}</Text> : null}
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>

      <Sheet open={roleSheetOpen} onClose={() => setRoleSheetOpen(false)} maxHeightFraction={0.72}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.xl }}>
          <Text variant="subtitle" style={{ marginBottom: 6 }}>
            {roleSheetFriend ? t('home.rolesFor', { username: roleSheetFriend.username }) : t('home.createPersonalRole')}
          </Text>
          <Text variant="caption" color={theme.colors.text3} style={{ marginBottom: 12 }}>
            {roleSheetFriend ? t('home.tapToAssignUnassign') : t('home.createRoleDesc')}
          </Text>

          <View style={{ gap: 10, marginBottom: 14 }}>
            <TextInput
              value={newRoleName}
              onChangeText={setNewRoleName}
              placeholder={t('home.roleName')}
              placeholderTextColor={theme.colors.text3}
              style={[styles.input, { backgroundColor: theme.colors.bgElev2, color: theme.colors.text, borderColor: theme.colors.lineSoft }]}
            />
            <TextInput
              value={newRoleColor}
              onChangeText={setNewRoleColor}
              placeholder="#8B6FF7"
              placeholderTextColor={theme.colors.text3}
              autoCapitalize="characters"
              style={[styles.input, { backgroundColor: theme.colors.bgElev2, color: theme.colors.text, borderColor: theme.colors.lineSoft }]}
            />
            <Pressable
              haptic
              onPress={() => void handleCreateRole()}
              style={[styles.sendBtn, { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md, opacity: (!newRoleName.trim() || loading) ? 0.5 : 1 }]}
            >
              <Text variant="body" color={theme.colors.textOnAccent} style={{ fontWeight: '600' }}>{t('home.createRole')}</Text>
            </Pressable>
          </View>

          {personalRoles.length === 0 && (
            <Text variant="bodySmall" color={theme.colors.text3}>
              {t('home.noRolesYet')}
            </Text>
          )}
          {personalRoles.map((role) => {
            const assigned = roleSheetFriend ? (roleAssignments[roleSheetFriend.id] ?? []).includes(role.id) : false;
            const roleRow = (
              <Pressable
                key={role.id}
                haptic
                onPress={() => {
                  if (!roleSheetFriend) return;
                  void setFriendRoleAssigned(roleSheetFriend.id, role.id, !assigned);
                }}
                style={[
                  styles.roleRow,
                  {
                    borderColor: assigned ? (role.color || theme.colors.accent) : theme.colors.lineSoft,
                    backgroundColor: theme.colors.bgElev2,
                  },
                ]}
              >
                <View style={[styles.roleDot, { backgroundColor: role.color || theme.colors.accent }]} />
                <Text variant="body" style={{ flex: 1 }}>{role.name}</Text>
                <Text variant="caption" color={assigned ? theme.colors.online : theme.colors.text3}>
                  {roleSheetFriend ? (assigned ? t('home.assigned') : t('home.notAssigned')) : t('home.friendCount', { count: role.friendCount })}
                </Text>
              </Pressable>
            );

            if (roleSheetFriend) return roleRow;
            return (
              <Swipeable
                key={role.id}
                renderRightActions={() => (
                  <View style={styles.roleDeleteWrap}>
                    <Pressable
                      haptic
                      minHit={1}
                      onPress={() => openDeleteConfirm(role.id)}
                      style={[
                        styles.roleDeleteBtn,
                        { backgroundColor: theme.colors.danger, borderRadius: theme.radius.md },
                      ]}
                    >
                      <Text variant="caption" color={theme.colors.textOnAccent} style={{ fontWeight: '700' }}>
                        {t('common.delete')}
                      </Text>
                    </Pressable>
                  </View>
                )}
              >
                {roleRow}
              </Swipeable>
            );
          })}
        </ScrollView>
      </Sheet>

      <Sheet open={!!confirmRemoveFriend} onClose={() => setConfirmRemoveFriend(null)} maxHeightFraction={0.34}>
        <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.xl }}>
          <Text variant="subtitle" style={{ marginBottom: 10 }}>{t('home.removeFriend')}</Text>
          <Text variant="body" color={theme.colors.text2} style={{ marginBottom: 16 }}>
            {t('home.removeFriendConfirm', { username: confirmRemoveFriend?.username })}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              haptic
              onPress={() => setConfirmRemoveFriend(null)}
              style={[styles.confirmBtn, { backgroundColor: theme.colors.bgElev2, borderRadius: theme.radius.md }]}
            >
              <Text variant="body" color={theme.colors.text}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              haptic
              onPress={async () => {
                if (!confirmRemoveFriend) return;
                await removeFriend(confirmRemoveFriend.id);
                setConfirmRemoveFriend(null);
              }}
              style={[styles.confirmBtn, { backgroundColor: theme.colors.danger, borderRadius: theme.radius.md }]}
            >
              <Text variant="body" color={theme.colors.textOnAccent} style={{ fontWeight: '700' }}>{t('common.remove')}</Text>
            </Pressable>
          </View>
        </View>
      </Sheet>

      <Sheet open={!!confirmDeleteRoleId} onClose={() => setConfirmDeleteRoleId(null)} maxHeightFraction={0.34}>
        <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.xl }}>
          <Text variant="subtitle" style={{ marginBottom: 10 }}>{t('home.confirmDeleteRole')}</Text>
          <Text variant="body" color={theme.colors.text2} style={{ marginBottom: 16 }}>
            {t('home.confirmDeleteRoleDesc')}
          </Text>
          {rolePendingDelete ? (
            <Text variant="caption" color={theme.colors.text3} style={{ marginBottom: 16 }}>
              {rolePendingDelete.name}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              haptic
              onPress={() => {
                setConfirmDeleteRoleId(null);
                setRoleSheetOpen(true);
              }}
              style={[styles.confirmBtn, { backgroundColor: theme.colors.bgElev2, borderRadius: theme.radius.md }]}
            >
              <Text variant="body" color={theme.colors.text}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              haptic
              onPress={async () => {
                if (!confirmDeleteRoleId) return;
                await deletePersonalRole(confirmDeleteRoleId);
                setConfirmDeleteRoleId(null);
                setRoleSheetOpen(true);
              }}
              style={[styles.confirmBtn, { backgroundColor: theme.colors.danger, borderRadius: theme.radius.md }]}
            >
              <Text variant="body" color={theme.colors.textOnAccent} style={{ fontWeight: '700' }}>{t('common.delete')}</Text>
            </Pressable>
          </View>
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  notesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: 1,
  },
  notesBtnIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTabsScroll: {
    maxHeight: 64,
    flexGrow: 0,
  },
  tabBar: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  tabBtn: {
    paddingHorizontal: 14,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  filterHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  card: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
    width: '100%',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
  },
  banner: {
    overflow: 'hidden',
  },
  bannerFallback: {
    backgroundColor: '#3f3f46',
  },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 12,
    paddingTop: 4,
    gap: 10,
  },
  avatarRing: {
    borderRadius: 28,
    borderWidth: 3,
    marginTop: -24,
    alignSelf: 'flex-start',
  },
  cardInfo: {
    flex: 1,
    minWidth: 0,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 6,
    flexShrink: 0,
  },
  actionBtn: {
    paddingHorizontal: 10,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'flex-start',
  },
  dmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  sendBtn: {
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    gap: 10,
  },
  roleDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  roleDeleteWrap: {
    justifyContent: 'center',
    marginBottom: 8,
    marginLeft: 8,
  },
  roleDeleteBtn: {
    width: 88,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtn: {
    flex: 1,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
