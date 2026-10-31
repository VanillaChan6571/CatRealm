/**
 * Builds an ordered render list of top-level servers and folders from the
 * synced layout, mirroring the desktop ServerListBar ordering. Any server not
 * referenced by the layout or a folder is appended as a top-level item so it is
 * never hidden (e.g. a server added on another client since the last sync).
 */

import type { MobileServer, ServerFolder, ServerLayoutItem } from '@/stores/serverStore';

export type ServerListItem =
  | { type: 'server'; server: MobileServer }
  | { type: 'folder'; folder: ServerFolder; servers: MobileServer[] };

export function buildServerListItems(
  servers: MobileServer[],
  layout: ServerLayoutItem[],
  folders: ServerFolder[],
): ServerListItem[] {
  const byId = new Map(servers.map((s) => [s.id, s]));
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const placed = new Set<string>();
  const items: ServerListItem[] = [];

  for (const entry of layout) {
    if (entry.type === 'server') {
      const server = byId.get(entry.url);
      if (server && !placed.has(server.id)) {
        placed.add(server.id);
        items.push({ type: 'server', server });
      }
    } else {
      const folder = folderById.get(entry.folderId);
      if (!folder) continue;
      const folderServers: MobileServer[] = [];
      for (const url of folder.serverUrls) {
        const server = byId.get(url);
        if (server && !placed.has(server.id)) {
          placed.add(server.id);
          folderServers.push(server);
        }
      }
      if (folderServers.length > 0) {
        items.push({ type: 'folder', folder, servers: folderServers });
      }
    }
  }

  // Append any server the layout never referenced (keeps them visible).
  for (const server of servers) {
    if (!placed.has(server.id)) {
      placed.add(server.id);
      items.push({ type: 'server', server });
    }
  }

  return items;
}

/** Returns the folder that contains the given server, if any. */
export function folderContainingServer(
  serverId: string,
  folders: ServerFolder[],
): ServerFolder | undefined {
  return folders.find((f) => f.serverUrls.includes(serverId));
}
