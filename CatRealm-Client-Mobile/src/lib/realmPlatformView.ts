import type { SyncedServerEntry, SyncedServerFolder, ServerLayoutItem } from '@/utils/serverSyncCrypto';

function isHttpGatewayRealm(url: string): boolean {
  return /^https:\/\/r-[a-f0-9]{40}\.bridge\.catrealm\.app$/.test(url);
}

function savedRealmHttpOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    if (url.protocol === 'http:') return url.origin;
    // Older IP:port entries were saved as HTTPS before the HTTP bridge existed.
    if (url.protocol === 'https:' && url.port && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname)) {
      return `http://${url.host}`;
    }
  } catch { /* Ignore malformed legacy entries. */ }
  return null;
}

/**
 * Mobile uses the HTTPS bridge representation of an HTTP realm. The encrypted
 * server list intentionally retains both representations for other clients,
 * so collapse aliases only in the mobile view and rewrite layout references to
 * the visible URL.
 */
export function selectMobileRealmView(
  servers: SyncedServerEntry[],
  layout: ServerLayoutItem[] | null | undefined,
  folders: SyncedServerFolder[] | null | undefined,
): {
  servers: SyncedServerEntry[];
  layout: ServerLayoutItem[] | null;
  folders: SyncedServerFolder[] | null;
  rename: (url: string) => string;
} {
  const gatewayByOrigin = new Map<string, SyncedServerEntry>();
  for (const server of servers) {
    if (isHttpGatewayRealm(server.url) && server.originalHttpOrigin
      && !gatewayByOrigin.has(server.originalHttpOrigin)) {
      gatewayByOrigin.set(server.originalHttpOrigin, server);
    }
  }

  const renamed = new Map<string, string>();
  const visible = servers.filter((server) => {
    if (isHttpGatewayRealm(server.url)) return true;
    const gateway = gatewayByOrigin.get(savedRealmHttpOrigin(server.url) ?? '');
    if (!gateway) return true;
    renamed.set(server.url, gateway.url);
    return false;
  });
  const rename = (url: string) => renamed.get(url) ?? url;

  return {
    servers: visible,
    layout: layout?.map((item) => item.type === 'server' ? { ...item, url: rename(item.url) } : item) ?? null,
    folders: folders?.map((folder) => ({
      ...folder,
      serverUrls: folder.serverUrls.map(rename),
    })) ?? null,
    rename,
  };
}
