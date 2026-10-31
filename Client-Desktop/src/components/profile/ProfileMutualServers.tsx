import { useEffect, useMemo, useState } from 'react';
import { createApi } from '../../lib/api';
import { useServerStore, type ServerEntry } from '../../stores/serverStore';
import { useUIStore } from '../../stores/uiStore';
import { resolveServerIcon } from '../../lib/serverIcon';

type MutualServer = { server: ServerEntry; localUserId: string };

// Per-session cache: one fan-out per (person, joined-server set).
const mutualCache = new Map<string, Promise<Array<{ url: string; localUserId: string }>>>();

function cacheKey(centralId: string, servers: ServerEntry[]) {
  return `${centralId}|${servers.map((s) => s.url).sort().join(',')}`;
}

function lookupMutualServers(key: string, centralId: string, servers: ServerEntry[]) {
  let pending = mutualCache.get(key);
  if (!pending) {
    // Each realm resolves the Central ID to its own local user if that person is a member there.
    pending = Promise.all(servers.map(async (server) => {
      try {
        const res = await createApi(server.url, server.token).get<{ id?: string; isMember?: boolean }>(`/api/profile/${centralId}`);
        // Realms keep rows for people who left; older realms omit isMember.
        return res.data?.id && res.data.isMember !== false ? { url: server.url, localUserId: res.data.id } : null;
      } catch {
        return null;
      }
    })).then((matches) => matches.filter((m): m is { url: string; localUserId: string } => !!m));
    mutualCache.set(key, pending);
  }
  return pending;
}

/** Realms the viewer shares with a Central user; clicking one opens their profile in that realm. */
export function ProfileMutualServers({ centralId }: { centralId: string }) {
  const allServers = useServerStore((s) => s.servers);
  const switchServer = useServerStore((s) => s.switchServer);
  const openModal = useUIStore((s) => s.openModal);
  const servers = useMemo(() => allServers.filter((s) => s.token?.trim()), [allServers]);
  const key = cacheKey(centralId, servers);
  const [result, setResult] = useState<{ key: string; matches: Array<{ url: string; localUserId: string }> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void lookupMutualServers(key, centralId, servers).then((matches) => {
      if (!cancelled) setResult({ key, matches });
    });
    return () => { cancelled = true; };
  }, [key, centralId, servers]);

  // Stale results (another person or server set) count as still loading.
  const mutuals: MutualServer[] | null = result?.key === key
    ? result.matches.flatMap(({ url, localUserId }) => {
      const server = servers.find((s) => s.url === url);
      return server ? [{ server, localUserId }] : [];
    })
    : null;

  if (servers.length === 0) return null;

  return (
    <div className="space-y-2">
      <label className="text-xs text-text-muted font-semibold">
        Mutual Servers{mutuals && mutuals.length > 0 ? ` — ${mutuals.length}` : ''}
      </label>
      <div className="rounded border border-border bg-bg-input p-1">
        {mutuals === null ? (
          <p className="px-2 py-1.5 text-xs text-text-muted">Checking your servers…</p>
        ) : mutuals.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-text-muted">No mutual servers</p>
        ) : (
          mutuals.map(({ server, localUserId }) => {
            const icon = resolveServerIcon(server);
            const name = server.name || server.info?.name || server.url;
            return (
              <button
                key={server.url}
                type="button"
                className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left hover:bg-bg-hover"
                onClick={() => {
                  switchServer(server.url);
                  openModal('profileView', { userId: localUserId });
                }}
              >
                {icon ? (
                  <img src={icon} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-hover text-xs font-semibold text-text-primary">
                    {Array.from(name)[0]?.toUpperCase() ?? '?'}
                  </span>
                )}
                <span className="truncate text-sm text-text-primary">{name}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
