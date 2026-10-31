import { describe, it, expect } from 'vitest';
import {
  normalizeServerOrigin,
  normalizeExpressionName,
  normalizeTokenOwnerId,
  buildCompactExpressionToken,
  buildExpressionToken,
  sanitizeCompactEmoteTokens,
  sanitizeExpressionTokens,
  formatPresenceStatusLabel,
  presenceDotClass,
  hasBigIntPermission,
  resolveServerIcon,
} from '../expressions';

describe('normalizeServerOrigin', () => {
  it('extracts origin from a valid URL', () => {
    expect(normalizeServerOrigin('https://example.com/path')).toBe('https://example.com');
  });
  it('returns null for empty/null', () => {
    expect(normalizeServerOrigin(null)).toBeNull();
    expect(normalizeServerOrigin('')).toBeNull();
    expect(normalizeServerOrigin(undefined)).toBeNull();
  });
  it('rejects non-http protocols', () => {
    expect(normalizeServerOrigin('ftp://example.com')).toBeNull();
  });
});

describe('normalizeExpressionName', () => {
  it('lowercases and strips invalid characters', () => {
    expect(normalizeExpressionName('Hello World!')).toBe('helloworld');
  });
  it('preserves hyphens and underscores', () => {
    expect(normalizeExpressionName('my-emote_1')).toBe('my-emote_1');
  });
  it('truncates to 64 chars', () => {
    const long = 'a'.repeat(100);
    expect(normalizeExpressionName(long).length).toBe(64);
  });
});

describe('normalizeTokenOwnerId', () => {
  it('truncates to 128 chars', () => {
    const long = 'b'.repeat(200);
    expect(normalizeTokenOwnerId(long).length).toBe(128);
  });
});

describe('buildCompactExpressionToken', () => {
  it('builds a simple emote token', () => {
    expect(buildCompactExpressionToken('emote', 'hello')).toBe(':hello:');
  });
  it('builds a sticker token with prefix', () => {
    expect(buildCompactExpressionToken('sticker', 'wave')).toBe(':sticker:wave:');
  });
  it('includes server origin when provided', () => {
    expect(buildCompactExpressionToken('emote', 'hi', 'https://example.com')).toBe(':https://example.com:hi:');
  });
  it('includes owner id when provided', () => {
    expect(buildCompactExpressionToken('emote', 'hi', null, 'user123')).toBe(':hi:user123:');
  });
});

describe('buildExpressionToken', () => {
  it('builds a local token when from same server', () => {
    const result = buildExpressionToken('emote', 'hello', '', 'https://example.com', 'https://example.com');
    expect(result).toBe(':hello:');
  });
  it('builds an external token when from different server', () => {
    const result = buildExpressionToken('emote', 'hello', '', 'https://other.com', 'https://example.com');
    expect(result).toBe(':https://other.com:hello:');
  });
  it('returns empty string for empty name', () => {
    expect(buildExpressionToken('emote', '', '', 'https://example.com', null)).toBe('');
  });
});

describe('sanitizeCompactEmoteTokens', () => {
  it('returns text unchanged when no colons', () => {
    expect(sanitizeCompactEmoteTokens('hello world', null, true, true)).toBe('hello world');
  });
  it('strips server origin when it matches current server', () => {
    const input = ':https://example.com:emote:';
    const result = sanitizeCompactEmoteTokens(input, 'https://example.com', true, true);
    expect(result).toBe(':emote:');
  });
  it('preserves external emote when external emojis allowed', () => {
    const input = ':https://other.com:emote:';
    const result = sanitizeCompactEmoteTokens(input, 'https://example.com', true, true);
    expect(result).toBe(':https://other.com:emote:');
  });
  it('strips external emote when external emojis not allowed', () => {
    const input = ':https://other.com:emote:';
    const result = sanitizeCompactEmoteTokens(input, 'https://example.com', false, false);
    expect(result).toBe(':emote:');
  });
});

describe('sanitizeExpressionTokens', () => {
  it('returns text unchanged when no legacy tokens', () => {
    expect(sanitizeExpressionTokens('hello world', null, true, true)).toBe('hello world');
  });
});

describe('formatPresenceStatusLabel', () => {
  it('returns Online for online', () => {
    expect(formatPresenceStatusLabel('online')).toBe('Online');
  });
  it('returns Away for away', () => {
    expect(formatPresenceStatusLabel('away')).toBe('Away');
  });
  it('returns Sleeping for sleeping', () => {
    expect(formatPresenceStatusLabel('sleeping')).toBe('Sleeping');
  });
  it('returns Offline for invisible', () => {
    expect(formatPresenceStatusLabel('invisible')).toBe('Offline');
  });
  it('returns Offline for null/undefined', () => {
    expect(formatPresenceStatusLabel(null)).toBe('Offline');
    expect(formatPresenceStatusLabel(undefined)).toBe('Offline');
  });
});

describe('presenceDotClass', () => {
  it('returns green for online', () => {
    expect(presenceDotClass('online')).toBe('bg-green-500');
  });
  it('returns muted for offline', () => {
    expect(presenceDotClass(null)).toBe('bg-text-muted');
  });
});

describe('hasBigIntPermission', () => {
  it('returns true when bit is set', () => {
    expect(hasBigIntPermission(0x40000, 0x40000n)).toBe(true);
  });
  it('returns false when bit is not set', () => {
    expect(hasBigIntPermission(0, 0x40000n)).toBe(false);
  });
  it('returns false for undefined permissions', () => {
    expect(hasBigIntPermission(undefined, 0x40000n)).toBe(false);
  });
});

describe('resolveServerIcon', () => {
  it('returns undefined for falsy icon', () => {
    expect(resolveServerIcon('https://example.com', null)).toBeUndefined();
    expect(resolveServerIcon('https://example.com', undefined)).toBeUndefined();
  });
  it('returns absolute URL as-is', () => {
    expect(resolveServerIcon('https://example.com', 'https://cdn.example.com/icon.png')).toBe('https://cdn.example.com/icon.png');
  });
  it('prepends server URL to relative path', () => {
    expect(resolveServerIcon('https://example.com', '/icons/server.png')).toBe('https://example.com/icons/server.png');
  });
});
