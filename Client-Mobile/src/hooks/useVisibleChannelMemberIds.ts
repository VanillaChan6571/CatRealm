import { useEffect, useState } from 'react';
import { createApi } from '@/lib/api';

/**
 * Resolves the set of member ids that can actually view the given channel.
 *
 * Private channels restrict visibility via permission overwrites, so the
 * server-wide presence list (`allMembers`) over-reports who belongs in a
 * channel's member list. The server applies the real VIEW_CHANNELS check in
 * `GET /api/users?channelId=`, so we fetch that and use it as a visibility
 * filter. Mirrors the desktop client's MemberList behaviour.
 *
 * Returns `null` when there is no channel or the fetch fails — callers should
 * treat `null` as "no filter" (show everyone) so a transient error never hides
 * the member list entirely.
 */
export function useVisibleChannelMemberIds(
  channelId: string | null | undefined,
  refetchKey?: unknown,
): Set<string> | null {
  const [visibleIds, setVisibleIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!channelId) {
      setVisibleIds(null);
      return;
    }
    let cancelled = false;
    createApi()
      .get<Array<{ id: string }>>('/api/users', { params: { channelId } })
      .then((res) => {
        if (!cancelled) setVisibleIds(new Set(res.data.map((member) => member.id)));
      })
      .catch(() => {
        if (!cancelled) setVisibleIds(null);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, refetchKey]);

  return visibleIds;
}

/** Filter a member list by the visible-id set; `null` means show everyone. */
export function filterMembersByVisibleIds<T extends { id: string }>(
  members: T[],
  visibleIds: Set<string> | null,
): T[] {
  if (!visibleIds) return members;
  return members.filter((member) => visibleIds.has(member.id));
}
