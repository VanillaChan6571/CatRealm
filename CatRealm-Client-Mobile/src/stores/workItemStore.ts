/**
 * workItemStore — Tracker (issues) and Board (cards) channels.
 *
 * Ported from CatRealm-Client/src/stores/workItemStore.ts. Both are "work items"
 * on the realm server and share labels, assignees, comments and a timeline.
 * Socket appliers are called from useSocket; views fetch on mount.
 */

import { create } from 'zustand';
import { createApi } from '@/lib/api';
import { captureAccountSession } from '@/lib/accountSession';
import type {
  BoardCard, BoardList, BoardSettings, TrackerIssue, TrackerSettings, WorkItemComment, WorkItemDetail, WorkItemLabel,
} from '@/types';

export type WorkKind = 'tracker' | 'board';
export type WorkItem = TrackerIssue | BoardCard;

export interface TrackerFilter {
  state: 'active' | TrackerIssue['state'] | 'all';
  label: string;
  assignee: string;
  author: string;
  q: string;
}

export interface TrackerChannelState {
  issues: TrackerIssue[];
  counts: Record<TrackerIssue['state'], number>;
  hasMore: boolean;
  labels: WorkItemLabel[];
  settings: TrackerSettings;
  filter: TrackerFilter;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** Bumped when a socket event changed something the loaded page cannot show; the view refetches. */
  refreshNonce: number;
}

export interface BoardChannelState {
  lists: BoardList[];
  cards: BoardCard[];
  labels: WorkItemLabel[];
  settings: BoardSettings;
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

export const DEFAULT_BOARD_SETTINGS: BoardSettings = { title: null, background: null };
export const DEFAULT_TRACKER_SETTINGS: TrackerSettings = { title: null, background: null };
export const DEFAULT_TRACKER_FILTER: TrackerFilter = { state: 'active', label: '', assignee: '', author: '', q: '' };

// Module-level so selectors can fall back to them without creating new objects (React #185).
export const EMPTY_TRACKER: TrackerChannelState = {
  issues: [], counts: { open: 0, in_progress: 0, blocked: 0, closed: 0 }, hasMore: false, labels: [],
  settings: DEFAULT_TRACKER_SETTINGS,
  filter: DEFAULT_TRACKER_FILTER, loading: false, loaded: false, error: null, refreshNonce: 0,
};

export const EMPTY_BOARD: BoardChannelState = {
  lists: [], cards: [], labels: [], settings: DEFAULT_BOARD_SETTINGS, loading: false, loaded: false, error: null,
};

const PAGE_SIZE = 50;

export function workItemBasePath(kind: WorkKind, channelId: string) {
  return kind === 'tracker' ? `/api/tracker/${channelId}` : `/api/boards/${channelId}`;
}

export function workItemPath(kind: WorkKind, channelId: string, itemId?: string) {
  const collection = `${workItemBasePath(kind, channelId)}/${kind === 'tracker' ? 'issues' : 'cards'}`;
  return itemId ? `${collection}/${itemId}` : collection;
}

export function apiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  const response = (error as { response?: { data?: { error?: unknown } } } | null)?.response;
  return typeof response?.data?.error === 'string' ? response.data.error : fallback;
}

export function matchesTrackerFilter(issue: TrackerIssue, filter: TrackerFilter) {
  if (filter.state === 'active' ? issue.state === 'closed' : filter.state !== 'all' && issue.state !== filter.state) return false;
  if (filter.label && !issue.label_ids.includes(filter.label)) return false;
  if (filter.assignee && !issue.assignees.some((user) => user.id === filter.assignee)) return false;
  if (filter.author && issue.created_by !== filter.author) return false;
  const q = filter.q.trim().toLowerCase();
  return !q || issue.title.toLowerCase().includes(q);
}

// A created issue arrives twice (REST response and socket echo); count it once.
const countedCreatedIssues = new Set<string>();

type CardOrder = Array<{ listId: string; cardIds: string[] }>;

interface WorkItemState {
  trackers: Record<string, TrackerChannelState>;
  boards: Record<string, BoardChannelState>;
  /** Items currently open in a detail view, kept live by socket events. */
  openItems: Record<string, WorkItem>;
  details: Record<string, WorkItemDetail>;

  // Tracker
  fetchIssues: (channelId: string, options?: { append?: boolean }) => Promise<void>;
  setTrackerFilter: (channelId: string, patch: Partial<TrackerFilter>) => void;
  applyIssue: (issue: TrackerIssue, created?: boolean) => void;
  removeIssue: (channelId: string, id: string) => void;
  setTrackerSettings: (channelId: string, settings: TrackerSettings) => void;

  // Board
  fetchBoard: (channelId: string) => Promise<void>;
  applyCard: (card: BoardCard) => void;
  removeCard: (channelId: string, id: string) => void;
  applyCardOrder: (channelId: string, lists: CardOrder) => void;
  setBoardLists: (channelId: string, lists: BoardList[]) => void;
  setBoardSettings: (channelId: string, settings: BoardSettings) => void;
  removeBoardList: (channelId: string, listId: string) => void;

  // Shared
  fetchLabels: (kind: WorkKind, channelId: string) => Promise<void>;
  setLabels: (kind: WorkKind, channelId: string, labels: WorkItemLabel[]) => void;
  fetchDetail: (kind: WorkKind, channelId: string, itemId: string) => Promise<void>;
  closeDetail: (itemId: string) => void;
  applyComment: (kind: WorkKind, channelId: string, itemId: string, comment: WorkItemComment) => void;
  removeComment: (kind: WorkKind, channelId: string, itemId: string, commentId: string) => void;
  setWatcherCount: (itemId: string, count: number) => void;
  reset: () => void;
}

export const useWorkItemStore = create<WorkItemState>((set, get) => {
  const patchTracker = (channelId: string, patch: (current: TrackerChannelState) => Partial<TrackerChannelState>) =>
    set((s) => {
      const current = s.trackers[channelId] ?? EMPTY_TRACKER;
      return { trackers: { ...s.trackers, [channelId]: { ...current, ...patch(current) } } };
    });
  const patchBoard = (channelId: string, patch: (current: BoardChannelState) => Partial<BoardChannelState>) =>
    set((s) => {
      const current = s.boards[channelId] ?? EMPTY_BOARD;
      return { boards: { ...s.boards, [channelId]: { ...current, ...patch(current) } } };
    });
  const patchOpenItem = (item: WorkItem) =>
    set((s) => (s.openItems[item.id] ? { openItems: { ...s.openItems, [item.id]: item } } : s));
  const dropOpenItem = (id: string) =>
    set((s) => {
      if (!s.openItems[id] && !s.details[id]) return s;
      const openItems = { ...s.openItems };
      const details = { ...s.details };
      delete openItems[id];
      delete details[id];
      return { openItems, details };
    });
  // Adjusts comment_count wherever the item is held.
  const bumpCommentCount = (kind: WorkKind, channelId: string, itemId: string, delta: number) => {
    const bump = <T extends WorkItem>(item: T): T =>
      (item.id === itemId ? { ...item, comment_count: Math.max(0, item.comment_count + delta) } : item);
    if (kind === 'tracker') {
      if (get().trackers[channelId]) patchTracker(channelId, (c) => ({ issues: c.issues.map(bump) }));
    } else if (get().boards[channelId]) {
      patchBoard(channelId, (c) => ({ cards: c.cards.map(bump) }));
    }
    const open = get().openItems[itemId];
    if (open) patchOpenItem(bump(open));
  };

  return {
    trackers: {},
    boards: {},
    openItems: {},
    details: {},

    fetchIssues: async (channelId, options) => {
      const session = captureAccountSession();
      const current = get().trackers[channelId] ?? EMPTY_TRACKER;
      const append = !!options?.append && current.issues.length > 0;
      const filter = current.filter;
      patchTracker(channelId, () => ({ loading: true, error: null }));
      try {
        const res = await createApi().get<{ issues: TrackerIssue[]; counts: Record<TrackerIssue['state'], number>; hasMore: boolean; settings?: TrackerSettings }>(
          workItemPath('tracker', channelId),
          {
            params: {
              state: filter.state,
              ...(filter.label ? { label: filter.label } : {}),
              ...(filter.assignee ? { assignee: filter.assignee } : {}),
              ...(filter.author ? { author: filter.author } : {}),
              ...(filter.q.trim() ? { q: filter.q.trim() } : {}),
              ...(append ? { before: current.issues[current.issues.length - 1].number } : {}),
              limit: PAGE_SIZE,
            },
          },
        );
        if (!session.isCurrent()) return;
        // The filter changed while this request was in flight; a newer request owns the list.
        if ((get().trackers[channelId] ?? EMPTY_TRACKER).filter !== filter) return;
        const issues = Array.isArray(res.data?.issues) ? res.data.issues : [];
        patchTracker(channelId, (c) => ({
          issues: append ? [...c.issues, ...issues.filter((issue) => !c.issues.some((i) => i.id === issue.id))] : issues,
          counts: res.data?.counts ?? c.counts,
          settings: res.data?.settings ?? c.settings,
          hasMore: !!res.data?.hasMore,
          loading: false,
          loaded: true,
        }));
      } catch (error) {
        if (!session.isCurrent()) return;
        patchTracker(channelId, () => ({ loading: false, loaded: true, error: apiErrorMessage(error, 'Failed to load issues') }));
      }
    },

    setTrackerFilter: (channelId, patch) => {
      patchTracker(channelId, (c) => ({ filter: { ...c.filter, ...patch } }));
    },

    applyIssue: (issue, created = false) => {
      patchOpenItem(issue);
      const tracker = get().trackers[issue.channel_id];
      if (!tracker) return;
      const previous = tracker.issues.find((i) => i.id === issue.id);
      const matches = matchesTrackerFilter(issue, tracker.filter);

      if (created) {
        if (countedCreatedIssues.has(issue.id)) return;
        countedCreatedIssues.add(issue.id);
        patchTracker(issue.channel_id, (c) => ({
          counts: { ...c.counts, [issue.state]: (c.counts[issue.state] ?? 0) + 1 },
          issues: matches && !previous ? [issue, ...c.issues] : c.issues,
        }));
        return;
      }
      if (!previous) {
        // Not on the loaded page: it may now belong there (reopened, relabelled) and the counts may be stale.
        patchTracker(issue.channel_id, (c) => ({ refreshNonce: c.refreshNonce + 1 }));
        return;
      }
      patchTracker(issue.channel_id, (c) => {
        const counts = previous.state === issue.state
          ? c.counts
          : { ...c.counts, [previous.state]: Math.max(0, (c.counts[previous.state] ?? 0) - 1), [issue.state]: (c.counts[issue.state] ?? 0) + 1 };
        return {
          counts,
          issues: matches ? c.issues.map((i) => (i.id === issue.id ? issue : i)) : c.issues.filter((i) => i.id !== issue.id),
        };
      });
    },

    removeIssue: (channelId, id) => {
      dropOpenItem(id);
      const tracker = get().trackers[channelId];
      if (!tracker) return;
      const previous = tracker.issues.find((i) => i.id === id);
      patchTracker(channelId, (c) => (previous
        ? {
          issues: c.issues.filter((i) => i.id !== id),
          counts: { ...c.counts, [previous.state]: Math.max(0, (c.counts[previous.state] ?? 0) - 1) },
        }
        : { refreshNonce: c.refreshNonce + 1 }));
    },

    setTrackerSettings: (channelId, settings) => {
      if (get().trackers[channelId]) patchTracker(channelId, () => ({ settings }));
    },

    fetchBoard: async (channelId) => {
      const session = captureAccountSession();
      patchBoard(channelId, () => ({ loading: true, error: null }));
      try {
        const res = await createApi().get<{ lists: BoardList[]; cards: BoardCard[]; labels: WorkItemLabel[]; settings?: BoardSettings }>(
          workItemBasePath('board', channelId),
        );
        if (!session.isCurrent()) return;
        const lists = Array.isArray(res.data?.lists) ? [...res.data.lists].sort((a, b) => a.position - b.position) : [];
        patchBoard(channelId, () => ({
          lists,
          cards: Array.isArray(res.data?.cards) ? res.data.cards : [],
          labels: Array.isArray(res.data?.labels) ? res.data.labels : [],
          // Older realm servers send no settings.
          settings: res.data?.settings ?? DEFAULT_BOARD_SETTINGS,
          loading: false,
          loaded: true,
        }));
      } catch (error) {
        if (!session.isCurrent()) return;
        patchBoard(channelId, () => ({ loading: false, loaded: true, error: apiErrorMessage(error, 'Failed to load board') }));
      }
    },

    applyCard: (card) => {
      patchOpenItem(card);
      if (!get().boards[card.channel_id]) return;
      patchBoard(card.channel_id, (c) => {
        const others = c.cards.filter((existing) => existing.id !== card.id);
        // The board only holds live cards; archived ones are fetched on demand.
        return { cards: card.archived ? others : [...others, card] };
      });
    },

    removeCard: (channelId, id) => {
      dropOpenItem(id);
      if (!get().boards[channelId]) return;
      patchBoard(channelId, (c) => ({ cards: c.cards.filter((card) => card.id !== id) }));
    },

    applyCardOrder: (channelId, lists) => {
      const placement = new Map<string, { list_id: string; position: number }>();
      for (const list of lists) list.cardIds.forEach((id, position) => placement.set(id, { list_id: list.listId, position }));
      const board = get().boards[channelId];
      if (board) {
        // The server only reports lists this user can see. A card missing from the order of
        // the list it was in has moved somewhere hidden; an unknown card has arrived from there.
        const reported = new Set(lists.map((list) => list.listId));
        patchBoard(channelId, (c) => ({
          cards: c.cards
            .filter((card) => placement.has(card.id) || !reported.has(card.list_id))
            .map((card) => {
              const next = placement.get(card.id);
              return next ? { ...card, ...next } : card;
            }),
        }));
        if ([...placement.keys()].some((id) => !board.cards.some((card) => card.id === id))) void get().fetchBoard(channelId);
      }
      for (const [id, next] of placement) {
        const open = get().openItems[id];
        if (open && 'list_id' in open) patchOpenItem({ ...open, ...next });
      }
    },

    setBoardLists: (channelId, lists) => {
      const board = get().boards[channelId];
      if (!board) return;
      const ids = new Set(lists.map((list) => list.id));
      // Lists can vanish (hidden from this user) or appear (shared with them) as well as change.
      patchBoard(channelId, (c) => ({
        lists: [...lists].sort((a, b) => a.position - b.position),
        cards: c.cards.filter((card) => ids.has(card.list_id)),
      }));
      for (const card of board.cards) if (!ids.has(card.list_id)) dropOpenItem(card.id);
      // A list that just became visible arrives without its cards.
      if (lists.some((list) => !board.lists.some((known) => known.id === list.id))) void get().fetchBoard(channelId);
    },

    setBoardSettings: (channelId, settings) => {
      if (get().boards[channelId]) patchBoard(channelId, () => ({ settings }));
    },

    removeBoardList: (channelId, listId) => {
      const board = get().boards[channelId];
      if (!board) return;
      for (const card of board.cards) if (card.list_id === listId) dropOpenItem(card.id);
      patchBoard(channelId, (c) => ({
        lists: c.lists.filter((list) => list.id !== listId),
        cards: c.cards.filter((card) => card.list_id !== listId),
      }));
    },

    fetchLabels: async (kind, channelId) => {
      const session = captureAccountSession();
      try {
        const res = await createApi().get<WorkItemLabel[]>(`${workItemBasePath(kind, channelId)}/labels`);
        if (!session.isCurrent()) return;
        get().setLabels(kind, channelId, Array.isArray(res.data) ? res.data : []);
      } catch { /* label rows simply stay empty */ }
    },

    setLabels: (kind, channelId, labels) => {
      if (kind === 'tracker') patchTracker(channelId, () => ({ labels }));
      else patchBoard(channelId, () => ({ labels }));
    },

    fetchDetail: async (kind, channelId, itemId) => {
      const session = captureAccountSession();
      const res = await createApi().get<WorkItem & WorkItemDetail>(workItemPath(kind, channelId, itemId));
      if (!session.isCurrent()) return;
      const { comments, events, attachments, watching, watcher_count, ...item } = res.data;
      set((s) => ({
        openItems: { ...s.openItems, [item.id]: item as WorkItem },
        details: {
          ...s.details,
          [item.id]: { comments: comments ?? [], events: events ?? [], attachments, watching, watcher_count },
        },
      }));
    },

    closeDetail: (itemId) => dropOpenItem(itemId),

    setWatcherCount: (itemId, count) => {
      set((s) => {
        const detail = s.details[itemId];
        return detail ? { details: { ...s.details, [itemId]: { ...detail, watcher_count: count } } } : s;
      });
    },

    applyComment: (kind, channelId, itemId, comment) => {
      const detail = get().details[itemId];
      const known = detail?.comments.some((c) => c.id === comment.id);
      if (detail) {
        set((s) => ({
          details: {
            ...s.details,
            [itemId]: {
              ...detail,
              comments: known ? detail.comments.map((c) => (c.id === comment.id ? comment : c)) : [...detail.comments, comment],
            },
          },
        }));
      }
      // Without the detail loaded there is no way to tell an edit from a new comment, and
      // edits also arrive as comment-updated, which callers route here with the same shape.
      if (!known && comment.edited_at === null) bumpCommentCount(kind, channelId, itemId, 1);
    },

    removeComment: (kind, channelId, itemId, commentId) => {
      const detail = get().details[itemId];
      if (detail) {
        if (!detail.comments.some((c) => c.id === commentId)) return;
        set((s) => ({
          details: { ...s.details, [itemId]: { ...detail, comments: detail.comments.filter((c) => c.id !== commentId) } },
        }));
      }
      bumpCommentCount(kind, channelId, itemId, -1);
    },

    reset: () => {
      countedCreatedIssues.clear();
      set({ trackers: {}, boards: {}, openItems: {}, details: {} });
    },
  };
});
