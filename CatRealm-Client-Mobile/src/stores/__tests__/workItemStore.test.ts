import type { BoardCard, BoardList, TrackerIssue, WorkItemComment } from '@/types';
import { useWorkItemStore as store, EMPTY_TRACKER } from '../workItemStore';
import { dueFromInput } from '@/components/workitems/workItemUtils';

const mockGet = jest.fn();
jest.mock('@/lib/api', () => ({ createApi: () => ({ get: (...args: unknown[]) => mockGet(...args) }) }));
jest.mock('@/lib/accountSession', () => ({ captureAccountSession: () => ({ isCurrent: () => true }) }));
jest.mock('../authStore', () => ({ useAuthStore: { getState: () => ({ user: null }) } }));
jest.mock('../serverStore', () => ({ useServerStore: Object.assign(() => null, { getState: () => ({}) }) }));
jest.mock('../presenceStore', () => ({ usePresenceStore: Object.assign(() => [], { getState: () => ({ allMembers: [] }) }) }));

const issue = (values: Partial<TrackerIssue> = {}): TrackerIssue => ({
  id: 'i1', channel_id: 'tr', number: 1, title: 'Bug', body: '', created_by: 'u1', author: null,
  created_at: 1, updated_at: 1, label_ids: [], assignees: [], comment_count: 0,
  state: 'open', priority: 'normal', due_at: null, closed_at: null, closed_by: null, ...values,
});
const card = (values: Partial<BoardCard> = {}): BoardCard => ({
  id: 'c1', channel_id: 'bd', list_id: 'a', position: 0, title: 'Card', body: '', created_by: 'u1', author: null,
  created_at: 1, updated_at: 1, label_ids: [], assignees: [], comment_count: 0, due_at: null, archived: false, ...values,
});
const list = (id: string, position: number): BoardList => ({
  id, name: id, position, cover_image: null, cover_size: null, icon: null, staff_only: false,
});
const comment = (id: string, edited_at: number | null = null): WorkItemComment => ({
  id, item_id: 'i1', user_id: 'u1', author: null, body: 'hi', created_at: 2, edited_at,
});

beforeEach(() => {
  store.getState().reset();
  mockGet.mockReset();
});

function loadTracker(issues: TrackerIssue[], counts = { open: issues.length, in_progress: 0, blocked: 0, closed: 0 }) {
  store.setState({ trackers: { tr: { ...EMPTY_TRACKER, issues, counts, loaded: true } } });
}

test('a created issue counts once though it arrives from REST and the socket', () => {
  loadTracker([]);
  store.getState().applyIssue(issue(), true);
  store.getState().applyIssue(issue(), true);
  const tracker = store.getState().trackers.tr;
  expect(tracker.issues).toHaveLength(1);
  expect(tracker.counts.open).toBe(1);
});

test('closing an issue moves its count and drops it from the active filter', () => {
  loadTracker([issue()]);
  store.getState().applyIssue(issue({ state: 'closed', closed_at: 5 }));
  const tracker = store.getState().trackers.tr;
  expect(tracker.issues).toHaveLength(0);
  expect(tracker.counts).toMatchObject({ open: 0, closed: 1 });
});

test('an update for an issue off the loaded page asks the view to refetch', () => {
  loadTracker([]);
  store.getState().applyIssue(issue({ id: 'other' }));
  expect(store.getState().trackers.tr.refreshNonce).toBe(1);
});

test('a stale tracker response is dropped when the filter changed mid-request', async () => {
  loadTracker([]);
  let resolve: (value: unknown) => void = () => {};
  mockGet.mockReturnValue(new Promise((r) => { resolve = r; }));
  const pending = store.getState().fetchIssues('tr');
  store.getState().setTrackerFilter('tr', { state: 'closed' });
  resolve({ data: { issues: [issue()], counts: { open: 1, in_progress: 0, blocked: 0, closed: 0 }, hasMore: false } });
  await pending;
  expect(store.getState().trackers.tr.issues).toHaveLength(0);
});

test('card order applies placements and drops cards moved to a list this user cannot see', () => {
  store.setState({
    boards: {
      bd: {
        lists: [list('a', 0), list('b', 1)],
        cards: [card({ id: 'c1', list_id: 'a', position: 0 }), card({ id: 'c2', list_id: 'a', position: 1 })],
        labels: [], settings: { title: null, background: null }, loading: false, loaded: true, error: null,
      },
    },
  });
  // c2 went to a hidden list: the server only reports list "a", without it.
  store.getState().applyCardOrder('bd', [{ listId: 'a', cardIds: ['c1'] }]);
  expect(store.getState().boards.bd.cards.map((c) => c.id)).toEqual(['c1']);

  store.getState().applyCardOrder('bd', [{ listId: 'b', cardIds: ['c1'] }, { listId: 'a', cardIds: [] }]);
  expect(store.getState().boards.bd.cards[0]).toMatchObject({ id: 'c1', list_id: 'b', position: 0 });
  expect(mockGet).not.toHaveBeenCalled();
});

test('archiving a card removes it from the board but keeps it open in the detail view', () => {
  store.setState({
    boards: { bd: { lists: [list('a', 0)], cards: [card()], labels: [], settings: { title: null, background: null }, loading: false, loaded: true, error: null } },
    openItems: { c1: card() },
  });
  store.getState().applyCard(card({ archived: true }));
  expect(store.getState().boards.bd.cards).toHaveLength(0);
  expect(store.getState().openItems.c1).toMatchObject({ archived: true });
});

test('comment counts follow new comments but not edits or repeats', () => {
  loadTracker([issue()]);
  store.setState({ openItems: { i1: issue() }, details: { i1: { comments: [], events: [] } } });
  const { applyComment, removeComment } = store.getState();
  applyComment('tracker', 'tr', 'i1', comment('k1'));
  applyComment('tracker', 'tr', 'i1', comment('k1'));
  applyComment('tracker', 'tr', 'i1', comment('k1', 9));
  expect(store.getState().trackers.tr.issues[0].comment_count).toBe(1);
  expect(store.getState().details.i1.comments[0].edited_at).toBe(9);
  removeComment('tracker', 'tr', 'i1', 'k1');
  removeComment('tracker', 'tr', 'i1', 'k1');
  expect(store.getState().openItems.i1.comment_count).toBe(0);
});

test('due dates parse as the end of a real local day', () => {
  expect(dueFromInput('')).toBeNull();
  expect(dueFromInput('2026-02-30')).toBeUndefined();
  expect(dueFromInput('soon')).toBeUndefined();
  const parsed = dueFromInput('2026-11-15');
  expect(new Date((parsed as number) * 1000)).toEqual(new Date(2026, 10, 15, 23, 59, 59));
});
