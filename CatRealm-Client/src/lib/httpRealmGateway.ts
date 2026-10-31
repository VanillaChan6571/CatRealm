import axios from 'axios';
import { createAuthenticatedApi } from './authApi';

const gatewayBase = 'https://bridge.catrealm.app';

export function isHttpGatewayRealm(url: string | null | undefined): boolean {
  return typeof url === 'string'
    && /^https:\/\/r-[a-f0-9]{40}\.bridge\.catrealm\.app$/.test(url);
}

export function httpRealmGatewayEnabled(): boolean {
  return import.meta.env.VITE_HTTP_REALM_GATEWAY_ENABLED === 'true';
}

// Only an HTTPS page (the web app) is blocked from HTTP realms. Desktop builds
// load from http://tauri.localhost or file:// and reach HTTP realms directly.
export function httpRealmGatewayApplies(): boolean {
  return httpRealmGatewayEnabled()
    && typeof window !== 'undefined' && window.location.protocol === 'https:';
}

type GatewayAliasable = { url: string; originalHttpOrigin?: string; icon?: string };

/**
 * The synced realm list is shared by web and desktop, so one HTTP realm can be
 * listed both directly and through its gateway origin. Show one copy per
 * realm: the gateway copy on HTTPS pages, the direct copy everywhere else.
 * `renamed` maps each hidden URL to the URL that represents it; hidden entries
 * stay in the remote list because sync keeps remote members not removed here.
 */
export function selectRealmsForPlatform<T extends GatewayAliasable>(
  servers: T[], preferGateway = httpRealmGatewayApplies(),
): { servers: T[]; renamed: Map<string, string> } {
  const renamed = new Map<string, string>();
  const gatewayByOrigin = new Map<string, T>();
  for (const server of servers) {
    if (isHttpGatewayRealm(server.url) && server.originalHttpOrigin
      && !gatewayByOrigin.has(server.originalHttpOrigin)) {
      gatewayByOrigin.set(server.originalHttpOrigin, server);
    }
  }
  if (!gatewayByOrigin.size) return { servers, renamed };

  if (preferGateway) {
    const visible = servers.filter((server) => {
      if (isHttpGatewayRealm(server.url)) return true;
      const gateway = gatewayByOrigin.get(savedRealmHttpOrigin(server.url) ?? '');
      if (!gateway) return true;
      renamed.set(server.url, gateway.url);
      return false;
    });
    return { servers: visible, renamed };
  }

  const directByOrigin = new Map<string, T>();
  for (const server of servers) {
    const origin = !isHttpGatewayRealm(server.url) && savedRealmHttpOrigin(server.url);
    if (origin && !directByOrigin.has(origin)) directByOrigin.set(origin, server);
  }
  const visible: T[] = [];
  for (const server of servers) {
    const origin = isHttpGatewayRealm(server.url) ? server.originalHttpOrigin : undefined;
    if (!origin) {
      visible.push(server);
      continue;
    }
    const direct = directByOrigin.get(origin);
    if (direct) {
      renamed.set(server.url, direct.url);
      continue;
    }
    // Only the gateway copy exists (added from the web): use its realm directly.
    const icon = server.icon?.startsWith(`${server.url}/`)
      ? `${origin}${server.icon.slice(server.url.length)}` : server.icon;
    const mapped = { ...server, url: origin, originalHttpOrigin: undefined, icon };
    directByOrigin.set(origin, mapped);
    renamed.set(server.url, origin);
    visible.push(mapped);
  }
  return { servers: visible, renamed };
}

export function isHttpGatewayCandidateUrl(raw: string): boolean {
  if (typeof window === 'undefined' || window.location.protocol !== 'https:') return false;
  // Older saved IP:port entries were written with https:// before the gateway
  // existed. The gateway verifies whether they actually speak HTTP.
  return savedRealmHttpOrigin(raw) !== null;
}

export function savedRealmHttpOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    if (url.protocol === 'http:') return url.origin;
    if (url.protocol === 'https:' && url.port && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname)) {
      return `http://${url.host}`;
    }
  } catch { /* The saved address is not a URL. */ }
  return null;
}

export async function resolveHttpRealm(raw: string): Promise<{
  gatewayOrigin: string;
  realmOrigin: string;
  realmInstanceId: string;
  realmKeyFingerprint: string;
}> {
  if (!httpRealmGatewayEnabled()) throw new Error('HTTP realm gateway is not available yet.');
  const url = new URL(raw);
  if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/'
    || url.search || url.hash) throw new Error('Enter a realm HTTP address without a path.');
  const grant = await createAuthenticatedApi().post('/api/login/gateway-ticket', { realmOrigin: url.origin });
  if (typeof grant.data?.ticket !== 'string') throw new Error('Could not authorize the realm lookup.');
  const response = await axios.post(`${gatewayBase}/api/resolve`, { realmOrigin: url.origin }, {
    timeout: 12000, headers: { Authorization: `Bearer ${grant.data.ticket}` },
  });
  const result = response.data;
  if (typeof result?.gatewayOrigin !== 'string'
    || !isHttpGatewayRealm(result.gatewayOrigin)
    || result.realmOrigin !== url.origin
    || typeof result.realmInstanceId !== 'string'
    || typeof result.realmKeyFingerprint !== 'string') {
    throw new Error('Invalid HTTP realm gateway response.');
  }
  return result;
}
