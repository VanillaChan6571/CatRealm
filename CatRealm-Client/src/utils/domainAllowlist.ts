export const LOCKED_ALLOWED_DOMAINS = [
  'catrealm.app',
  'nekohosting.gg',
  'static.klipy.com',
  'static1.klipy.com',
  'static2.klipy.com',
  'youtube.com',
  'youtu.be',
  'x.com',
  'twitter.com',
  'vxtwitter.com',
  'fxtwitter.com',
  'fixupx.com',
  'fixvx.com',
  'twitch.tv',
  'kick.com',
  'iwara.tv',
  'fxiwara.seria.moe',
  'github.com',
  'reddit.com',
  'discord.com',
  'discord.gg',
  'discordapp.com',
  'instagram.com',
  'tiktok.com',
  'threads.net',
  'facebook.com',
  'fb.com',
  'bsky.app',
  'blueskyweb.xyz',
  'linkedin.com',
  'snapchat.com',
  'pinterest.com',
  'tumblr.com',
  'pixiv.net',
  'testflight.apple.com',
] as const;

const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function normalizeAllowedDomain(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let value = input.trim().toLowerCase();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).hostname;
    } catch {
      return null;
    }
  } else {
    value = value
      .replace(/^www\./i, 'www.')
      .replace(/^[*.]+/, '')
      .split(/[/?#]/, 1)[0]
      .split(':', 1)[0];
  }

  value = value.replace(/\.$/, '');
  if (!DOMAIN_RE.test(value)) return null;
  return value;
}

export function normalizeAllowedDomains(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const domains = new Set<string>();
  for (const item of input) {
    const normalized = normalizeAllowedDomain(item);
    if (normalized && !LOCKED_ALLOWED_DOMAINS.includes(normalized as typeof LOCKED_ALLOWED_DOMAINS[number])) {
      domains.add(normalized);
    }
  }
  return Array.from(domains).sort();
}

export function domainMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function isHostAllowed(host: string, customAllowedDomains: string[] = []): boolean {
  const normalizedHost = normalizeAllowedDomain(host);
  if (!normalizedHost) return false;
  return [...LOCKED_ALLOWED_DOMAINS, ...customAllowedDomains].some((domain) => domainMatches(normalizedHost, domain));
}
