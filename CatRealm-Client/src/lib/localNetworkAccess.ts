type PageContext = { protocol: string; hostname: string; isDesktop?: boolean };

export function isLocalNetworkHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return false;
  if (host === 'localhost' || ['.localhost', '.local', '.lan', '.home', '.internal'].some((suffix) => host.endsWith(suffix))) return true;
  if (host === '::1' || host === '::' || /^(?:fc|fd|fe[89ab])[0-9a-f]*:/i.test(host)) return true;
  if (host.startsWith('::ffff:') && host.includes('.')) return isLocalNetworkHostname(host.slice(7));
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mapped) {
    const address = (parseInt(mapped[1], 16) * 0x10000) + parseInt(mapped[2], 16);
    return isLocalNetworkHostname(`${(address >>> 24) & 255}.${(address >>> 16) & 255}.${(address >>> 8) & 255}.${address & 255}`);
  }

  const parts = host.split('.').map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return parts[0] === 0 || parts[0] === 10 || parts[0] === 127
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 169 && parts[1] === 254);
  }
  // A single-label hostname usually resolves on the user's intranet.
  return !host.includes('.') && !host.includes(':');
}

export function shouldDeferPassiveLocalNetworkRequest(url: string, page?: PageContext): boolean {
  const context = page ?? (typeof window === 'undefined' ? null : {
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    isDesktop: !!window.electron,
  });
  if (!context || context.isDesktop || context.protocol !== 'https:' || isLocalNetworkHostname(context.hostname)) {
    return false;
  }
  try {
    const target = new URL(url, `${context.protocol}//${context.hostname}/`);
    return ['http:', 'https:', 'ws:', 'wss:'].includes(target.protocol)
      && isLocalNetworkHostname(target.hostname);
  } catch {
    return false;
  }
}

export function passiveImageUrl(url: string | null | undefined, allowLocalNetwork = false): string | null {
  return url && (allowLocalNetwork || !shouldDeferPassiveLocalNetworkRequest(url)) ? url : null;
}
