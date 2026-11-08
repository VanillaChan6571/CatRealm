import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, ChevronDown, ChevronRight, ImageIcon, LayoutGrid, List, MessageSquare, Search, SlidersHorizontal } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { BotBadge } from './BotBadge';
import { Pressable } from './Pressable';
import { Sheet } from './Sheet';
import { NewForumPostSheet } from './NewForumPostSheet';
import { createApi } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { formatMessageTimestamp } from '@/utils/formatTime';
import type { Channel, ForumPost } from '@/types';

type SortMode = 'activity' | 'newest' | 'oldest';
const SORT_MODES: SortMode[] = ['activity', 'newest', 'oldest'];
const PADDING = 12;
const GAP = 10;

// Each FlatList row is one list card or one gallery row, so both layouts share a list.
type Row =
  | { kind: 'posts'; key: string; posts: ForumPost[] }
  | { kind: 'archived'; key: 'archived' };

function toMs(v: number) { return v < 10_000_000_000 ? v * 1000 : v; }

function chunk(posts: ForumPost[], size: number, prefix: string): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < posts.length; i += size) {
    rows.push({ kind: 'posts', key: `${prefix}:${posts[i].id}`, posts: posts.slice(i, i + size) });
  }
  return rows;
}

interface Props {
  channel: Channel;
  serverId: string;
  serverUrl?: string | null;
  selfId?: string;
  canCreatePost: boolean;
  canManage: boolean;
}

export function ForumChannelView({ channel, serverId, serverUrl, selfId, canCreatePost, canManage }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();

  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('activity');
  const [sortOpen, setSortOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [composing, setComposing] = useState(false);
  // 'user_choice' forums let the viewer toggle (list first, like desktop); otherwise the channel setting wins.
  const layout = channel.forum_layout ?? 'user_choice';
  const [userView, setUserView] = useState<'list' | 'gallery'>('list');
  const gallery = layout === 'gallery' || (layout === 'user_choice' && userView === 'gallery');
  // Measured, not flex-sized: a lone card in the last gallery row must match the others.
  const [listWidth, setListWidth] = useState(0);
  const columns = listWidth >= 700 ? 3 : 2;
  const galleryCardWidth = Math.max(0, (listWidth - PADDING * 2 - GAP * (columns - 1)) / columns);

  const load = useCallback(async () => {
    try {
      const res = await createApi().get<ForumPost[]>('/api/threads/forum', { params: { channelId: channel.id, archived: 1 } });
      setPosts(Array.isArray(res.data) ? res.data : []);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [channel.id]);

  useEffect(() => {
    setLoading(true);
    setSearch('');
    setShowArchived(false);
    void load();
  }, [load]);

  // Deletions from other clients drop the card; pull-to-refresh covers new posts.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onDeleted = (payload: { id: string }) => setPosts((prev) => prev.filter((p) => p.id !== payload.id));
    socket.on('forum:deleted', onDeleted);
    return () => { socket.off('forum:deleted', onDeleted); };
  }, []);

  const resolveUrl = useCallback((path?: string | null) => {
    if (!path) return undefined;
    if (/^https?:\/\//i.test(path)) return path;
    return `${(serverUrl ?? '').replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  }, [serverUrl]);

  const { activeCount, archivedCount, rows } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (p: ForumPost) => !q
      || p.name.toLowerCase().includes(q)
      || (p.preview_content ?? '').toLowerCase().includes(q)
      || p.author_username.toLowerCase().includes(q)
      || (p.author_display_name ?? '').toLowerCase().includes(q);
    const sorted = posts.filter(matches).sort((a, b) => {
      if (sortMode === 'newest') return b.created_at - a.created_at;
      if (sortMode === 'oldest') return a.created_at - b.created_at;
      return (b.last_message_at ?? b.created_at) - (a.last_message_at ?? a.created_at);
    });
    const active = sorted.filter((p) => !p.archived);
    const archived = sorted.filter((p) => !!p.archived);
    const size = gallery ? columns : 1;
    const out: Row[] = chunk(active, size, 'a');
    if (archived.length > 0) {
      out.push({ kind: 'archived', key: 'archived' });
      if (showArchived) out.push(...chunk(archived, size, 'x'));
    }
    return { activeCount: active.length, archivedCount: archived.length, rows: out };
  }, [posts, search, sortMode, showArchived, gallery, columns]);

  const openPost = (post: ForumPost) => {
    router.push({
      pathname: '/server/[serverId]/threads/[channelId]',
      params: { serverId, channelId: post.id, parentChannelId: channel.id, title: post.name },
    });
  };

  const handleLongPress = (post: ForumPost) => {
    const canDelete = canManage || post.created_by === selfId;
    if (!canManage && !canDelete) return;
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [];
    if (canManage) {
      buttons.push({
        text: post.archived ? t('forum.unarchive') : t('forum.archive'),
        onPress: () => {
          void createApi().post(`/api/threads/${post.id}/${post.archived ? 'unarchive' : 'archive'}`)
            .then(load)
            .catch(() => Alert.alert(t('common.error'), t('forum.actionFailed')));
        },
      });
    }
    if (canDelete) {
      buttons.push({
        text: t('forum.delete'),
        style: 'destructive',
        onPress: () => Alert.alert(t('forum.deleteConfirmTitle'), t('forum.deleteConfirmBody', { name: post.name }), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('forum.delete'),
            style: 'destructive',
            onPress: () => {
              void createApi().delete(`/api/threads/${post.id}`)
                .then(() => setPosts((prev) => prev.filter((p) => p.id !== post.id)))
                .catch(() => Alert.alert(t('common.error'), t('forum.actionFailed')));
            },
          },
        ]),
      });
    }
    buttons.push({ text: t('common.cancel'), style: 'cancel' });
    Alert.alert(post.name, undefined, buttons);
  };

  const cardFrame = { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.line, borderRadius: theme.radius.lg };

  const archivedPill = (overlay: boolean) => (
    <View style={[styles.archivedPill, { backgroundColor: overlay ? 'rgba(0,0,0,0.6)' : theme.colors.warning + '1A' }]}>
      <Text style={[styles.archivedPillText, { color: theme.colors.warning }]}>{t('forum.archivedBadge')}</Text>
    </View>
  );

  const replyPill = (post: ForumPost, bordered: boolean) => (
    <View style={[styles.replyPill, bordered && { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.line, backgroundColor: theme.colors.bgApp }]}>
      <MessageSquare size={11} color={theme.colors.text3} />
      <Text variant="caption" color={theme.colors.text3}>{post.reply_count ?? 0}</Text>
    </View>
  );

  const renderListCard = (post: ForumPost) => {
    const coverUri = resolveUrl(post.cover_image);
    const name = post.author_display_name || post.author_username;
    return (
      <Pressable key={post.id} haptic onPress={() => openPost(post)} onLongPress={() => handleLongPress(post)}
        style={[styles.listCard, cardFrame]}>
        {coverUri ? (
          <Image source={{ uri: coverUri }} style={[styles.thumb, { borderRadius: theme.radius.md, backgroundColor: theme.colors.bgElev2 }]} />
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="subtitle" style={styles.listTitle}>{post.name}</Text>
          {post.preview_content ? (
            <Text variant="bodySmall" color={theme.colors.text2} numberOfLines={2} style={styles.listPreview}>
              {post.preview_content}
            </Text>
          ) : null}
          <View style={styles.listFooter}>
            <View style={styles.author}>
              <Avatar username={post.author_username} uri={resolveUrl(post.author_avatar)} size={18} showStatus={false} />
              <Text variant="caption" color={theme.colors.text3} numberOfLines={1} style={{ flexShrink: 1 }}>{name}</Text>
              {post.author_account_type === 'bot' ? <BotBadge /> : null}
              <Text variant="caption" color={theme.colors.text3}>·</Text>
              <Text variant="caption" color={theme.colors.text3}>{formatMessageTimestamp(toMs(post.created_at))}</Text>
              {post.archived ? archivedPill(false) : null}
            </View>
            <View style={styles.stats}>
              {post.last_message_at ? (
                <Text variant="caption" color={theme.colors.text3}>{formatMessageTimestamp(toMs(post.last_message_at))}</Text>
              ) : null}
              {replyPill(post, true)}
            </View>
          </View>
        </View>
      </Pressable>
    );
  };

  const renderGalleryCard = (post: ForumPost) => {
    const coverUri = resolveUrl(post.cover_image);
    const name = post.author_display_name || post.author_username;
    return (
      <Pressable key={post.id} haptic onPress={() => openPost(post)} onLongPress={() => handleLongPress(post)}
        style={[styles.galleryCard, cardFrame, { width: galleryCardWidth }]}>
        <View style={[styles.galleryCover, { backgroundColor: theme.colors.bgElev2 }]}>
          {coverUri
            ? <Image source={{ uri: coverUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            : <ImageIcon size={32} color={theme.colors.text3} strokeWidth={1} style={{ opacity: 0.4 }} />}
          {post.archived ? <View style={styles.galleryArchived}>{archivedPill(true)}</View> : null}
        </View>
        <View style={styles.galleryBody}>
          <Text variant="subtitle" numberOfLines={2} style={styles.galleryTitle}>{post.name}</Text>
          {post.preview_content ? (
            <Text variant="caption" color={theme.colors.text2} numberOfLines={2} style={{ flex: 1 }}>{post.preview_content}</Text>
          ) : <View style={{ flex: 1 }} />}
          <View style={[styles.galleryFooter, { borderTopColor: theme.colors.lineSoft }]}>
            <View style={styles.author}>
              <Avatar username={post.author_username} uri={resolveUrl(post.author_avatar)} size={14} showStatus={false} />
              <Text variant="caption" color={theme.colors.text3} numberOfLines={1} style={{ flexShrink: 1, fontSize: 11 }}>{name}</Text>
            </View>
            {replyPill(post, false)}
          </View>
        </View>
      </Pressable>
    );
  };

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === 'archived') {
      const Chevron = showArchived ? ChevronDown : ChevronRight;
      return (
        <Pressable haptic onPress={() => setShowArchived((v) => !v)} style={styles.archivedToggle}>
          <Chevron size={14} color={theme.colors.text3} />
          <Text variant="bodySmall" color={theme.colors.text3}>{t('forum.archived', { count: archivedCount })}</Text>
        </Pressable>
      );
    }
    if (!gallery) return renderListCard(item.posts[0]);
    return <View style={styles.galleryRow}>{item.posts.map(renderGalleryCard)}</View>;
  };

  const segment = (mode: 'list' | 'gallery', Icon: typeof List, label: string) => {
    const on = userView === mode;
    return (
      <Pressable haptic onPress={() => setUserView(mode)} accessibilityLabel={label}
        style={[styles.segment, on && { backgroundColor: theme.colors.accentSoft }]}>
        <Icon size={14} color={on ? theme.colors.accent : theme.colors.text3} />
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setListWidth(e.nativeEvent.layout.width)}>
      <View style={styles.toolbar}>
        <View style={[styles.searchBox, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.line, borderRadius: theme.radius.md }]}>
          <Search size={15} color={theme.colors.text3} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t('forum.searchPlaceholder')}
            placeholderTextColor={theme.colors.text3}
            style={[styles.searchInput, { color: theme.colors.text }]}
            returnKeyType="search"
          />
        </View>
        {canCreatePost ? (
          <Pressable haptic onPress={() => setComposing(true)}
            style={[styles.newPostBtn, { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md }]}>
            <MessageSquare size={15} color={theme.colors.textOnAccent} fill={theme.colors.textOnAccent} />
            <Text variant="subtitle" color={theme.colors.textOnAccent} style={{ fontSize: 14 }}>{t('forum.newPost')}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.viewRow}>
        <Pressable haptic onPress={() => setSortOpen(true)}
          style={[styles.sortPill, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.line }]}>
          <SlidersHorizontal size={13} color={theme.colors.text3} />
          <Text variant="bodySmall" color={theme.colors.text3}>{t('forum.sortAndView')}</Text>
          <ChevronDown size={12} color={theme.colors.text3} />
        </Pressable>
        {layout === 'user_choice' ? (
          <View style={[styles.segmented, { backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.line }]}>
            {segment('list', List, t('forum.listView'))}
            <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: theme.colors.line }} />
            {segment('gallery', LayoutGrid, t('forum.galleryView'))}
          </View>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.accent} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          contentContainerStyle={{ paddingHorizontal: PADDING, paddingBottom: 24, gap: gallery ? GAP : 8 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshing={false}
          onRefresh={() => void load()}
          ListHeaderComponent={activeCount === 0 ? (
            <View style={styles.empty}>
              <Text variant="subtitle" style={{ textAlign: 'center' }}>
                {search.trim() ? t('forum.noMatches') : t('forum.emptyTitle')}
              </Text>
              {!search.trim() ? (
                <Text variant="bodySmall" color={theme.colors.text3} style={{ textAlign: 'center' }}>
                  {t('forum.emptyBody', { channel: channel.name })}
                </Text>
              ) : null}
            </View>
          ) : null}
        />
      )}

      <Sheet open={sortOpen} onClose={() => setSortOpen(false)} maxHeightFraction={0.5} maxWidth={420}>
        <Text variant="caption" color={theme.colors.text3} style={styles.sheetLabel}>{t('forum.sortBy')}</Text>
        {SORT_MODES.map((mode) => (
          <Pressable key={mode} haptic onPress={() => { setSortMode(mode); setSortOpen(false); }} style={styles.sheetOption}>
            <Text variant="body" color={sortMode === mode ? theme.colors.accent : theme.colors.text} style={{ flex: 1 }}>
              {t(`forum.sort.${mode}`)}
            </Text>
            {sortMode === mode ? <Check size={18} color={theme.colors.accent} /> : null}
          </Pressable>
        ))}
      </Sheet>

      <NewForumPostSheet
        open={composing}
        channelId={channel.id}
        serverUrl={serverUrl}
        onClose={() => setComposing(false)}
        onCreated={(postId, title) => {
          setComposing(false);
          void load();
          router.push({
            pathname: '/server/[serverId]/threads/[channelId]',
            params: { serverId, channelId: postId, parentChannelId: channel.id, title },
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: PADDING, paddingTop: 12, paddingBottom: 8 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, height: 38, borderWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
  newPostBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 38 },
  viewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: PADDING, paddingBottom: 12 },
  sortPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  segmented: { flexDirection: 'row', borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  segment: { paddingHorizontal: 10, paddingVertical: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 48, paddingHorizontal: 16 },
  listCard: { flexDirection: 'row', gap: 12, padding: 14, borderWidth: StyleSheet.hairlineWidth },
  thumb: { width: 64, height: 64 },
  listTitle: { fontSize: 16, lineHeight: 21, marginBottom: 4 },
  listPreview: { lineHeight: 19, marginBottom: 10 },
  listFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  author: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  replyPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  archivedPill: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  archivedPillText: { fontSize: 10, fontWeight: '600' },
  galleryRow: { flexDirection: 'row', gap: GAP },
  galleryCard: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  galleryCover: { aspectRatio: 16 / 9, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  galleryArchived: { position: 'absolute', top: 6, left: 6 },
  galleryBody: { flex: 1, padding: 10, gap: 4 },
  galleryTitle: { fontSize: 14, lineHeight: 18 },
  galleryFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginTop: 4, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth },
  archivedToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 12, paddingBottom: 4 },
  sheetLabel: { textTransform: 'uppercase', letterSpacing: 0.7, paddingHorizontal: 16, paddingBottom: 6 },
  sheetOption: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
});
