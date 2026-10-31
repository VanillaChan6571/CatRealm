import { AUTH_BASE } from './authApi';
import { normalizeUpdateChannelCatalog } from './updateChannels';
import type { DesktopUpdateChannelCatalog } from './updateChannels';

export async function fetchDesktopUpdateChannelCatalog(signal?: AbortSignal): Promise<DesktopUpdateChannelCatalog> {
  const response = await fetch(`${AUTH_BASE}/api/desktop/update-channels`, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new Error(`Central update channel catalog returned ${response.status}`);
  }
  return normalizeUpdateChannelCatalog(await response.json());
}
