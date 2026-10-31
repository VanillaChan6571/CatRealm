import type { ServerEntry } from '../stores/serverStore';

export function resolveServerIcon(server: ServerEntry): string | null {
  return server.icon
    ?? (server.info?.serverIcon
      ? (/^https?:\/\//i.test(server.info.serverIcon) ? server.info.serverIcon : `${server.url}${server.info.serverIcon}`)
      : null);
}
