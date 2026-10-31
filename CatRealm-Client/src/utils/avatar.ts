import { AUTH_BASE } from '../lib/authApi';

export function resolveRoleIconUrl(icon?: string | null, base?: string | null): string | null {
  if (!icon) return null;
  if (/^https?:\/\//i.test(icon)) return icon;
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}${icon}`;
}

/**
 * The CatRealm default avatar the central server assigns new accounts
 * (DEFAULT_CENTRAL_AVATAR). Used when an avatar is missing or hasn't loaded,
 * instead of a generated third-party image keyed on the username.
 */
export function defaultAvatarUrl(): string {
  return `${(AUTH_BASE || '').replace(/\/+$/, '')}/uploads/avatars/default-v2.jpg`;
}

export function resolveAvatarUrl(
  avatar?: string | null,
  base?: string | null,
  accountType?: 'local' | 'central' | 'bot'
) {
  if (!avatar) return null;
  if (/^https?:\/\//i.test(avatar)) return avatar;

  const isRelativeUploadPath = avatar.startsWith('/uploads/');
  const authBaseNormalized = (AUTH_BASE || '').replace(/\/+$/, '');
  const baseNormalized = (base || '').replace(/\/+$/, '');
  const baseDiffersFromAuth = !!baseNormalized && baseNormalized !== authBaseNormalized;

  // Use central auth server for central accounts
  if (accountType === 'central') {
    // Central users can still have server-local profile overrides on mixed/self-hosted servers.
    // Those arrive as relative /uploads/... paths and must resolve against the active server URL.
    if (isRelativeUploadPath && baseDiffersFromAuth) {
      return `${baseNormalized}${avatar}`;
    }
    return `${AUTH_BASE}${avatar}`;
  }

  // Use provided base URL (self-hostable server) for local accounts
  if (!base) return null;
  return `${base}${avatar}`;
}
