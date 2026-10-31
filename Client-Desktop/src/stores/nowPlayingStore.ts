import { create } from 'zustand';
import type { NowPlaying } from '../types';

// Last.fm tracks keyed by Central user id. Filled from the `presence:now-playing`
// socket event (self + friends) and from Central profile fetches.
interface NowPlayingState {
  byUserId: Record<string, NowPlaying | null>;
  setNowPlaying: (userId: string, nowPlaying: unknown) => void;
}

export function normalizeNowPlaying(raw: unknown): NowPlaying | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  const title = str(value.title);
  const artist = str(value.artist);
  if (!title || !artist) return null;
  return {
    title,
    artist,
    album: str(value.album),
    imageUrl: str(value.imageUrl),
    url: str(value.url),
    startedAt: Number.isFinite(value.startedAt) ? Number(value.startedAt) : null,
  };
}

// Text mirrored into realm activity (`Listening` + this), so realm member lists
// show the track without Central access. Must match Central's activityTextFor
// (lib/lastfm.js): viewers resolve album art from Central by this exact text.
export function nowPlayingActivityText(track: NowPlaying): string {
  return `${track.title} — ${track.artist}`.slice(0, 128).trim();
}

export const useNowPlayingStore = create<NowPlayingState>((set) => ({
  byUserId: {},
  setNowPlaying: (userId, nowPlaying) => set((state) => {
    const next = normalizeNowPlaying(nowPlaying);
    const current = state.byUserId[userId] ?? null;
    if (JSON.stringify(current) === JSON.stringify(next)) return state;
    return { byUserId: { ...state.byUserId, [userId]: next } };
  }),
}));
