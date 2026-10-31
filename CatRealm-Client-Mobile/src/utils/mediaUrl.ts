import { AUTH_BASE } from '@/lib/api';
import type { AccountType } from '@/types';

const ABSOLUTE_URL_RE = /^(https?:|data:|file:|blob:)/i;

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export function resolveMediaUrl(value?: string | null, baseUrl?: string | null): string | null {
  const mediaPath = value?.trim();
  if (!mediaPath) return null;
  if (ABSOLUTE_URL_RE.test(mediaPath)) return mediaPath;

  const base = trimTrailingSlash(baseUrl || AUTH_BASE);
  return mediaPath.startsWith('/') ? `${base}${mediaPath}` : `${base}/${mediaPath}`;
}

/**
 * The CatRealm default avatar Central assigns new accounts. Shown when an
 * avatar is missing or fails to load, matching desktop.
 */
export function defaultAvatarUrl(): string {
  return `${trimTrailingSlash(AUTH_BASE)}/uploads/avatars/default-v2.jpg`;
}

export function resolveAvatarUrl(
  avatar?: string | null,
  options?: {
    accountType?: AccountType | null;
    baseUrl?: string | null;
  },
): string | null {
  const mediaPath = avatar?.trim();
  if (!mediaPath) return null;
  if (ABSOLUTE_URL_RE.test(mediaPath)) return mediaPath;

  if (options?.accountType === 'local' && !options.baseUrl) return null;

  return resolveMediaUrl(mediaPath, options?.baseUrl ?? AUTH_BASE);
}
