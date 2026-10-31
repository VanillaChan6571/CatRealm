import { normalizeNowPlaying, nowPlayingActivityText, useNowPlayingStore } from '@/stores/nowPlayingStore';
import { mergeCentralProfileIntoProfile, normalizeProfileResponse } from '@/lib/profileNormalize';

const track = {
  title: 'Heart of Gold',
  artist: 'Buckshot',
  album: 'Indigo Child',
  imageUrl: 'https://lastfm-img.freetls.fastly.net/i/u/300x300/ac21916ea7d04136a12a4d3e47ad6e77.png',
  url: 'https://www.last.fm/music/Buckshot/_/Heart+of+Gold',
  startedAt: 1_760_600_000,
};

describe('Last.fm now playing', () => {
  it('normalizes tracks and rejects incomplete ones', () => {
    expect(normalizeNowPlaying(track)).toEqual(track);
    expect(normalizeNowPlaying({ ...track, album: '', imageUrl: 5 })).toEqual({ ...track, album: null, imageUrl: null });
    expect(normalizeNowPlaying({ ...track, title: '  ' })).toBeNull();
    expect(normalizeNowPlaying(null)).toBeNull();
  });

  it('builds the same mirror text as Central activityTextFor', () => {
    // Central: `${title} — ${artist}`.slice(0, 128).trim()
    expect(nowPlayingActivityText(track)).toBe('Heart of Gold — Buckshot');
    expect(nowPlayingActivityText({ ...track, title: 'x'.repeat(200) })).toHaveLength(128);
  });

  it('keeps Central nowPlaying when merging a realm profile', () => {
    const realm = normalizeProfileResponse({ id: 'realm-id', username: 'qos', account_type: 'central', central_id: 'central-id' });
    const central = normalizeProfileResponse({ id: 'central-id', username: 'qos', accountType: 'central', nowPlaying: track });
    expect(realm.nowPlaying).toBeNull();
    expect(mergeCentralProfileIntoProfile(realm, central).nowPlaying).toEqual(track);
  });

  it('stores updates per user and clears them', () => {
    const { setNowPlaying } = useNowPlayingStore.getState();
    setNowPlaying('u1', track);
    expect(useNowPlayingStore.getState().byUserId.u1).toEqual(track);
    const before = useNowPlayingStore.getState().byUserId;
    setNowPlaying('u1', { ...track });
    expect(useNowPlayingStore.getState().byUserId).toBe(before);
    setNowPlaying('u1', null);
    expect(useNowPlayingStore.getState().byUserId.u1).toBeNull();
  });
});
