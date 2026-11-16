import {
  Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Archive, ArchiveRestore, ArrowRight, CalendarClock, Lock, MessageSquare, MoreHorizontal, Pencil, Plus, Settings2,
  SquareArrowOutUpRight, Tag, Trash2, X,
} from 'lucide-react';
import { createApi } from '../../lib/api';
import { useMarkChannelReadWhileOpen } from '../../hooks/useMarkChannelReadWhileOpen';
import {
  EMPTY_BOARD, apiErrorMessage, useWorkItemStore, workItemBasePath, workItemPath,
} from '../../stores/workItemStore';
import type { BoardCard, BoardList, Channel, WorkItemLabel } from '../../types';
import { ServerMentionProvider } from '../chat/mentions';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { EditableBody, EditableTitle, ItemFields, ItemTimeline } from './ItemDetail';
import { WorkChannelBackdrop } from './WorkChannelBackdrop';
import { WorkChannelSettingsModal } from './WorkChannelSettingsModal';
import { ConfirmHost } from './ConfirmHost';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { confirmAction } from './confirmAction';
import { LabelManagerModal } from './LabelManagerModal';
import { ListSettingsModal } from './ListSettingsModal';
import { AvatarStack, LabelChips, Popover } from './shared';
import {
  WORK_ITEM_LIMITS, fieldClass, patchItem, resolveRealmImage, useRealmUrl, useSelfUserId, useWorkItemPermissions,
  type WorkItemPermissions,
} from './workItemUtils';

type DragState =
  | { type: 'card'; id: string; height: number }
  | { type: 'list'; id: string; height: number };

interface CardDrop { listId: string; index: number }

/** The card being carried: a solid copy that follows the pointer. */
interface CardGhost { card: BoardCard; width: number }

const DRAG_THRESHOLD_PX = 5;
const LIST_WIDTH_PX = 288; // w-72
const COVER_MARGIN_PX = 16;
const EDGE_SCROLL_ZONE_PX = 56;
const EDGE_SCROLL_STEP_PX = 14;

function dueInfo(dueAt: number) {
  const date = new Date(dueAt * 1000);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return {
    text: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }),
    overdue: dueAt * 1000 < Date.now(),
  };
}

// Due dates are picked as a day; stored as the end of that local day.
function dueInputValue(dueAt: number | null) {
  if (!dueAt) return '';
  const date = new Date(dueAt * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dueFromInput(value: string): number | null {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  return Math.floor(new Date(year, month - 1, day, 23, 59, 59).getTime() / 1000);
}

/** A board channel: lists of cards that can be dragged between lists. */
export function BoardChannel({ channel }: { channel: Channel }) {
  const board = useWorkItemStore((s) => s.boards[channel.id]) ?? EMPTY_BOARD;
  const fetchBoard = useWorkItemStore((s) => s.fetchBoard);
  const perms = useWorkItemPermissions('board', channel);
  const { lists, cards, labels, settings } = board;
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [managingLabels, setManagingLabels] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [addingList, setAddingList] = useState(false);
  const [settingsListId, setSettingsListId] = useState<string | null>(null);
  const [cardMenu, setCardMenu] = useState<{ cardId: string; x: number; y: number } | null>(null);
  const [boardMenu, setBoardMenu] = useState<{ x: number; y: number } | null>(null);
  const closeBoardMenu = useCallback(() => setBoardMenu(null), []);
  const [showBoardSettings, setShowBoardSettings] = useState(false);
  const closeCardMenu = useCallback(() => setCardMenu(null), []);
  const selfId = useSelfUserId();
  const serverUrl = useRealmUrl();
  const [error, setError] = useState('');
  const [drag, setDrag] = useState<DragState | null>(null);
  const [cardDrop, setCardDrop] = useState<CardDrop | null>(null);
  const [listDropIndex, setListDropIndex] = useState<number | null>(null);
  const [ghost, setGhost] = useState<CardGhost | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const cancelCardDragRef = useRef<(() => void) | null>(null);
  // A drag ends with a pointerup on the card, which would otherwise count as a click and open it.
  const suppressClickRef = useRef(false);
  useMarkChannelReadWhileOpen(channel.id);

  useEffect(() => { void fetchBoard(channel.id); }, [channel.id, fetchBoard]);

  const cardsByList = useMemo(() => {
    const grouped = new Map<string, BoardCard[]>();
    for (const list of lists) grouped.set(list.id, []);
    for (const card of cards) grouped.get(card.list_id)?.push(card);
    for (const group of grouped.values()) group.sort((a, b) => a.position - b.position);
    return grouped;
  }, [lists, cards]);

  const endDrag = () => { setDrag(null); setCardDrop(null); setListDropIndex(null); };

  const fail = (err: unknown, fallback: string) => {
    setError(apiErrorMessage(err, fallback));
    void fetchBoard(channel.id);
  };

  const moveCard = async (cardId: string, listId: string, index: number) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    const store = useWorkItemStore.getState();
    const idsOf = (id: string) => (cardsByList.get(id) ?? []).map((c) => c.id).filter((id2) => id2 !== cardId);
    const target = idsOf(listId);
    target.splice(Math.min(index, target.length), 0, cardId);
    if (card.list_id === listId && (cardsByList.get(listId) ?? []).every((c, i) => c.id === target[i])) return;
    // Show the move immediately; the server's answer (the final order) replaces it.
    store.applyCardOrder(channel.id, [
      { listId, cardIds: target },
      ...(card.list_id !== listId ? [{ listId: card.list_id, cardIds: idsOf(card.list_id) }] : []),
    ]);
    try {
      const res = await createApi().put<{ lists: Array<{ listId: string; cardIds: string[] }> }>(
        `${workItemPath('board', channel.id, cardId)}/position`, { listId, index },
      );
      store.applyCardOrder(channel.id, res.data.lists);
      setError('');
    } catch (err) {
      fail(err, 'Failed to move card');
    }
  };

  // Right-click menu for a card: the same actions as its window, without opening it.
  const menuCard = cardMenu ? cards.find((card) => card.id === cardMenu.cardId) : undefined;
  const cardMenuEntries = (card: BoardCard): ContextMenuEntry[] => {
    const canEdit = perms.manage || (!!selfId && card.created_by === selfId);
    const entries: ContextMenuEntry[] = [
      { label: 'Open card', icon: <SquareArrowOutUpRight className="h-4 w-4" />, onSelect: () => setOpenCardId(card.id) },
    ];
    const otherLists = lists.filter((list) => list.id !== card.list_id);
    if (perms.create && otherLists.length > 0) {
      entries.push({ type: 'separator' }, { type: 'heading', label: 'Move to' });
      for (const list of otherLists) {
        entries.push({
          label: list.name,
          icon: <ArrowRight className="h-4 w-4" />,
          onSelect: () => void moveCard(card.id, list.id, Number.MAX_SAFE_INTEGER),
        });
      }
    }
    if (canEdit || perms.manage) entries.push({ type: 'separator' });
    if (canEdit) {
      entries.push({
        label: 'Archive card',
        icon: <Archive className="h-4 w-4" />,
        onSelect: () => { patchItem('board', card, { archived: true }).catch((err) => fail(err, 'Failed to archive card')); },
      });
    }
    if (perms.manage) {
      entries.push({
        label: 'Delete card',
        icon: <Trash2 className="h-4 w-4" />,
        danger: true,
        onSelect: () => {
          void (async () => {
            if (!(await confirmAction({ title: 'Delete card', message: `Delete the card "${card.title}"? This cannot be undone.` }))) return;
            try {
              await createApi().delete(workItemPath('board', channel.id, card.id));
              useWorkItemStore.getState().removeCard(channel.id, card.id);
            } catch (err) {
              fail(err, 'Failed to delete card');
            }
          })();
        },
      });
      entries.push(
        { type: 'separator' },
        { label: 'Board settings…', icon: <Settings2 className="h-4 w-4" />, onSelect: () => setShowBoardSettings(true) },
      );
    }
    return entries;
  };

  // Right-click on the board itself (not on a list or card).
  const boardMenuEntries: ContextMenuEntry[] = [
    ...(perms.manage ? [
      { label: 'Board settings…', icon: <Settings2 className="h-4 w-4" />, onSelect: () => setShowBoardSettings(true) },
      { label: 'Add a list', icon: <Plus className="h-4 w-4" />, onSelect: () => setAddingList(true) },
      { label: 'Edit labels…', icon: <Tag className="h-4 w-4" />, onSelect: () => setManagingLabels(true) },
      { type: 'separator' as const },
    ] : []),
    { label: 'Archived cards', icon: <Archive className="h-4 w-4" />, onSelect: () => setShowArchived(true) },
  ];

  const moveCardRef = useRef(moveCard);
  useEffect(() => { moveCardRef.current = moveCard; });
  useEffect(() => () => cancelCardDragRef.current?.(), []);

  // Cards are dragged with pointer events rather than native drag-and-drop: the browser's
  // drag image is always translucent and cannot be animated, and the held card should be
  // solid and wobble.
  const beginCardDrag = (card: BoardCard, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!perms.create || event.button !== 0 || cancelCardDragRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const grabX = event.clientX - rect.left;
    const grabY = event.clientY - rect.top;
    const start = { x: event.clientX, y: event.clientY };
    const pointer = { ...start };
    let active = false;
    let frame = 0;
    let drop: CardDrop | null = null;

    const tick = () => {
      frame = window.requestAnimationFrame(tick);
      if (ghostRef.current) {
        ghostRef.current.style.transform = `translate(${pointer.x - grabX}px, ${pointer.y - grabY}px)`;
      }
      // Scroll the lists row when the card is held near its left or right edge.
      const row = rowRef.current;
      if (row) {
        const bounds = row.getBoundingClientRect();
        if (pointer.x < bounds.left + EDGE_SCROLL_ZONE_PX) row.scrollLeft -= EDGE_SCROLL_STEP_PX;
        else if (pointer.x > bounds.right - EDGE_SCROLL_ZONE_PX) row.scrollLeft += EDGE_SCROLL_STEP_PX;
      }
      const column = document.elementFromPoint(pointer.x, pointer.y)?.closest<HTMLElement>('[data-list-id]');
      if (!column?.dataset.listId) return;
      // And the list under the pointer when the card is held near its top or bottom.
      const scroller = column.querySelector<HTMLElement>('[data-card-scroller]');
      if (scroller) {
        const bounds = scroller.getBoundingClientRect();
        if (pointer.y < bounds.top + EDGE_SCROLL_ZONE_PX / 2) scroller.scrollTop -= EDGE_SCROLL_STEP_PX;
        else if (pointer.y > bounds.bottom - EDGE_SCROLL_ZONE_PX / 2) scroller.scrollTop += EDGE_SCROLL_STEP_PX;
      }
      // Index among the list's other cards, by vertical midpoints — the index the server expects.
      const index = [...column.querySelectorAll<HTMLElement>('[data-card-id]')]
        .filter((el) => el.dataset.cardId !== card.id)
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return pointer.y > box.top + box.height / 2;
        }).length;
      if (drop?.listId !== column.dataset.listId || drop.index !== index) {
        drop = { listId: column.dataset.listId, index };
        setCardDrop(drop);
      }
    };

    const stop = () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('keydown', onKey, true);
      document.body.style.removeProperty('user-select');
      cancelCardDragRef.current = null;
      setGhost(null);
      endDrag();
    };
    const onMove = (moveEvent: PointerEvent) => {
      pointer.x = moveEvent.clientX;
      pointer.y = moveEvent.clientY;
      if (active || Math.hypot(pointer.x - start.x, pointer.y - start.y) < DRAG_THRESHOLD_PX) return;
      active = true;
      document.body.style.userSelect = 'none';
      setGhost({ card, width: rect.width });
      setDrag({ type: 'card', id: card.id, height: rect.height });
      frame = window.requestAnimationFrame(tick);
    };
    const onUp = () => {
      const target = active ? drop : null;
      if (active) {
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      }
      stop();
      if (target) void moveCardRef.current(card.id, target.listId, target.index);
    };
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape' || !active) return;
      keyEvent.stopPropagation();
      stop();
    };

    cancelCardDragRef.current = stop;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('keydown', onKey, true);
  };

  const moveList = async (listId: string, index: number) => {
    const ids = lists.map((list) => list.id).filter((id) => id !== listId);
    ids.splice(Math.min(index, ids.length), 0, listId);
    if (ids.every((id, i) => id === lists[i].id)) return;
    const store = useWorkItemStore.getState();
    store.setBoardLists(channel.id, ids.map((id, position) => ({ ...lists.find((list) => list.id === id)!, position })));
    try {
      const res = await createApi().put<BoardList[]>(`${workItemBasePath('board', channel.id)}/lists/order`, { listIds: ids });
      store.setBoardLists(channel.id, res.data);
      setError('');
    } catch (err) {
      fail(err, 'Failed to reorder lists');
    }
  };

  const moveListRef = useRef(moveList);
  useEffect(() => { moveListRef.current = moveList; });

  // Lists are dragged by their header the same way as cards. The carried copy is a clone of
  // the column's DOM, so it looks exactly like the list without rendering it twice.
  const beginListDrag = (list: BoardList, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!perms.manage || event.button !== 0 || cancelCardDragRef.current) return;
    if ((event.target as HTMLElement).closest('button, input')) return;
    const column = event.currentTarget.closest<HTMLElement>('[data-list-id]');
    if (!column) return;
    const rect = column.getBoundingClientRect();
    const grabX = event.clientX - rect.left;
    const grabY = event.clientY - rect.top;
    const start = { x: event.clientX, y: event.clientY };
    const pointer = { ...start };
    let carried: HTMLDivElement | null = null;
    let frame = 0;
    let dropIndex: number | null = null;

    const tick = () => {
      frame = window.requestAnimationFrame(tick);
      if (carried) carried.style.transform = `translate(${pointer.x - grabX}px, ${pointer.y - grabY}px)`;
      const row = rowRef.current;
      if (!row) return;
      const bounds = row.getBoundingClientRect();
      if (pointer.x < bounds.left + EDGE_SCROLL_ZONE_PX) row.scrollLeft -= EDGE_SCROLL_STEP_PX;
      else if (pointer.x > bounds.right - EDGE_SCROLL_ZONE_PX) row.scrollLeft += EDGE_SCROLL_STEP_PX;
      // Where the list would land, by the midpoints of the other lists.
      const index = [...row.querySelectorAll<HTMLElement>('[data-list-id]')]
        .filter((el) => el.dataset.listId !== list.id)
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return pointer.x > box.left + box.width / 2;
        }).length;
      if (index !== dropIndex) {
        dropIndex = index;
        setListDropIndex(index);
      }
    };

    const stop = () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('keydown', onKey, true);
      document.body.style.removeProperty('user-select');
      carried?.remove();
      cancelCardDragRef.current = null;
      endDrag();
    };
    const onMove = (moveEvent: PointerEvent) => {
      pointer.x = moveEvent.clientX;
      pointer.y = moveEvent.clientY;
      if (carried || Math.hypot(pointer.x - start.x, pointer.y - start.y) < DRAG_THRESHOLD_PX) return;
      document.body.style.userSelect = 'none';
      const copy = column.cloneNode(true) as HTMLElement;
      copy.removeAttribute('data-list-id');
      copy.querySelectorAll('[data-card-id]').forEach((el) => el.removeAttribute('data-card-id'));
      copy.style.height = `${rect.height}px`;
      const wobble = document.createElement('div');
      wobble.className = 'board-list-held rounded-lg shadow-2xl';
      wobble.append(copy);
      carried = document.createElement('div');
      carried.className = 'pointer-events-none fixed left-0 top-0 z-[60]';
      carried.style.width = `${rect.width}px`;
      carried.append(wobble);
      document.body.append(carried);
      setDrag({ type: 'list', id: list.id, height: rect.height });
      frame = window.requestAnimationFrame(tick);
    };
    const onUp = () => {
      const target = carried ? dropIndex : null;
      if (carried) {
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      }
      stop();
      if (target !== null) void moveListRef.current(list.id, target);
    };
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape' || !carried) return;
      keyEvent.stopPropagation();
      stop();
    };

    cancelCardDragRef.current = stop;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('keydown', onKey, true);
  };

  const otherLists = drag?.type === 'list' ? lists.filter((list) => list.id !== drag.id) : lists;
  const listPlaceholder = (
    <div
      className="w-72 shrink-0 rounded-lg border-2 border-dashed border-accent/50 bg-accent/5"
      style={{ height: drag?.type === 'list' ? drag.height : undefined }}
    />
  );
  const openCard = openCardId ? cards.find((card) => card.id === openCardId) : undefined;
  const settingsList = settingsListId ? lists.find((list) => list.id === settingsListId) : undefined;

  return (
    <ServerMentionProvider>
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-chat"
        onContextMenu={(event) => {
          // Lists and cards have their own menus; text fields keep the browser's.
          if ((event.target as HTMLElement).closest('[data-list-id], input, textarea')) return;
          event.preventDefault();
          setBoardMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <WorkChannelBackdrop background={settings.background} serverUrl={serverUrl} defaultImagePositionX={25} />
        <div className={`relative flex shrink-0 items-center gap-3 px-4 pb-2 pt-3 ${settings.background ? 'bg-black/25 backdrop-blur-sm' : ''}`}>
          <h2 className="min-w-0 truncate text-lg font-semibold text-text-primary">{settings.title || channel.name}</h2>
          {error && (
            <span className="flex items-center gap-1 rounded bg-danger/15 px-2 py-1 text-xs text-danger">
              {error}
              <button type="button" onClick={() => setError('')} aria-label="Dismiss"><X className="h-3 w-3" /></button>
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <span className={`text-sm ${settings.background ? 'text-text-secondary' : 'text-text-muted'}`}>
              {lists.length} {lists.length === 1 ? 'list' : 'lists'} · {cards.length} {cards.length === 1 ? 'card' : 'cards'}
            </span>
            <Button size="sm" variant="secondary" onClick={() => setShowArchived(true)} className="flex items-center gap-1.5">
              <Archive className="h-4 w-4" /> Archived
            </Button>
            {perms.manage && (
              <Button size="sm" variant="secondary" onClick={() => setManagingLabels(true)} className="flex items-center gap-1.5">
                <Tag className="h-4 w-4" /> Labels
              </Button>
            )}
          </span>
        </div>

        {board.error && <p className="px-4 py-10 text-center text-sm text-danger">{board.error}</p>}
        {!board.error && !board.loaded && <p className="px-4 py-10 text-center text-sm text-text-muted">Loading board…</p>}

        {board.loaded && !board.error && (
          <div
            ref={rowRef}
            className="relative flex min-h-0 flex-1 items-start gap-3 overflow-x-auto overflow-y-hidden px-4 pb-4 pt-3"
          >
            {lists.map((list) => {
              const slot = otherLists.findIndex((other) => other.id === list.id);
              return (
                <Fragment key={list.id}>
                  {drag?.type === 'list' && listDropIndex === slot && listPlaceholder}
                  <ListColumn
                    channel={channel}
                    list={list}
                    cards={cardsByList.get(list.id) ?? []}
                    labels={labels}
                    perms={perms}
                    drag={drag}
                    dropIndex={cardDrop?.listId === list.id ? cardDrop.index : null}
                    serverUrl={serverUrl}
                    onOpenSettings={() => setSettingsListId(list.id)}
                    onOpenBoardSettings={() => setShowBoardSettings(true)}
                    onListPointerDown={beginListDrag}
                    isClickSuppressed={() => suppressClickRef.current}
                    onCardPointerDown={beginCardDrag}
                    onOpenCard={(cardId) => { if (!suppressClickRef.current) setOpenCardId(cardId); }}
                    onCardContextMenu={(card, event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setCardMenu({ cardId: card.id, x: event.clientX, y: event.clientY });
                    }}
                    onError={fail}
                  />
                </Fragment>
              );
            })}
            {drag?.type === 'list' && listDropIndex === otherLists.length && listPlaceholder}

            {perms.manage && (addingList ? (
              <AddListForm channelId={channel.id} onClose={() => setAddingList(false)} />
            ) : (
              <button
                type="button"
                onClick={() => setAddingList(true)}
                className="flex w-72 shrink-0 items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-text-muted transition-colors hover:border-accent/60 hover:bg-bg-hover/40 hover:text-text-primary"
              >
                <Plus className="h-4 w-4" /> {lists.length === 0 ? 'Add a list' : 'Add another list'}
              </button>
            ))}
            {lists.length === 0 && !perms.manage && (
              <p className="w-full py-12 text-center text-sm text-text-muted">This board has no lists yet.</p>
            )}
          </div>
        )}
      </div>

      {ghost && (
        <div ref={ghostRef} className="pointer-events-none fixed left-0 top-0 z-[60]" style={{ width: ghost.width }}>
          <div className="board-card-held rounded-md shadow-2xl">
            <CardTile card={ghost.card} labels={labels} held />
          </div>
        </div>
      )}

      {openCardId && (
        <CardModal
          channel={channel}
          cardId={openCardId}
          fallback={openCard}
          lists={lists}
          labels={labels}
          perms={perms}
          onClose={() => setOpenCardId(null)}
          onMove={(listId) => void moveCard(openCardId, listId, Number.MAX_SAFE_INTEGER)}
          onManageLabels={perms.manage ? () => setManagingLabels(true) : undefined}
        />
      )}
      {settingsList && (
        <ListSettingsModal
          key={settingsList.id}
          channelId={channel.id}
          list={settingsList}
          serverUrl={serverUrl}
          onClose={() => setSettingsListId(null)}
        />
      )}
      <ArchivedCardsModal channel={channel} perms={perms} lists={lists} open={showArchived} onClose={() => setShowArchived(false)} />
      <LabelManagerModal kind="board" channelId={channel.id} labels={labels} open={managingLabels} onClose={() => setManagingLabels(false)} />
      {boardMenu && <ContextMenu x={boardMenu.x} y={boardMenu.y} entries={boardMenuEntries} onClose={closeBoardMenu} />}
      {showBoardSettings && (
        <WorkChannelSettingsModal
          kind="board"
          channelId={channel.id}
          channelName={channel.name}
          settings={settings}
          serverUrl={serverUrl}
          onClose={() => setShowBoardSettings(false)}
        />
      )}
      {cardMenu && menuCard && (
        <ContextMenu x={cardMenu.x} y={cardMenu.y} entries={cardMenuEntries(menuCard)} onClose={closeCardMenu} />
      )}
      <ConfirmHost />
    </ServerMentionProvider>
  );
}

function AddListForm({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const submit = async () => {
    if (!name.trim()) return;
    try {
      await createApi().post(`${workItemBasePath('board', channelId)}/lists`, { name: name.trim() });
      // The new list arrives through board:lists-updated; refetch covers a slow socket.
      void useWorkItemStore.getState().fetchBoard(channelId);
      setName('');
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to add list'));
    }
  };
  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="w-72 shrink-0 rounded-lg bg-bg-elevated p-2">
      <input
        autoFocus
        value={name}
        maxLength={WORK_ITEM_LIMITS.listName}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}
        placeholder="List name"
        className={fieldClass}
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      <div className="mt-2 flex items-center gap-2">
        <Button type="submit" size="sm" disabled={!name.trim()}>Add list</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Done</Button>
      </div>
    </form>
  );
}

function ListColumn({
  channel, list, cards, labels, perms, drag, dropIndex, serverUrl, onOpenSettings, onOpenBoardSettings,
  onListPointerDown, isClickSuppressed, onCardPointerDown, onOpenCard, onCardContextMenu, onError,
}: {
  channel: Channel;
  list: BoardList;
  cards: BoardCard[];
  labels: WorkItemLabel[];
  perms: WorkItemPermissions;
  drag: DragState | null;
  dropIndex: number | null;
  serverUrl: string | null;
  onOpenSettings: () => void;
  onOpenBoardSettings: () => void;
  onListPointerDown: (list: BoardList, event: ReactPointerEvent<HTMLDivElement>) => void;
  /** True for the click that ends a drag, so releasing a list does not start a rename. */
  isClickSuppressed: () => boolean;
  onCardPointerDown: (card: BoardCard, event: ReactPointerEvent<HTMLDivElement>) => void;
  onOpenCard: (cardId: string) => void;
  onCardContextMenu: (card: BoardCard, event: ReactMouseEvent<HTMLDivElement>) => void;
  onError: (error: unknown, fallback: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(list.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const base = workItemBasePath('board', channel.id);
  const draggingCard = drag?.type === 'card' ? drag : null;

  const rename = async () => {
    setRenaming(false);
    const next = name.trim();
    if (!next || next === list.name) { setName(list.name); return; }
    try {
      await createApi().patch(`${base}/lists/${list.id}`, { name: next });
      void useWorkItemStore.getState().fetchBoard(channel.id);
    } catch (err) {
      setName(list.name);
      onError(err, 'Failed to rename list');
    }
  };

  const [listMenu, setListMenu] = useState<{ x: number; y: number } | null>(null);
  const closeListMenu = useCallback(() => setListMenu(null), []);

  const remove = async () => {
    setMenuOpen(false);
    const warning = cards.length > 0 ? ` and its ${cards.length} ${cards.length === 1 ? 'card' : 'cards'}` : '';
    const confirmed = await confirmAction({
      title: 'Delete list',
      message: `Delete the list "${list.name}"${warning}? This cannot be undone.`,
    });
    if (!confirmed) return;
    try {
      await createApi().delete(`${base}/lists/${list.id}`);
      useWorkItemStore.getState().removeBoardList(channel.id, list.id);
    } catch (err) {
      onError(err, 'Failed to delete list');
    }
  };

  const addCard = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setNewTitle('');
    try {
      const res = await createApi().post<BoardCard>(workItemPath('board', channel.id), { listId: list.id, title });
      useWorkItemStore.getState().applyCard(res.data);
    } catch (err) {
      setNewTitle(title);
      onError(err, 'Failed to add card');
    }
  };

  const placeholder = draggingCard && (
    <div className="rounded-md border-2 border-dashed border-accent/50 bg-accent/5" style={{ height: draggingCard.height }} />
  );
  const otherCards = draggingCard ? cards.filter((card) => card.id !== draggingCard.id) : cards;

  // Right-click anywhere on the list that is not a card.
  const listMenuEntries: ContextMenuEntry[] = [
    ...(perms.create ? [{ label: 'Add a card', icon: <Plus className="h-4 w-4" />, onSelect: () => setAdding(true) }] : []),
    ...(perms.manage ? [
      { label: 'Rename list', icon: <Pencil className="h-4 w-4" />, onSelect: () => { setName(list.name); setRenaming(true); } },
      { label: 'List settings…', icon: <Settings2 className="h-4 w-4" />, onSelect: onOpenSettings },
      { label: 'Board settings…', icon: <Settings2 className="h-4 w-4" />, onSelect: onOpenBoardSettings },
      { type: 'separator' as const },
      { label: 'Delete list', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => void remove() },
    ] : []),
  ];

  return (
    <div
      data-list-id={list.id}
      onContextMenu={(event) => {
        // Text fields keep the browser's own menu (paste, spell-check).
        if ((event.target as HTMLElement).closest('input, textarea')) return;
        event.preventDefault();
        if (listMenuEntries.length > 0) setListMenu({ x: event.clientX, y: event.clientY });
      }}
      className={`flex max-h-full w-72 shrink-0 flex-col rounded-lg bg-bg-elevated ${drag?.type === 'list' && drag.id === list.id ? 'hidden' : ''}`}
      // A cover larger than the usual list width widens just this list to fit it.
      style={list.cover_image && list.cover_size && list.cover_size + COVER_MARGIN_PX > LIST_WIDTH_PX
        ? { width: list.cover_size + COVER_MARGIN_PX }
        : undefined}
    >
      {list.cover_image && (list.cover_size ? (
        // A chosen size: centred at that width, keeping the image's shape up to a square.
        <div className="flex shrink-0 justify-center pt-2">
          <img
            src={resolveRealmImage(list.cover_image, serverUrl)}
            alt=""
            draggable={false}
            className="h-auto select-none rounded-md object-cover"
            style={{ width: list.cover_size, maxHeight: list.cover_size }}
          />
        </div>
      ) : (
        // Fit to the list: the image's own shape, up to a square; only taller images are cropped.
        <img
          src={resolveRealmImage(list.cover_image, serverUrl)}
          alt=""
          draggable={false}
          className="h-auto max-h-72 w-full shrink-0 select-none rounded-t-lg object-cover"
        />
      ))}
      <div
        className={`relative flex shrink-0 select-none items-center gap-2 px-3 pb-1.5 pt-2.5 ${perms.manage && !renaming ? 'cursor-grab active:cursor-grabbing' : ''}`}
        onPointerDown={perms.manage && !renaming ? (event) => onListPointerDown(list, event) : undefined}
      >
        {renaming ? (
          <input
            autoFocus
            value={name}
            maxLength={WORK_ITEM_LIMITS.listName}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') { setName(list.name); setRenaming(false); }
            }}
            className={`${fieldClass} py-1 font-semibold`}
          />
        ) : (
          <>
          {list.icon && (
            <img
              src={resolveRealmImage(list.icon, serverUrl)}
              alt=""
              draggable={false}
              className="h-5 w-5 shrink-0 select-none rounded object-cover"
            />
          )}
          <h3
            className={`min-w-0 flex-1 truncate text-sm font-semibold text-text-primary ${perms.manage ? 'cursor-text' : ''}`}
            onClick={() => { if (perms.manage && !isClickSuppressed()) { setName(list.name); setRenaming(true); } }}
            title={perms.manage ? 'Click to rename' : list.name}
          >
            {list.name}
          </h3>
          {list.staff_only && (
            <span className="shrink-0 text-text-muted" title="Staff only — hidden from members without access">
              <Lock className="h-3.5 w-3.5" />
            </span>
          )}
          </>
        )}
        <span className="shrink-0 rounded-full bg-bg-hover px-1.5 text-xs text-text-muted">{cards.length}</span>
        {perms.manage && !renaming && (
          <>
            <button type="button" onClick={() => setMenuOpen((value) => !value)} className="shrink-0 rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary" title="List actions">
              <MoreHorizontal className="h-4 w-4" />
            </button>
            <Popover open={menuOpen} onClose={() => setMenuOpen(false)} align="right" className="right-2 w-44">
              <button type="button" onClick={() => { setMenuOpen(false); setName(list.name); setRenaming(true); }} className="w-full rounded px-2 py-1.5 text-left text-sm text-text-primary hover:bg-bg-hover">
                Rename list
              </button>
              <button type="button" onClick={() => { setMenuOpen(false); onOpenSettings(); }} className="w-full rounded px-2 py-1.5 text-left text-sm text-text-primary hover:bg-bg-hover">
                List settings…
              </button>
              <button type="button" onClick={() => void remove()} className="w-full rounded px-2 py-1.5 text-left text-sm text-danger hover:bg-danger/15">
                Delete list
              </button>
            </Popover>
          </>
        )}
      </div>

      <div data-card-scroller className="flex min-h-[8px] flex-1 flex-col gap-2 overflow-y-auto px-2 py-1">
        {cards.map((card) => {
          const slot = otherCards.findIndex((other) => other.id === card.id);
          return (
            <Fragment key={card.id}>
              {dropIndex !== null && dropIndex === slot && placeholder}
              <CardTile
                card={card}
                labels={labels}
                draggable={perms.create}
                hidden={draggingCard?.id === card.id}
                onOpen={() => onOpenCard(card.id)}
                onPointerDown={(event) => onCardPointerDown(card, event)}
                onContextMenu={(event) => onCardContextMenu(card, event)}
              />
            </Fragment>
          );
        })}
        {dropIndex !== null && dropIndex >= otherCards.length && placeholder}
      </div>

      {perms.create && (
        <div className="shrink-0 p-2">
          {adding ? (
            <form onSubmit={(event) => { event.preventDefault(); void addCard(); }}>
              <textarea
                autoFocus
                value={newTitle}
                maxLength={WORK_ITEM_LIMITS.title}
                onChange={(event) => setNewTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void addCard(); }
                  if (event.key === 'Escape') setAdding(false);
                }}
                rows={2}
                placeholder="Card title — Enter to add"
                className={`${fieldClass} resize-none`}
              />
              <div className="mt-1.5 flex items-center gap-2">
                <Button type="submit" size="sm" disabled={!newTitle.trim()}>Add card</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>Done</Button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
            >
              <Plus className="h-4 w-4" /> Add a card
            </button>
          )}
        </div>
      )}
      {listMenu && <ContextMenu x={listMenu.x} y={listMenu.y} entries={listMenuEntries} onClose={closeListMenu} />}
    </div>
  );
}

function CardTile({ card, labels, draggable = false, hidden = false, held = false, onOpen, onPointerDown, onContextMenu }: {
  card: BoardCard;
  labels: WorkItemLabel[];
  draggable?: boolean;
  hidden?: boolean;
  /** The copy carried under the pointer during a drag. */
  held?: boolean;
  onOpen?: () => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const due = card.due_at ? dueInfo(card.due_at) : null;
  const hasFooter = !!due || card.comment_count > 0 || card.assignees.length > 0;
  return (
    <div
      data-card-id={held ? undefined : card.id}
      role="button"
      tabIndex={held ? -1 : 0}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.key === 'Enter') onOpen?.(); }}
      onPointerDown={draggable ? onPointerDown : undefined}
      onContextMenu={onContextMenu}
      className={`shrink-0 select-none rounded-md border bg-bg-chat px-2.5 py-2 text-left transition-colors ${held ? 'cursor-grabbing border-accent/70' : 'cursor-pointer border-border shadow-sm hover:border-accent/60'} ${hidden ? 'hidden' : ''}`}
    >
      {card.label_ids.length > 0 && <div className="mb-1.5"><LabelChips labelIds={card.label_ids} labels={labels} compact /></div>}
      <p className="break-words text-sm text-text-primary">{card.title}</p>
      {hasFooter && (
        <div className="mt-2 flex items-center gap-3 text-xs text-text-muted">
          {due && (
            <span className={`flex items-center gap-1 rounded px-1 py-px ${due.overdue ? 'bg-danger/15 text-danger' : ''}`}>
              <CalendarClock className="h-3.5 w-3.5" /> {due.text}
            </span>
          )}
          {card.comment_count > 0 && (
            <span className="flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" /> {card.comment_count}</span>
          )}
          <span className="ml-auto"><AvatarStack users={card.assignees} size={18} /></span>
        </div>
      )}
    </div>
  );
}

function CardModal({ channel, cardId, fallback, lists, labels, perms, onClose, onMove, onManageLabels }: {
  channel: Channel;
  cardId: string;
  /** The board's copy, shown until the detail request returns. */
  fallback: BoardCard | undefined;
  lists: BoardList[];
  labels: WorkItemLabel[];
  perms: WorkItemPermissions;
  onClose: () => void;
  onMove: (listId: string) => void;
  onManageLabels?: () => void;
}) {
  const card = (useWorkItemStore((s) => s.openItems[cardId]) as BoardCard | undefined) ?? fallback;
  const detail = useWorkItemStore((s) => s.details[cardId]);
  const fetchDetail = useWorkItemStore((s) => s.fetchDetail);
  const closeDetail = useWorkItemStore((s) => s.closeDetail);
  const selfId = useSelfUserId();
  const [error, setError] = useState('');
  const updatedAt = card?.updated_at;
  const listId = card?.list_id;

  // Refetched when the card changes or moves so the activity timeline stays current.
  useEffect(() => {
    let cancelled = false;
    fetchDetail('board', channel.id, cardId)
      .then(() => { if (!cancelled) setError(''); })
      .catch((err) => { if (!cancelled) setError(apiErrorMessage(err, 'Failed to load card')); });
    return () => { cancelled = true; };
  }, [channel.id, cardId, updatedAt, listId, fetchDetail]);

  useEffect(() => () => closeDetail(cardId), [cardId, closeDetail]);

  if (!card) {
    return (
      <Modal open onClose={onClose} title="Card">
        <p className={`py-6 text-center text-sm ${error ? 'text-danger' : 'text-text-muted'}`}>
          {error ? `${error}. It may have been deleted.` : 'Loading card…'}
        </p>
      </Modal>
    );
  }

  const canEdit = perms.manage || (!!selfId && card.created_by === selfId);
  const guard = (action: Promise<unknown>, fallbackMessage: string) => action
    .then(() => setError(''))
    .catch((err) => setError(apiErrorMessage(err, fallbackMessage)));
  const remove = async () => {
    if (!(await confirmAction({ title: 'Delete card', message: `Delete the card "${card.title}"? This cannot be undone.` }))) return;
    try {
      await createApi().delete(workItemPath('board', channel.id, card.id));
      useWorkItemStore.getState().removeCard(channel.id, card.id);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to delete card'));
    }
  };
  const listName = lists.find((list) => list.id === card.list_id)?.name ?? 'a deleted list';

  return (
    <Modal open onClose={onClose} title={card.archived ? 'Archived card' : `Card in ${listName}`} className="max-w-4xl">
      <div className="flex flex-col gap-6 md:flex-row">
        <div className="min-w-0 flex-1">
          <EditableTitle title={card.title} canEdit={canEdit} onSave={(title) => patchItem('board', card, { title })} />
          <h4 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-text-muted">Description</h4>
          <div className="rounded-lg border border-border bg-bg-chat/40 px-3 py-2.5">
            <EditableBody body={card.body} canEdit={canEdit} onSave={(body) => patchItem('board', card, { body })} emptyText="No description yet." />
          </div>
          <h4 className="mb-1 mt-5 text-xs font-semibold uppercase tracking-wide text-text-muted">Activity</h4>
          <ItemTimeline key={card.id} kind="board" channel={channel} item={card} detail={detail} labels={labels} perms={perms} selfId={selfId} />
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>

        <aside className="w-full shrink-0 md:w-56">
          <ItemFields kind="board" item={card} labels={labels} perms={perms} canEdit={canEdit} onManageLabels={onManageLabels}>
            <section className="border-b border-border/60 pb-3">
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Due date</h4>
              {canEdit ? (
                <input
                  type="date"
                  value={dueInputValue(card.due_at)}
                  onChange={(event) => void guard(patchItem('board', card, { dueAt: dueFromInput(event.target.value) }), 'Failed to set due date')}
                  className={`${fieldClass} py-1.5`}
                />
              ) : (
                <p className="text-sm text-text-muted">{card.due_at ? dueInfo(card.due_at).text : 'None'}</p>
              )}
            </section>
            {!card.archived && perms.create && lists.length > 1 && (
              <section className="border-b border-border/60 pb-3">
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">List</h4>
                <select value={card.list_id} onChange={(event) => onMove(event.target.value)} className={`${fieldClass} py-1.5`}>
                  {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
                </select>
              </section>
            )}
            <div className="space-y-1">
              {canEdit && (
                <button
                  type="button"
                  onClick={() => void guard(patchItem('board', card, { archived: !card.archived }), 'Failed to update card')}
                  className="flex w-full items-center gap-2 rounded px-1 py-1 text-sm text-text-muted hover:text-text-primary"
                >
                  {card.archived ? <><ArchiveRestore className="h-4 w-4" /> Restore to board</> : <><Archive className="h-4 w-4" /> Archive card</>}
                </button>
              )}
              {perms.manage && (
                <button type="button" onClick={() => void remove()} className="flex w-full items-center gap-2 rounded px-1 py-1 text-sm text-text-muted hover:text-danger">
                  <Trash2 className="h-4 w-4" /> Delete card
                </button>
              )}
            </div>
          </ItemFields>
        </aside>
      </div>
    </Modal>
  );
}

function ArchivedCardsModal({ channel, perms, lists, open, onClose }: {
  channel: Channel;
  perms: WorkItemPermissions;
  lists: BoardList[];
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Archived cards">
      <ArchivedCardsList channel={channel} perms={perms} lists={lists} />
    </Modal>
  );
}

// Mounted only while the modal is open, so each opening loads a fresh list.
function ArchivedCardsList({ channel, perms, lists }: { channel: Channel; perms: WorkItemPermissions; lists: BoardList[] }) {
  const selfId = useSelfUserId();
  const [cards, setCards] = useState<BoardCard[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    createApi().get<{ cards: BoardCard[] }>(workItemBasePath('board', channel.id), { params: { archived: 1 } })
      .then((res) => { if (!cancelled) { setCards(res.data.cards); setError(''); } })
      .catch((err) => { if (!cancelled) setError(apiErrorMessage(err, 'Failed to load archived cards')); });
    return () => { cancelled = true; };
  }, [channel.id]);

  const drop = (id: string) => setCards((current) => current?.filter((card) => card.id !== id) ?? null);
  const restore = async (card: BoardCard) => {
    try {
      await patchItem('board', card, { archived: false });
      drop(card.id);
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to restore card'));
    }
  };
  const remove = async (card: BoardCard) => {
    if (!(await confirmAction({ title: 'Delete card', message: `Delete the card "${card.title}"? This cannot be undone.` }))) return;
    try {
      await createApi().delete(workItemPath('board', channel.id, card.id));
      drop(card.id);
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to delete card'));
    }
  };

  return (
    <>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      {!cards && !error && <p className="py-6 text-center text-sm text-text-muted">Loading…</p>}
      {cards?.length === 0 && <p className="py-6 text-center text-sm text-text-muted">No archived cards.</p>}
      <div className="divide-y divide-border/60">
        {cards?.map((card) => (
          <div key={card.id} className="flex items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-text-primary">{card.title}</p>
              <p className="text-xs text-text-muted">in {lists.find((list) => list.id === card.list_id)?.name ?? 'a deleted list'}</p>
            </div>
            {(perms.manage || (!!selfId && card.created_by === selfId)) && (
              <Button size="sm" variant="secondary" onClick={() => void restore(card)}>Restore</Button>
            )}
            {perms.manage && (
              <button type="button" onClick={() => void remove(card)} className="rounded p-1.5 text-text-muted hover:bg-danger/15 hover:text-danger" title="Delete card">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
