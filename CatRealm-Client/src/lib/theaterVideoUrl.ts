import { useMemo } from 'react';

/** Use the current token when a video starts, then keep its URL stable.
 * Replacing <video src> on a role-driven token refresh discards its buffer.
 */
export function useTheaterVideoUrl(
  rawUrl: string | null | undefined,
  serverBase: string | null,
  token: string | null,
): string | null {
  return useMemo(() => {
    if (!rawUrl) return null;
    if (/^https?:\/\//i.test(rawUrl) || rawUrl.startsWith('youtube:')) return rawUrl;
    return `${serverBase ?? ''}${rawUrl}?token=${encodeURIComponent(token ?? '')}`;
    // Token rotation alone must not replace the media source mid-playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawUrl, serverBase]);
}
