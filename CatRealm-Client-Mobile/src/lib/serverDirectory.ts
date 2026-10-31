/**
 * Central server discovery and invite links — mirrors the desktop Home
 * "Discover" tab and InviteEmbedModal. Joining itself is serverStore.addServer.
 */
import axios from 'axios';
import { createAuthenticatedApi } from '@/lib/api';

export interface DiscoveryEntry {
  serverUrl: string;
  inviteCode: string;
  inviteUrl: string;
  serverName: string;
  serverDescription: string;
  serverIcon: string | null;
  serverBanner: string | null;
  memberCount: number;
}

export interface InviteInfo {
  code: string;
  serverUrl: string;
  serverName: string;
  serverDescription?: string;
  serverIcon?: string | null;
  serverBanner?: string | null;
  memberCount?: number;
}

const INVITE_CODE_RE = /^[A-Za-z0-9_-]{4,128}$/;

/**
 * An invite code from `catrealm.app/invite/CODE`, a bare code, or null when
 * the input is a server address instead.
 */
export function parseInviteCode(input: string): string | null {
  const value = input.trim();
  const fromLink = /\/invite\/([A-Za-z0-9_-]{4,128})(?:[/?#]|$)/.exec(value)?.[1];
  if (fromLink) return fromLink;
  // A bare code has no dots, slashes or colons; anything else is an address.
  return INVITE_CODE_RE.test(value) && !/[.:/]/.test(value) ? value : null;
}

function inviteError(error: unknown, fallback: string): Error {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 404) return new Error('That invite does not exist.');
    if (error.response?.status === 410) return new Error(error.response.data?.error || 'That invite has expired or been used up.');
    if (!error.response) return new Error('Could not reach CatRealm. Check your connection.');
  }
  return error instanceof Error && error.message ? error : new Error(fallback);
}

export async function lookupInvite(code: string): Promise<InviteInfo> {
  try {
    return (await createAuthenticatedApi().get<InviteInfo>(`/api/invites/${encodeURIComponent(code)}`)).data;
  } catch (error) {
    throw inviteError(error, 'Could not load that invite.');
  }
}

/** Accepts the invite on Central and returns the realm URL to join. */
export async function acceptInvite(code: string, fallbackServerUrl?: string): Promise<string> {
  try {
    const res = await createAuthenticatedApi().post(`/api/invites/${encodeURIComponent(code)}/accept`);
    const serverUrl = String(res.data?.serverUrl || fallbackServerUrl || '').trim();
    if (!serverUrl) throw new Error('Invite accepted, but no server address was returned.');
    return serverUrl;
  } catch (error) {
    throw inviteError(error, 'Could not accept that invite.');
  }
}

export async function fetchDiscovery(query?: string): Promise<DiscoveryEntry[]> {
  try {
    const res = await createAuthenticatedApi().get('/api/discovery', {
      params: { limit: 60, ...(query?.trim() ? { query: query.trim() } : {}) },
    });
    return Array.isArray(res.data) ? (res.data as DiscoveryEntry[]) : [];
  } catch (error) {
    if (axios.isAxiosError(error) && typeof error.response?.data?.error === 'string') {
      throw new Error(error.response.data.error);
    }
    throw new Error('Could not load discoverable servers.');
  }
}
