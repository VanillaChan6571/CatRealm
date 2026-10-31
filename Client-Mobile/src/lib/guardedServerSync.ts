import axios from 'axios';
import { decryptServerList, encryptServerList, serverMembershipIds } from '../utils/serverSyncCrypto';
import type { ServerSyncPayload } from '../utils/serverSyncCrypto';
export { serverMembershipIds } from '../utils/serverSyncCrypto';

export interface RemoteList {
  protocol?: number;
  payload: string | null;
  iv: string | null;
  revision: number;
  memberIds: string[] | null;
  entries?: Array<{ id: string; payload: string; iv: string }> | null;
  metadata?: { payload: string; iv: string } | null;
}
type SyncApi = {
  get: (path: string) => Promise<{ data: RemoteList }>;
  post: (path: string, body: unknown) => Promise<{ data: { revision: number } }>;
};

function checkIds(ids: string[]) {
  if (!Array.isArray(ids) || ids.length > 2000 || new Set(ids).size !== ids.length
    || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) throw new Error('Invalid server list membership.');
}
function sameIds(a: string[], b: string[]) {
  checkIds(a); checkIds(b);
  if (a.length !== b.length || a.some(id => !b.includes(id))) throw new Error('Server list membership does not match its encrypted contents.');
}
function validateList(list: ServerSyncPayload | null): ServerSyncPayload {
  if (!list || !Array.isArray(list.servers) || list.servers.length > 2000
    || list.servers.some(s => !s || typeof s.url !== 'string' || !s.url)
    || new Set(list.servers.map(s => s.url)).size !== list.servers.length) throw new Error('Cannot read an unreadable server list.');
  return list;
}

/** Validate both whole-list legacy snapshots and structural v2 entries before applying state. */
export async function readServerList(stored: RemoteList, syncKey: string): Promise<ServerSyncPayload> {
  if (stored.entries != null) {
    if (stored.protocol !== 2 || !Array.isArray(stored.entries) || !stored.metadata || !Array.isArray(stored.memberIds)) throw new Error('Invalid encrypted server entries.');
    sameIds(stored.entries.map(e => e.id), stored.memberIds);
    const servers: ServerSyncPayload['servers'] = [];
    for (const entry of stored.entries) {
      const decoded = validateList(await decryptServerList(entry.payload, entry.iv, syncKey));
      if (decoded.servers.length !== 1) throw new Error('An encrypted realm entry must contain exactly one server.');
      const [id] = await serverMembershipIds([decoded.servers[0].url], syncKey);
      if (id !== entry.id) throw new Error('Server entry identity does not match its encrypted contents.');
      servers.push(decoded.servers[0]);
    }
    const meta = validateList(await decryptServerList(stored.metadata.payload, stored.metadata.iv, syncKey));
    if (meta.servers.length) throw new Error('Layout metadata must not contain server membership.');
    return { servers, layout: meta.layout, folders: meta.folders };
  }
  const decoded = stored.payload == null && stored.iv == null ? { servers: [] }
    : validateList(await decryptServerList(stored.payload!, stored.iv!, syncKey));
  if (stored.memberIds != null) sameIds(await serverMembershipIds(decoded.servers.map(s => s.url), syncKey), stored.memberIds);
  return decoded;
}

export async function encryptServerEntries(list: ServerSyncPayload, syncKey: string) {
  validateList(list);
  const memberIds = await serverMembershipIds(list.servers.map(s => s.url), syncKey);
  const entries = await Promise.all(list.servers.map(async (server, index) => ({
    id: memberIds[index], ...await encryptServerList({ servers: [server] }, syncKey),
  })));
  const metadata = await encryptServerList({ servers: [], layout: list.layout, folders: list.folders }, syncKey);
  return { entries, metadata, memberIds };
}

export function preserveRemoteMembership(
  local: ServerSyncPayload, remote: ServerSyncPayload, removedUrls: string[],
): ServerSyncPayload {
  const removed = new Set(removedUrls);
  const servers = local.servers.filter(server => !removed.has(server.url));
  const urls = new Set(servers.map(server => server.url));
  for (const server of remote.servers) {
    if (!removed.has(server.url) && !urls.has(server.url)) {
      servers.push(server);
      urls.add(server.url);
    }
  }
  const folders = (local.folders ?? []).map(folder => ({
    ...folder, serverUrls: folder.serverUrls.filter(url => urls.has(url)),
  })).filter(folder => folder.serverUrls.length);
  const folderIds = new Set(folders.map(folder => folder.id));
  const layout = (local.layout ?? []).filter(item => item.type === 'server'
    ? urls.has(item.url) : folderIds.has(item.folderId));
  const listed = new Set([
    ...layout.flatMap(item => item.type === 'server' ? [item.url] : []),
    ...folders.flatMap(folder => folder.serverUrls),
  ]);
  for (const server of servers) {
    if (!listed.has(server.url)) layout.push({ type: 'server', url: server.url });
  }
  return { servers, layout, folders };
}


// Keep remote membership unless an explicit local removal authorizes deletion.
export async function syncGuardedServerList(
  api: SyncApi, local: ServerSyncPayload, syncKey: string, removedUrls: string[],
  isCurrent: () => boolean,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3 && isCurrent(); attempt++) {
    try {
      const { data: stored } = await api.get('/api/servers?protocol=2');
      if (!isCurrent()) return false;
      if (stored.protocol !== 2 || !Number.isSafeInteger(stored.revision)) throw new Error('Central must support guarded server-list protocol 2 before writing.');
      const remote = await readServerList(stored, syncKey);
      const previousIds = await serverMembershipIds(remote.servers.map(s => s.url), syncKey);
      let revision = stored.revision;
      if (stored.entries == null && stored.payload != null) {
        const original = await encryptServerEntries(remote, syncKey);
        if (!isCurrent()) return false;
        const response = await api.post('/api/servers/sync', {
          protocol: 2, ...original, expectedRevision: revision, removedMemberIds: [],
          legacy: { payload: stored.payload, iv: stored.iv },
        });
        revision = response.data.revision;
      }
      const next = preserveRemoteMembership(local, remote, removedUrls);
      const encrypted = await encryptServerEntries(next, syncKey);
      const explicitIds = new Set(await serverMembershipIds(removedUrls, syncKey));
      const removedMemberIds = previousIds.filter(id => !encrypted.memberIds.includes(id) && explicitIds.has(id));
      if (!isCurrent()) return false;
      await api.post('/api/servers/sync', {
        protocol: 2, ...encrypted, expectedRevision: revision, removedMemberIds,
      });
      return isCurrent();
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409
        && error.response?.data?.code === 'SERVER_LIST_CONFLICT') continue;
      throw error;
    }
  }
  return false;
}
