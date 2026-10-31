const COMPACT_EMOTE_TOKEN_REGEX = /:(https?:\/\/[^\s:]+(?::\d{1,5})?):(?:(sticker):)?([a-z0-9_-]{1,64})(?::([a-z0-9_-]{3,128}))?:|:(?:(sticker):)?([a-z0-9_-]{1,64})(?::([a-z0-9_-]{3,128}))?:/gi;
const LEGACY_EXPRESSION_TOKEN_REGEX = /\[\[(emote|sticker):([^|\]]+)\|([^\]]+)\]\]/g;

export type ExpressionType = 'emotes' | 'anim-emotes' | 'stickers' | 'anim-stickers';

export type ExpressionItem = {
  id: string;
  name: string;
  type: ExpressionType;
  owner_id?: string;
  token_alias?: string;
  file_url: string;
  absolute_url?: string;
  variants?: Record<string, string>;
  absolute_variants?: Record<string, string>;
  mime_type: string;
  file_size: number;
  created_by: string;
  created_at: number;
};

export type ExpressionManifest = {
  emotes: ExpressionItem[];
  'anim-emotes': ExpressionItem[];
  stickers: ExpressionItem[];
  'anim-stickers': ExpressionItem[];
};

export type PickerServer = {
  url: string;
  name: string;
  icon?: string;
  token?: string;
  isCurrent: boolean;
  isPersonal?: boolean;
  isDefault?: boolean;
};

export type PickerExpressionItem = {
  expression: ExpressionItem;
  sourceUrl: string;
  key: string;
  isPersonal?: boolean;
};

export type EmoteSuggestion = {
  label: string;
  insert: string;
  previewEmoji?: string;
  previewImage?: string;
};

export const EMPTY_EXPRESSION_MANIFEST: ExpressionManifest = {
  emotes: [],
  'anim-emotes': [],
  stickers: [],
  'anim-stickers': [],
};

export const PERSONAL_PICKER_SERVER_URL = '__personal__';
export const DEFAULT_PICKER_SERVER_URL = '__default__';

export function formatPresenceStatusLabel(status?: 'online' | 'away' | 'sleeping' | 'invisible' | null): string {
  if (!status || status === 'invisible') return 'Offline';
  if (status === 'away') return 'Away';
  if (status === 'sleeping') return 'Sleeping';
  return 'Online';
}

export function presenceDotClass(status?: 'online' | 'away' | 'sleeping' | 'invisible' | null): string {
  if (!status || status === 'invisible') return 'bg-text-muted';
  if (status === 'away') return 'bg-yellow-500';
  if (status === 'sleeping') return 'bg-indigo-400';
  return 'bg-green-500';
}

export function resolveServerIcon(serverUrl: string, icon: string | null | undefined): string | undefined {
  if (!icon) return undefined;
  if (/^https?:\/\//i.test(icon)) return icon;
  return `${serverUrl}${icon}`;
}

export function hasBigIntPermission(permissions: number | undefined, bit: bigint): boolean {
  if (typeof permissions !== 'number' || !Number.isFinite(permissions)) return false;
  try {
    const normalized = Math.trunc(permissions);
    const value = normalized < 0 ? BigInt(normalized >>> 0) : BigInt(normalized);
    return (value & bit) === bit;
  } catch {
    return false;
  }
}

export function normalizeServerOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function normalizeExpressionName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 64);
}

export function normalizeTokenOwnerId(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 128);
}

export function buildCompactExpressionToken(
  kind: 'emote' | 'sticker',
  name: string,
  serverOrigin?: string | null,
  ownerId?: string | null
): string {
  const prefix = kind === 'sticker' ? 'sticker:' : '';
  const owner = normalizeTokenOwnerId(ownerId || '');
  if (serverOrigin) {
    return owner
      ? `:${serverOrigin}:${prefix}${name}:${owner}:`
      : `:${serverOrigin}:${prefix}${name}:`;
  }
  return owner ? `:${prefix}${name}:${owner}:` : `:${prefix}${name}:`;
}

export function buildExpressionToken(
  kind: 'emote' | 'sticker',
  name: string,
  _assetUrl: string,
  fromServerUrl: string,
  currentServerUrl: string | null,
  ownerId?: string | null
): string {
  const normalizedName = normalizeExpressionName(name);
  if (!normalizedName) return '';

  const fromOrigin = normalizeServerOrigin(fromServerUrl);
  const currentOrigin = normalizeServerOrigin(currentServerUrl);
  if (!fromOrigin || (currentOrigin && fromOrigin === currentOrigin)) {
    return buildCompactExpressionToken(kind, normalizedName, undefined, ownerId);
  }
  return buildCompactExpressionToken(kind, normalizedName, fromOrigin, ownerId);
}

export function sanitizeCompactEmoteTokens(
  text: string,
  currentServerUrl: string | null,
  canUseExternalEmojis: boolean,
  canUseExternalStickers: boolean
): string {
  if (!text.includes(':')) return text;

  const currentOrigin = normalizeServerOrigin(currentServerUrl);
  let output = '';
  let lastIndex = 0;
  const regex = new RegExp(COMPACT_EMOTE_TOKEN_REGEX.source, 'gi');

  for (const match of text.matchAll(regex)) {
    const idx = match.index;
    if (idx === undefined) continue;

    output += text.slice(lastIndex, idx);
    lastIndex = idx + match[0].length;

    const externalServerRaw = match[1];
    const externalKindRaw = match[2];
    const externalNameRaw = match[3];
    const externalOwnerIdRaw = match[4];
    const localKindRaw = match[5];
    const localNameRaw = match[6];
    const localOwnerIdRaw = match[7];
    const kind: 'emote' | 'sticker' = (externalKindRaw === 'sticker' || localKindRaw === 'sticker') ? 'sticker' : 'emote';
    const name = normalizeExpressionName(externalNameRaw || localNameRaw || '');
    const ownerId = normalizeTokenOwnerId(externalOwnerIdRaw || localOwnerIdRaw || '');
    if (!name) {
      output += match[0];
      continue;
    }

    const canUseExternal = kind === 'sticker' ? canUseExternalStickers : canUseExternalEmojis;
    const effectiveOwnerId = canUseExternal ? ownerId : '';

    if (externalServerRaw) {
      const origin = normalizeServerOrigin(externalServerRaw);
      if (!origin) {
        output += buildCompactExpressionToken(kind, name, undefined, effectiveOwnerId);
        continue;
      }
      if (currentOrigin && origin === currentOrigin) {
        output += buildCompactExpressionToken(kind, name, undefined, effectiveOwnerId);
        continue;
      }
      if (!canUseExternal) {
        output += buildCompactExpressionToken(kind, name);
        continue;
      }
      output += buildCompactExpressionToken(kind, name, origin, ownerId);
      continue;
    }

    output += buildCompactExpressionToken(kind, name, undefined, effectiveOwnerId);
  }

  output += text.slice(lastIndex);
  return output;
}

export function sanitizeExpressionTokens(
  text: string,
  currentServerUrl: string | null,
  canUseExternalEmojis: boolean,
  canUseExternalStickers: boolean
): string {
  if (!text.includes('[[')) return text;

  let currentOrigin: string | null = null;
  if (currentServerUrl) {
    try {
      currentOrigin = new URL(currentServerUrl).origin;
    } catch {
      currentOrigin = null;
    }
  }

  return text.replace(LEGACY_EXPRESSION_TOKEN_REGEX, (full, kindRaw, nameRaw, encodedUrlRaw) => {
    const kind = kindRaw === 'sticker' ? 'sticker' : 'emote';
    const name = String(nameRaw || '').trim() || (kind === 'sticker' ? 'sticker' : 'emote');
    const decoded = (() => {
      try {
        return decodeURIComponent(String(encodedUrlRaw || '').trim());
      } catch {
        return String(encodedUrlRaw || '').trim();
      }
    })();
    let parsed: URL | null = null;
    let path = '';
    try {
      parsed = new URL(decoded);
      path = parsed.pathname.toLowerCase();
    } catch {
      const relative = decoded.toLowerCase();
      if (relative.startsWith('/ugc/expressions/') || relative.startsWith('/uploads/expressions/')) {
        path = relative;
      } else {
        return `:${name}:`;
      }
    }
    const isExpressionAsset = path.includes('/ugc/expressions/') || path.includes('/uploads/expressions/');
    if (!isExpressionAsset) return `:${name}:`;

    if (parsed && currentOrigin && parsed.origin !== currentOrigin) {
      if (kind === 'emote' && !canUseExternalEmojis) return `:${name}:`;
      if (kind === 'sticker' && !canUseExternalStickers) return `:${name}:`;
    }

    return full;
  });
}
