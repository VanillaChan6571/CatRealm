import type { ServerEntry } from '../stores/serverStore';
import { passiveImageUrl } from './localNetworkAccess';

export function resolveServerIcon(server: ServerEntry, allowLocalNetwork = false): string | null {
  const icon = server.icon
    ?? (server.info?.serverIcon
      ? (/^https?:\/\//i.test(server.info.serverIcon) ? server.info.serverIcon : `${server.url}${server.info.serverIcon}`)
      : null);
  return passiveImageUrl(icon, allowLocalNetwork);
}
