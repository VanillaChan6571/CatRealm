/**
 * Drop logic for arranging the server list by drag (ServerListSection's
 * jiggle mode). Pure functions over the rendered list and measured window
 * positions, so the rules are testable without gestures.
 */

import type { ServerFolder, ServerLayoutItem } from '@/stores/serverStore';
import type { ServerListItem } from '@/lib/serverListItems';

/** Something being dragged: a top-level realm/folder, or a realm inside a folder. */
export type DragSource =
  | { kind: 'top'; index: number }
  | { kind: 'child'; folderId: string; serverId: string };

/**
 * Where it would land. `index` counts the destination's entries with the dragged
 * one already taken out, so it is also its final position there.
 */
export type DropTarget =
  | { type: 'top'; index: number }
  | { type: 'folder'; folderId: string; index: number };

export type Rect = { y: number; height: number };

/** A folder's top and bottom edges place beside it; only its middle drops into it. */
const FOLDER_EDGE = 22;
/**
 * An open folder's bottom edge stays thin so its last realm's slot is still
 * reachable; just below the folder already places a realm after it.
 */
const OPEN_FOLDER_BOTTOM_EDGE = 8;

export function topItemId(item: ServerListItem): string {
  return item.type === 'server' ? `s:${item.server.id}` : `f:${item.folder.id}`;
}

export function childItemId(folderId: string, serverId: string): string {
  return `c:${folderId}:${serverId}`;
}

function draggedServerId(source: DragSource, items: ServerListItem[]): string | null {
  if (source.kind === 'child') return source.serverId;
  const item = items[source.index];
  return item?.type === 'server' ? item.server.id : null;
}

/** Entries before the finger, judged by their vertical midpoints. */
function countAbove(absoluteY: number, rects: (Rect | undefined)[]): number {
  return rects.reduce((count, rect) => (rect && absoluteY > rect.y + rect.height / 2 ? count + 1 : count), 0);
}

export function computeDropTarget(
  absoluteY: number,
  source: DragSource,
  items: ServerListItem[],
  rects: Map<string, Rect>,
): DropTarget {
  const serverId = draggedServerId(source, items);

  // A realm held over the middle of a folder goes into it; folders never nest.
  if (serverId) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.type !== 'folder' || (source.kind === 'top' && source.index === i)) continue;
      const rect = rects.get(topItemId(item));
      if (!rect) continue;
      const edge = Math.min(rect.height * 0.25, FOLDER_EDGE);
      const bottomEdge = item.folder.isOpen ? Math.min(edge, OPEN_FOLDER_BOTTOM_EDGE) : edge;
      if (absoluteY <= rect.y + edge || absoluteY >= rect.y + rect.height - bottomEdge) continue;
      const others = item.servers.filter((server) => server.id !== serverId);
      const index = item.folder.isOpen
        ? countAbove(absoluteY, others.map((server) => rects.get(childItemId(item.folder.id, server.id))))
        : others.length;
      return { type: 'folder', folderId: item.folder.id, index };
    }
  }

  const others = items.filter((_, i) => !(source.kind === 'top' && source.index === i));
  return { type: 'top', index: countAbove(absoluteY, others.map((item) => rects.get(topItemId(item)))) };
}

function toLayoutItem(item: ServerListItem): ServerLayoutItem {
  return item.type === 'server'
    ? { type: 'server', url: item.server.id }
    : { type: 'folder', folderId: item.folder.id };
}

/** The layout and folders after dropping `source` on `target`, or null when nothing changes. */
export function applyDrop(
  items: ServerListItem[],
  folders: ServerFolder[],
  source: DragSource,
  target: DropTarget,
): { layout: ServerLayoutItem[]; folders: ServerFolder[] } | null {
  if (source.kind === 'top' && target.type === 'top' && source.index === target.index) return null;

  const layout = items.map(toLayoutItem);
  let nextFolders = folders.map((folder) => ({ ...folder, serverUrls: [...folder.serverUrls] }));

  let moved: ServerLayoutItem;
  if (source.kind === 'top') {
    [moved] = layout.splice(source.index, 1);
  } else {
    nextFolders = nextFolders.map((folder) => folder.id === source.folderId
      ? { ...folder, serverUrls: folder.serverUrls.filter((id) => id !== source.serverId) }
      : folder);
    moved = { type: 'server', url: source.serverId };
  }

  if (target.type === 'top') {
    layout.splice(target.index, 0, moved);
    return { layout, folders: nextFolders };
  }

  if (moved.type !== 'server') return null;
  const serverId = moved.url;
  const destination = items.find((item) => item.type === 'folder' && item.folder.id === target.folderId);
  if (!destination || destination.type !== 'folder') return null;
  // `index` is among the folder's visible realms; anchor on the realm it lands before.
  const visibleOthers = destination.servers.filter((server) => server.id !== serverId);
  const before = visibleOthers[target.index]?.id;
  nextFolders = nextFolders.map((folder) => {
    if (folder.id !== target.folderId) return folder;
    const urls = folder.serverUrls.filter((id) => id !== serverId);
    const at = before ? urls.indexOf(before) : -1;
    urls.splice(at === -1 ? urls.length : at, 0, serverId);
    return { ...folder, serverUrls: urls };
  });
  return { layout, folders: nextFolders };
}
