/**
 * BoardChannelView — a Board channel on mobile: lists paged horizontally, each
 * with its cards; tap a card for detail, long-press for Move / Archive / Delete.
 * Managers can add, rename, reorder and delete lists. Drag and drop is not
 * implemented on mobile; "Move to" and "Move up/down" cover reordering.
 *
 * Behavior reference: CatRealm-Client/src/components/workitems/BoardChannel.tsx.
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import {
  Archive, ArchiveRestore, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarClock, EllipsisVertical, Lock, MessageSquare,
  Pencil, Plus, SquareArrowOutUpRight, SquareKanban, Tag, Trash2, X,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from '../Text';
import { Pressable } from '../Pressable';
import { Sheet } from '../Sheet';
import { ActionMenuSheet, type ActionMenuItem } from '../ActionMenuSheet';
import { createApi } from '@/lib/api';
import {
  EMPTY_BOARD, apiErrorMessage, useWorkItemStore, workItemBasePath, workItemPath,
} from '@/stores/workItemStore';
import type { BoardCard, BoardList, Channel, WorkItemLabel } from '@/types';
import { ItemDetailModal } from './ItemDetailModal';
import { LabelManagerSheet } from './LabelManagerSheet';
import { AvatarStack, LabelChips } from './shared';
import { BACKDROP_BAR_COLOR, WorkChannelBackdrop } from './WorkChannelBackdrop';
import {
  WORK_ITEM_LIMITS, formatDueDate, isOverdue, patchItem, resolveRealmUrl, useSelfUserId, useWorkItemPermissions,
  type WorkItemPermissions,
} from './workItemUtils';

const EMPTY_CARDS: BoardCard[] = [];

const COLUMN_GAP = 10;
const SIDE_PADDING = 12;

function columnWidthFor(boardWidth: number) {
  return Math.round(Math.max(240, Math.min(boardWidth - SIDE_PADDING * 2 - 28, 320)));
}

type Menu =
  | { kind: 'card'; card: BoardCard }
  | { kind: 'list'; list: BoardList }
  | null;

interface Props {
  channel: Channel;
  serverUrl?: string | null;
}

export function BoardChannelView({ channel, serverUrl }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const board = useWorkItemStore((s) => s.boards[channel.id] ?? EMPTY_BOARD);
  const fetchBoard = useWorkItemStore((s) => s.fetchBoard);
  const perms = useWorkItemPermissions('board', channel);
  const selfId = useSelfUserId();
  const { lists, cards, labels, settings } = board;

  // Only the derived column width is state: the board's own width changes every frame while the
  // tablet members pane animates, and an unchanged number makes React skip the re-render.
  const [columnWidth, setColumnWidth] = useState(0);
  const [boardHeight, setBoardHeight] = useState(0);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // "Move to list" picks from a second sheet: a sheet cannot reopen from its own close callback.
  const [moveTarget, setMoveTarget] = useState<BoardCard | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [listEditor, setListEditor] = useState<{ mode: 'add' } | { mode: 'rename'; list: BoardList } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [managingLabels, setManagingLabels] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { void fetchBoard(channel.id); }, [channel.id, fetchBoard]);

  const cardsByList = useMemo(() => {
    const grouped = new Map<string, BoardCard[]>();
    for (const list of lists) grouped.set(list.id, []);
    for (const card of cards) grouped.get(card.list_id)?.push(card);
    for (const group of grouped.values()) group.sort((a, b) => a.position - b.position);
    return grouped;
  }, [lists, cards]);

  const fail = useCallback((err: unknown, fallback: string) => {
    setError(apiErrorMessage(err, fallback));
    void fetchBoard(channel.id);
  }, [channel.id, fetchBoard]);

  const moveCard = useCallback(async (cardId: string, listId: string, index: number) => {
    const store = useWorkItemStore.getState();
    const current = store.boards[channel.id] ?? EMPTY_BOARD;
    const card = current.cards.find((c) => c.id === cardId);
    if (!card) return;
    const idsOf = (id: string) => current.cards
      .filter((c) => c.list_id === id && c.id !== cardId)
      .sort((a, b) => a.position - b.position)
      .map((c) => c.id);
    const target = idsOf(listId);
    target.splice(Math.max(0, Math.min(index, target.length)), 0, cardId);
    // Show the move immediately; the server's answer (the final order) replaces it.
    store.applyCardOrder(channel.id, [
      { listId, cardIds: target },
      ...(card.list_id !== listId ? [{ listId: card.list_id, cardIds: idsOf(card.list_id) }] : []),
    ]);
    try {
      const res = await createApi().put<{ lists: Array<{ listId: string; cardIds: string[] }> }>(
        `${workItemPath('board', channel.id, cardId)}/position`, { listId, index },
      );
      useWorkItemStore.getState().applyCardOrder(channel.id, res.data.lists);
      setError('');
    } catch (err) {
      fail(err, t('work.moveFailed'));
    }
  }, [channel.id, fail, t]);

  const moveList = async (list: BoardList, delta: number) => {
    const ids = lists.map((l) => l.id);
    const from = ids.indexOf(list.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(to, 0, list.id);
    const store = useWorkItemStore.getState();
    store.setBoardLists(channel.id, ids.map((id, position) => ({ ...lists.find((l) => l.id === id)!, position })));
    try {
      const res = await createApi().put<BoardList[]>(`${workItemBasePath('board', channel.id)}/lists/order`, { listIds: ids });
      if (Array.isArray(res.data)) useWorkItemStore.getState().setBoardLists(channel.id, res.data);
      setError('');
    } catch (err) {
      fail(err, t('work.actionFailed'));
    }
  };

  const deleteCard = (card: BoardCard) => {
    Alert.alert(t('work.deleteCard'), t('work.deleteCardConfirm', { title: card.title }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          createApi().delete(workItemPath('board', channel.id, card.id))
            .then(() => useWorkItemStore.getState().removeCard(channel.id, card.id))
            .catch((err) => fail(err, t('work.actionFailed')));
        },
      },
    ]);
  };

  const deleteList = (list: BoardList) => {
    Alert.alert(t('work.deleteList'), t('work.deleteListConfirm', { name: list.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          createApi().delete(`${workItemBasePath('board', channel.id)}/lists/${list.id}`)
            .then(() => useWorkItemStore.getState().removeBoardList(channel.id, list.id))
            .catch((err) => fail(err, t('work.actionFailed')));
        },
      },
    ]);
  };

  const openMenu = useCallback((next: Exclude<Menu, null>) => { setMenu(next); setMenuOpen(true); }, []);
  const openCard = useCallback((id: string) => setOpenCardId(id), []);
  const onCardLongPress = useCallback((card: BoardCard) => openMenu({ kind: 'card', card }), [openMenu]);

  const menuItems = (): ActionMenuItem[] => {
    if (!menu) return [];
    if (menu.kind === 'card') {
      const card = menu.card;
      const canEdit = perms.manage || (!!selfId && card.created_by === selfId);
      const siblings = cardsByList.get(card.list_id) ?? EMPTY_CARDS;
      const index = siblings.findIndex((c) => c.id === card.id);
      const items: ActionMenuItem[] = [
        { key: 'open', label: t('work.openCard'), icon: SquareArrowOutUpRight, onPress: () => setOpenCardId(card.id) },
      ];
      if (perms.create) {
        if (lists.length > 1) items.push({ key: 'move', label: t('work.moveToList'), icon: ArrowRight, onPress: () => { setMoveTarget(card); setMoveOpen(true); } });
        if (index > 0) items.push({ key: 'up', label: t('work.moveUp'), icon: ArrowUp, onPress: () => void moveCard(card.id, card.list_id, index - 1) });
        if (index >= 0 && index < siblings.length - 1) {
          items.push({ key: 'down', label: t('work.moveDown'), icon: ArrowDown, onPress: () => void moveCard(card.id, card.list_id, index + 1) });
        }
      }
      if (canEdit) {
        items.push({
          key: 'archive',
          label: t('work.archiveCard'),
          icon: Archive,
          onPress: () => { patchItem('board', card, { archived: true }).catch((err) => fail(err, t('work.actionFailed'))); },
        });
      }
      if (perms.manage) items.push({ key: 'delete', label: t('work.deleteCard'), icon: Trash2, onPress: () => deleteCard(card) });
      return items;
    }
    const list = menu.list;
    const index = lists.findIndex((l) => l.id === list.id);
    const items: ActionMenuItem[] = [
      { key: 'rename', label: t('work.renameList'), icon: Pencil, onPress: () => setListEditor({ mode: 'rename', list }) },
    ];
    if (index > 0) items.push({ key: 'left', label: t('work.moveListLeft'), icon: ArrowLeft, onPress: () => void moveList(list, -1) });
    if (index >= 0 && index < lists.length - 1) items.push({ key: 'right', label: t('work.moveListRight'), icon: ArrowRight, onPress: () => void moveList(list, 1) });
    items.push({ key: 'delete', label: t('work.deleteList'), icon: Trash2, onPress: () => deleteList(list) });
    return items;
  };

  const columns: Array<BoardList | 'add'> = perms.manage ? [...lists, 'add'] : lists;

  const renderColumn = ({ item }: { item: BoardList | 'add' }) => {
    if (item === 'add') {
      return (
        <Pressable haptic onPress={() => setListEditor({ mode: 'add' })} accessibilityRole="button"
          style={[styles.addList, { width: columnWidth, borderColor: theme.colors.line, borderRadius: theme.radius.lg }]}>
          <Plus size={16} color={theme.colors.text2} />
          <Text variant="body" color={theme.colors.text2}>{t('work.addList')}</Text>
        </Pressable>
      );
    }
    return (
      <ListColumn
        channel={channel}
        list={item}
        cards={cardsByList.get(item.id) ?? EMPTY_CARDS}
        labels={labels}
        perms={perms}
        width={columnWidth}
        maxHeight={boardHeight > 0 ? boardHeight - 12 : undefined}
        serverUrl={serverUrl}
        onOpenCard={openCard}
        onCardLongPress={onCardLongPress}
        onListMenu={perms.manage ? (list) => openMenu({ kind: 'list', list }) : undefined}
        onError={setError}
      />
    );
  };

  const openFallback = openCardId ? cards.find((card) => card.id === openCardId) : undefined;

  return (
    <View style={{ flex: 1, overflow: 'hidden' }} onLayout={(e) => setColumnWidth(columnWidthFor(e.nativeEvent.layout.width))}>
      <WorkChannelBackdrop background={settings.background} serverUrl={serverUrl} defaultImagePositionX={25} />
      {/* With a background, the header sits on a translucent bar so it stays readable. */}
      <View style={[styles.topBar, settings.background ? { backgroundColor: BACKDROP_BAR_COLOR, marginBottom: 10 } : null]}>
        <Text variant="subtitle" numberOfLines={1} style={{ flex: 1 }}>{settings.title || channel.name}</Text>
        {perms.manage ? (
          <Pressable haptic onPress={() => setManagingLabels(true)} accessibilityRole="button"
            style={[styles.topBtn, { borderColor: theme.colors.line, backgroundColor: theme.colors.bgElev1 }]}>
            <Tag size={14} color={theme.colors.text3} />
            <Text variant="bodySmall" color={theme.colors.text3}>{t('work.labelsTitle')}</Text>
          </Pressable>
        ) : null}
        <Pressable haptic onPress={() => setShowArchived(true)} accessibilityRole="button"
          style={[styles.topBtn, { borderColor: theme.colors.line, backgroundColor: theme.colors.bgElev1 }]}>
          <Archive size={14} color={theme.colors.text3} />
          <Text variant="bodySmall" color={theme.colors.text3}>{t('work.archivedCards')}</Text>
        </Pressable>
      </View>
      {error ? (
        <Pressable onPress={() => setError('')} style={[styles.errorBar, { backgroundColor: theme.colors.danger + '22' }]}>
          <Text variant="bodySmall" color={theme.colors.danger} style={{ flex: 1 }}>{error}</Text>
          <X size={14} color={theme.colors.danger} />
        </Pressable>
      ) : null}

      {!board.loaded ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.accent} /></View>
      ) : board.error && lists.length === 0 ? (
        <View style={styles.center}><Text variant="bodySmall" color={theme.colors.danger} style={{ textAlign: 'center' }}>{board.error}</Text></View>
      ) : lists.length === 0 && !perms.manage ? (
        <View style={styles.center}>
          <SquareKanban size={30} color={theme.colors.text3} />
          <Text variant="subtitle" style={{ textAlign: 'center' }}>{t('work.noLists')}</Text>
        </View>
      ) : columnWidth > 0 ? (
        <FlatList
          horizontal
          style={{ flex: 1 }}
          onLayout={(e) => setBoardHeight(e.nativeEvent.layout.height)}
          data={columns}
          keyExtractor={(item) => (item === 'add' ? '__add' : item.id)}
          renderItem={renderColumn}
          snapToInterval={columnWidth + COLUMN_GAP}
          snapToAlignment="start"
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          windowSize={5}
          initialNumToRender={3}
          contentContainerStyle={{ paddingHorizontal: SIDE_PADDING, paddingBottom: 12, gap: COLUMN_GAP }}
          keyboardShouldPersistTaps="handled"
        />
      ) : null}

      <ActionMenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={menu?.kind === 'list' ? menu.list.name : menu?.card.title}
        items={menuItems()}
      />

      <ActionMenuSheet
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title={t('work.moveToList')}
        items={moveTarget ? lists
          .filter((list) => list.id !== moveTarget.list_id)
          .map((list) => ({
            key: list.id,
            label: list.name,
            icon: ArrowRight,
            onPress: () => void moveCard(moveTarget.id, list.id, Number.MAX_SAFE_INTEGER),
          })) : []}
      />

      <LabelManagerSheet kind="board" channelId={channel.id} labels={labels} open={managingLabels} onClose={() => setManagingLabels(false)} />

      <ListNameSheet
        channelId={channel.id}
        editor={listEditor}
        onClose={() => setListEditor(null)}
        onError={(err) => fail(err, t('work.actionFailed'))}
      />

      <ArchivedCardsSheet
        open={showArchived}
        channel={channel}
        perms={perms}
        selfId={selfId}
        lists={lists}
        onClose={() => setShowArchived(false)}
      />

      {openCardId ? (
        <ItemDetailModal
          kind="board"
          channel={channel}
          itemId={openCardId}
          fallback={openFallback}
          labels={labels}
          perms={perms}
          selfId={selfId}
          serverUrl={serverUrl}
          onClose={() => setOpenCardId(null)}
          onMoveToList={(card, listId) => void moveCard(card.id, listId, Number.MAX_SAFE_INTEGER)}
        />
      ) : null}
    </View>
  );
}

function ListColumn({
  channel, list, cards, labels, perms, width, maxHeight, serverUrl, onOpenCard, onCardLongPress, onListMenu, onError,
}: {
  channel: Channel;
  list: BoardList;
  cards: BoardCard[];
  labels: WorkItemLabel[];
  perms: WorkItemPermissions;
  width: number;
  /** Cards scroll inside the column once it reaches the board's height. */
  maxHeight?: number;
  serverUrl?: string | null;
  onOpenCard: (id: string) => void;
  onCardLongPress: (card: BoardCard) => void;
  onListMenu?: (list: BoardList) => void;
  onError: (message: string) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const cover = resolveRealmUrl(list.cover_image, serverUrl);
  const icon = resolveRealmUrl(list.icon, serverUrl);

  const addCard = async () => {
    const next = title.trim();
    if (!next || saving) return;
    setSaving(true);
    try {
      const res = await createApi().post<BoardCard>(workItemPath('board', channel.id), { listId: list.id, title: next });
      useWorkItemStore.getState().applyCard(res.data);
      setTitle('');
      onError('');
    } catch (err) {
      onError(apiErrorMessage(err, t('work.createCardFailed')));
    } finally {
      setSaving(false);
    }
  };

  const renderCard = useCallback(({ item }: { item: BoardCard }) => (
    <CardTile card={item} labels={labels} serverUrl={serverUrl} onOpen={onOpenCard} onLongPress={onCardLongPress} />
  ), [labels, serverUrl, onOpenCard, onCardLongPress]);

  return (
    <View style={[styles.column, { width, maxHeight, backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.line, borderRadius: theme.radius.lg }]}>
      {cover ? (
        <Image source={{ uri: cover }} style={[styles.cover, { borderTopLeftRadius: theme.radius.lg, borderTopRightRadius: theme.radius.lg }]} resizeMode="cover" />
      ) : null}
      <View style={styles.columnHeader}>
        {icon ? <Image source={{ uri: icon }} style={styles.listIcon} /> : null}
        <Text variant="subtitle" numberOfLines={1} style={{ flexShrink: 1, fontSize: 15 }}>{list.name}</Text>
        {list.staff_only ? <Lock size={12} color={theme.colors.text3} accessibilityLabel={t('work.staffOnly')} /> : null}
        <Text variant="caption" color={theme.colors.text3}>{cards.length}</Text>
        <View style={{ flex: 1 }} />
        {onListMenu ? (
          <Pressable haptic onPress={() => onListMenu(list)} style={styles.iconHit} accessibilityRole="button" accessibilityLabel={t('work.listOptions')}>
            <EllipsisVertical size={16} color={theme.colors.text3} />
          </Pressable>
        ) : null}
      </View>
      <FlatList
        data={cards}
        keyExtractor={(card) => card.id}
        renderItem={renderCard}
        windowSize={5}
        initialNumToRender={8}
        nestedScrollEnabled
        style={{ flexGrow: 0, flexShrink: 1 }}
        contentContainerStyle={{ paddingHorizontal: 8, gap: 6, paddingBottom: 4 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text variant="caption" color={theme.colors.text3} style={styles.emptyList}>{t('work.emptyList')}</Text>}
      />
      {perms.create ? (
        adding ? (
          <View style={styles.addForm}>
            <TextInput
              autoFocus
              value={title}
              onChangeText={setTitle}
              placeholder={t('work.cardTitlePlaceholder')}
              placeholderTextColor={theme.colors.text3}
              maxLength={WORK_ITEM_LIMITS.title}
              returnKeyType="done"
              blurOnSubmit={false}
              onSubmitEditing={() => void addCard()}
              style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgApp, borderColor: theme.colors.line, borderRadius: theme.radius.md }]}
            />
            <View style={styles.addActions}>
              <Pressable haptic onPress={() => { setAdding(false); setTitle(''); }} style={styles.smallBtnGhost}>
                <Text variant="bodySmall" color={theme.colors.text2}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable haptic disabled={saving || !title.trim()} onPress={() => void addCard()}
                style={[styles.smallBtn, { backgroundColor: theme.colors.accent, opacity: title.trim() ? 1 : 0.5 }]}>
                {saving ? <ActivityIndicator size="small" color={theme.colors.textOnAccent} /> : <Text variant="bodySmall" color={theme.colors.textOnAccent}>{t('work.add')}</Text>}
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable haptic onPress={() => setAdding(true)} style={styles.addCardBtn} accessibilityRole="button">
            <Plus size={15} color={theme.colors.text3} />
            <Text variant="bodySmall" color={theme.colors.text3}>{t('work.addCard')}</Text>
          </Pressable>
        )
      ) : <View style={{ height: 8 }} />}
    </View>
  );
}

const CardTile = memo(function CardTile({ card, labels, serverUrl, onOpen, onLongPress }: {
  card: BoardCard;
  labels: WorkItemLabel[];
  serverUrl?: string | null;
  onOpen: (id: string) => void;
  onLongPress: (card: BoardCard) => void;
}) {
  const theme = useTheme();
  const overdue = isOverdue(card.due_at);
  const hasFooter = !!card.due_at || card.comment_count > 0 || card.assignees.length > 0;
  return (
    <Pressable
      haptic
      onPress={() => onOpen(card.id)}
      onLongPress={() => onLongPress(card)}
      delayLongPress={350}
      accessibilityRole="button"
      style={[styles.card, { backgroundColor: theme.colors.bgApp, borderColor: theme.colors.line, borderRadius: theme.radius.md }]}
    >
      {card.label_ids.length > 0 ? <LabelChips labelIds={card.label_ids} labels={labels} compact /> : null}
      <Text variant="body" style={{ fontSize: 14 }}>{card.title}</Text>
      {hasFooter ? (
        <View style={styles.cardFooter}>
          {card.due_at ? (
            <View style={[styles.due, overdue && { backgroundColor: theme.colors.danger + '26' }]}>
              <CalendarClock size={12} color={overdue ? theme.colors.danger : theme.colors.text3} />
              <Text variant="caption" color={overdue ? theme.colors.danger : theme.colors.text3}>{formatDueDate(card.due_at)}</Text>
            </View>
          ) : null}
          {card.comment_count > 0 ? (
            <View style={styles.due}>
              <MessageSquare size={12} color={theme.colors.text3} />
              <Text variant="caption" color={theme.colors.text3}>{card.comment_count}</Text>
            </View>
          ) : null}
          <View style={{ flex: 1 }} />
          <AvatarStack users={card.assignees} size={18} serverUrl={serverUrl} />
        </View>
      ) : null}
    </Pressable>
  );
});

function ListNameSheet({ channelId, editor, onClose, onError }: {
  channelId: string;
  editor: { mode: 'add' } | { mode: 'rename'; list: BoardList } | null;
  onClose: () => void;
  onError: (err: unknown) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(editor?.mode === 'rename' ? editor.list.name : '');
  }, [editor]);

  const save = async () => {
    const next = name.trim();
    if (!next || !editor || saving) return;
    setSaving(true);
    try {
      const base = workItemBasePath('board', channelId);
      if (editor.mode === 'add') await createApi().post(`${base}/lists`, { name: next });
      else if (next !== editor.list.name) await createApi().patch(`${base}/lists/${editor.list.id}`, { name: next });
      // board:lists-updated brings the change back to every client, this one included.
      onClose();
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={!!editor} onClose={saving ? () => {} : onClose} maxHeightFraction={0.4} avoidKeyboard maxWidth={480}>
      <View style={styles.sheetBody}>
        <Text variant="title">{editor?.mode === 'rename' ? t('work.renameList') : t('work.addList')}</Text>
        <TextInput
          autoFocus
          value={name}
          onChangeText={setName}
          placeholder={t('work.listNamePlaceholder')}
          placeholderTextColor={theme.colors.text3}
          maxLength={WORK_ITEM_LIMITS.listName}
          returnKeyType="done"
          onSubmitEditing={() => void save()}
          style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgElev1, borderColor: theme.colors.line, borderRadius: theme.radius.md }]}
        />
        <View style={styles.addActions}>
          <Pressable haptic onPress={onClose} style={styles.smallBtnGhost}>
            <Text variant="bodySmall" color={theme.colors.text2}>{t('common.cancel')}</Text>
          </Pressable>
          <Pressable haptic disabled={saving || !name.trim()} onPress={() => void save()}
            style={[styles.smallBtn, { backgroundColor: theme.colors.accent, opacity: name.trim() ? 1 : 0.5 }]}>
            {saving ? <ActivityIndicator size="small" color={theme.colors.textOnAccent} /> : <Text variant="bodySmall" color={theme.colors.textOnAccent}>{t('common.save')}</Text>}
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

function ArchivedCardsSheet({ open, channel, perms, selfId, lists, onClose }: {
  open: boolean;
  channel: Channel;
  perms: WorkItemPermissions;
  selfId: string | null;
  lists: BoardList[];
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [cards, setCards] = useState<BoardCard[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) { setCards(null); setError(''); return; }
    let cancelled = false;
    createApi().get<{ cards: BoardCard[] }>(workItemBasePath('board', channel.id), { params: { archived: 1 } })
      .then((res) => { if (!cancelled) setCards(Array.isArray(res.data?.cards) ? res.data.cards : []); })
      .catch((err) => { if (!cancelled) setError(apiErrorMessage(err, t('work.loadFailed'))); });
    return () => { cancelled = true; };
  }, [open, channel.id, t]);

  const restore = async (card: BoardCard) => {
    try {
      await patchItem('board', card, { archived: false });
      setCards((prev) => prev?.filter((c) => c.id !== card.id) ?? null);
    } catch (err) {
      setError(apiErrorMessage(err, t('work.actionFailed')));
    }
  };

  const remove = (card: BoardCard) => {
    Alert.alert(t('work.deleteCard'), t('work.deleteCardConfirm', { title: card.title }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          createApi().delete(workItemPath('board', channel.id, card.id))
            .then(() => setCards((prev) => prev?.filter((c) => c.id !== card.id) ?? null))
            .catch((err) => setError(apiErrorMessage(err, t('work.actionFailed'))));
        },
      },
    ]);
  };

  return (
    <Sheet open={open} onClose={onClose} maxHeightFraction={0.75} maxWidth={520}>
      <Text variant="title" style={{ paddingHorizontal: 16, paddingBottom: 8 }}>{t('work.archivedCards')}</Text>
      <ScrollView contentContainerStyle={styles.sheetBody}>
        {error ? <Text variant="bodySmall" color={theme.colors.danger}>{error}</Text> : null}
        {cards === null && !error ? <ActivityIndicator color={theme.colors.accent} /> : null}
        {cards?.length === 0 ? <Text variant="bodySmall" color={theme.colors.text3} style={{ textAlign: 'center', paddingVertical: 16 }}>{t('work.noArchivedCards')}</Text> : null}
        {cards?.map((card) => (
          <View key={card.id} style={[styles.archivedRow, { borderColor: theme.colors.line, backgroundColor: theme.colors.bgElev1, borderRadius: theme.radius.md }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="body" numberOfLines={2}>{card.title}</Text>
              <Text variant="caption" color={theme.colors.text3} numberOfLines={1}>
                {lists.find((l) => l.id === card.list_id)?.name ?? t('work.deletedList')}
              </Text>
            </View>
            {(perms.manage || (!!selfId && card.created_by === selfId)) ? (
              <Pressable haptic onPress={() => void restore(card)} style={styles.iconHit} accessibilityRole="button" accessibilityLabel={t('work.restoreCard')}>
                <ArchiveRestore size={17} color={theme.colors.text2} />
              </Pressable>
            ) : null}
            {perms.manage ? (
              <Pressable haptic onPress={() => remove(card)} style={styles.iconHit} accessibilityRole="button" accessibilityLabel={t('work.deleteCard')}>
                <Trash2 size={17} color={theme.colors.danger} />
              </Pressable>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: SIDE_PADDING, paddingTop: 12, paddingBottom: 10 },
  topBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 34, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  errorBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: SIDE_PADDING, marginBottom: 8, padding: 10, borderRadius: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32 },
  column: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', alignSelf: 'flex-start' },
  cover: { width: '100%', height: 72 },
  columnHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 4, minHeight: 44 },
  listIcon: { width: 18, height: 18, borderRadius: 4 },
  iconHit: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  emptyList: { textAlign: 'center', paddingVertical: 12 },
  // Pressable centres its children by default; card content reads from the left.
  card: { padding: 10, gap: 6, borderWidth: StyleSheet.hairlineWidth, alignItems: 'stretch', justifyContent: 'center' },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  due: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 },
  addCardBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 6, paddingHorizontal: 12, minHeight: 44 },
  addForm: { padding: 8, gap: 8 },
  addActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  input: { paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, borderWidth: StyleSheet.hairlineWidth },
  smallBtn: { paddingHorizontal: 14, minHeight: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center', minWidth: 60 },
  smallBtnGhost: { paddingHorizontal: 12, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  addList: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 52, borderWidth: 1, borderStyle: 'dashed' },
  sheetBody: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  archivedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 12, paddingVertical: 6, borderWidth: StyleSheet.hairlineWidth },
});
