import { applyDrop, childItemId, computeDropTarget, topItemId, type Rect } from '../arrangeDrop';
import type { ServerListItem } from '../serverListItems';
import type { MobileServer, ServerFolder } from '@/stores/serverStore';

const server = (id: string) => ({ id, name: id, url: id }) as MobileServer;
const folder = (id: string, serverUrls: string[], isOpen = true): ServerFolder =>
  ({ id, name: id, color: '#5865F2', serverUrls, isOpen });

// Layout on screen (window y):  A 0-100 | Folder F 110-330 (header 110-170, B 180-250, C 260-330) | D 340-440
const F = folder('F', ['B', 'C']);
const folders = [F];
const items: ServerListItem[] = [
  { type: 'server', server: server('A') },
  { type: 'folder', folder: F, servers: [server('B'), server('C')] },
  { type: 'server', server: server('D') },
];
const rects = new Map<string, Rect>([
  [topItemId(items[0]), { y: 0, height: 100 }],
  [topItemId(items[1]), { y: 110, height: 220 }],
  [childItemId('F', 'B'), { y: 180, height: 70 }],
  [childItemId('F', 'C'), { y: 260, height: 70 }],
  [topItemId(items[2]), { y: 340, height: 100 }],
]);

test('dragging a realm out of its folder places it at the top level', () => {
  const source = { kind: 'child', folderId: 'F', serverId: 'C' } as const;
  const target = computeDropTarget(420, source, items, rects);
  expect(target).toEqual({ type: 'top', index: 3 });
  expect(applyDrop(items, folders, source, target)).toEqual({
    layout: [
      { type: 'server', url: 'A' },
      { type: 'folder', folderId: 'F' },
      { type: 'server', url: 'D' },
      { type: 'server', url: 'C' },
    ],
    folders: [{ ...F, serverUrls: ['B'] }],
  });
});

test("a folder's top edge places beside it rather than inside", () => {
  const source = { kind: 'child', folderId: 'F', serverId: 'B' } as const;
  expect(computeDropTarget(115, source, items, rects)).toEqual({ type: 'top', index: 1 });
});

test('dropping a top-level realm on a folder moves it in at that spot', () => {
  const source = { kind: 'top', index: 0 } as const;
  const target = computeDropTarget(255, source, items, rects);
  expect(target).toEqual({ type: 'folder', folderId: 'F', index: 1 });
  expect(applyDrop(items, folders, source, target)).toEqual({
    layout: [{ type: 'folder', folderId: 'F' }, { type: 'server', url: 'D' }],
    folders: [{ ...F, serverUrls: ['B', 'A', 'C'] }],
  });
});

test('a closed folder takes a dropped realm at its end', () => {
  const closed = folder('F', ['B', 'C'], false);
  const closedItems: ServerListItem[] = [items[0], { ...items[1], folder: closed } as ServerListItem, items[2]];
  const closedRects = new Map<string, Rect>([...rects].filter(([id]) => !id.startsWith('c:')));
  closedRects.set(topItemId(closedItems[1]), { y: 110, height: 70 });
  expect(computeDropTarget(145, { kind: 'top', index: 2 }, closedItems, closedRects))
    .toEqual({ type: 'folder', folderId: 'F', index: 2 });
});

test('realms reorder inside their folder', () => {
  const source = { kind: 'child', folderId: 'F', serverId: 'B' } as const;
  const target = computeDropTarget(320, source, items, rects);
  expect(target).toEqual({ type: 'folder', folderId: 'F', index: 1 });
  expect(applyDrop(items, folders, source, target)?.folders).toEqual([{ ...F, serverUrls: ['C', 'B'] }]);
});

test('folders only reorder at the top level and never nest', () => {
  const source = { kind: 'top', index: 1 } as const;
  const target = computeDropTarget(420, source, items, rects);
  expect(target).toEqual({ type: 'top', index: 2 });
  expect(applyDrop(items, folders, source, target)?.layout).toEqual([
    { type: 'server', url: 'A' },
    { type: 'server', url: 'D' },
    { type: 'folder', folderId: 'F' },
  ]);
});

test('dropping where it started changes nothing', () => {
  expect(applyDrop(items, folders, { kind: 'top', index: 2 }, { type: 'top', index: 2 })).toBeNull();
});

test('moving the last realm out empties the folder for the store to drop', () => {
  const solo = folder('S', ['B']);
  const soloItems: ServerListItem[] = [{ type: 'folder', folder: solo, servers: [server('B')] }, items[0]];
  const result = applyDrop(soloItems, [solo], { kind: 'child', folderId: 'S', serverId: 'B' }, { type: 'top', index: 2 });
  expect(result?.folders).toEqual([{ ...solo, serverUrls: [] }]);
  expect(result?.layout).toEqual([{ type: 'folder', folderId: 'S' }, { type: 'server', url: 'A' }, { type: 'server', url: 'B' }]);
});
