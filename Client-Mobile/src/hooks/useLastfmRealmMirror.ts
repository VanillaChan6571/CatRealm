import { useEffect } from 'react';
import { createApi, createAuthenticatedApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { nowPlayingActivityText, useNowPlayingStore } from '@/stores/nowPlayingStore';
import { useServerStore } from '@/stores/serverStore';

// Realms only know activity text, so the listener's own client mirrors the
// Last.fm track into the active realm as `Listening` / "title — artist" —
// the same rule as desktop's ServerView sync. Desktop and mobile may both push
// the same value; that is harmless.
//
// Tracks what this device pushed per realm URL so it only ever clears its own
// mirror: if the user has a manual or game activity (set from desktop), mobile
// leaves the realm alone.
const pushedByRealm = new Map<string, string>();

export function useLastfmRealmMirror() {
  const userId = useAuthStore((s) => (s.user?.accountType === 'central' ? s.user.id : null));
  const hasOwnActivity = useAuthStore((s) => !!(s.user?.activityType && s.user?.activityText));
  const realmUrl = useServerStore((s) => (s.activeServerId ? s.byId(s.activeServerId)?.url ?? null : null));
  const realmToken = useServerStore((s) => (s.activeServerId ? s.byId(s.activeServerId)?.token ?? null : null));
  const track = useNowPlayingStore((s) => (userId ? s.byUserId[userId] ?? null : null));

  // Socket events only arrive on change, so seed the current track once.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    createAuthenticatedApi().get<{ nowPlaying?: unknown }>('/api/profile/me/lastfm')
      .then((res) => { if (!cancelled) useNowPlayingStore.getState().setNowPlaying(userId, res.data.nowPlaying); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!userId || !realmUrl || !realmToken) return;
    const pushed = pushedByRealm.get(realmUrl) ?? '';
    if (hasOwnActivity) {
      // The user's own activity owns the realm slot now; forget our mirror.
      pushedByRealm.delete(realmUrl);
      return;
    }
    const text = track ? nowPlayingActivityText(track) : '';
    if (text === pushed) return;
    const api = createApi(realmUrl, realmToken);
    if (text && track) {
      api.put('/api/profile/me/activity', { activityType: 'Listening', activityText: text, activityStartedAt: track.startedAt })
        .then(() => { pushedByRealm.set(realmUrl, text); })
        .catch(() => {});
    } else {
      api.delete('/api/profile/me/activity')
        .then(() => { pushedByRealm.delete(realmUrl); })
        .catch(() => {});
    }
  }, [userId, realmUrl, realmToken, hasOwnActivity, track]);
}
