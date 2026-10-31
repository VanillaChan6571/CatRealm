/** Never attach credentials based on a substring in an untrusted media URL. */
export function theaterMediaSource(
  uri: string,
  realms: { url: string; token: string | null }[],
) {
  let target: URL;
  try { target = new URL(uri); } catch { return uri; }
  if (!['http:', 'https:'].includes(target.protocol)) return uri;
  const realm = realms.find(({ url, token }) => {
    if (!token) return false;
    try {
      const base = new URL(url);
      const path = base.pathname.replace(/\/+$/, '');
      return target.origin === base.origin
        && (target.pathname === path || target.pathname.startsWith(`${path}/`));
    } catch { return false; }
  });
  return realm ? { uri, headers: { 'X-CatRealm-Client': 'mobile', Authorization: `Bearer ${realm.token}` } } : uri;
}

export function theaterYouTubeId(url: string): string | null {
  if (/^youtube:[\w-]{11}$/.test(url)) return url.slice(8);
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const id = host === 'youtu.be' ? parsed.pathname.slice(1)
      : ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(host)
        ? parsed.searchParams.get('v') ?? parsed.pathname.match(/^\/(?:embed|shorts)\/([\w-]{11})/)?.[1]
        : null;
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}
