import { isHostAllowed } from './domainAllowlist';
import { useContentSocialStore } from '../stores/contentSocialStore';

function parseExternalUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function getExternalUrlDomain(url: string): string | null {
  const parsed = parseExternalUrl(url);
  if (!parsed) return null;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.hostname.toLowerCase();
}

export function isAllowedExternalUrl(url: string): boolean {
  const host = getExternalUrlDomain(url);
  if (!host) return false;
  return isHostAllowed(host, useContentSocialStore.getState().customAllowedDomains);
}

export function isTrustedExternalUrl(url: string): boolean {
  return isAllowedExternalUrl(url);
}

export function openProtectedExternalUrl(
  url: string,
  openModal: (name: string, data?: unknown) => void
): void {
  const domain = getExternalUrlDomain(url);
  if (!domain) return;
  if (isAllowedExternalUrl(url)) {
    void openExternalUrl(url);
    return;
  }
  openModal('externalLink', { url, domain });
}

/**
 * The desktop shell hands every window.open / off-app navigation here instead
 * of opening it itself, so the domain allowlist covers links from ad frames and
 * plain target=_blank anchors too — not just links our own handlers draw.
 */
export function subscribeDesktopLinkRequests(openModal: (name: string, data?: unknown) => void): () => void {
  const { onProtectedLinkRequest, openProtectedLink } = window.electron ?? {};
  if (!onProtectedLinkRequest || !openProtectedLink) return () => {};
  return onProtectedLinkRequest((url) => {
    const domain = getExternalUrlDomain(url);
    if (!domain) return;
    if (isAllowedExternalUrl(url)) void openProtectedLink(url).catch(() => {});
    else openModal('externalLink', { url, domain });
  });
}

export async function openExternalUrl(url: string): Promise<void> {
  const parsed = parseExternalUrl(url);
  if (!parsed) return;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;

  if (window.electron?.openExternal) {
    await window.electron.openExternal(parsed.toString());
    return;
  }

  window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
}
