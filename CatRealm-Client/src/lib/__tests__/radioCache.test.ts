import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RADIO_CACHE_NAME,
  clearRadioCache,
  getCachedRadioUrl,
  getRadioCacheBytes,
  saveRadioTrack,
} from '../radioCache';

const TRACK = 'https://auth.example/radio/Track.mp3';
const OLD_TRACK = 'https://auth.example/radio/OldTrack.mp3';

// Minimal in-memory stand-in for the Cache Storage API.
function installFakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (url: string) => store.get(url)?.clone(),
      put: async (url: string, res: Response) => { store.set(url, res); },
      keys: async () => [...store.keys()].map((url) => new Request(url)),
      delete: async (req: Request) => store.delete(req.url),
    };
  };
  vi.stubGlobal('caches', { open, delete: async (name: string) => stores.delete(name) });
  return stores;
}

const audioResponse = (status = 200, body = 'mp3-bytes') =>
  new Response(body, { status, headers: { 'content-length': String(body.length) } });

describe('radioCache', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:radio');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when the track is not saved', async () => {
    installFakeCaches();
    expect(await getCachedRadioUrl(TRACK)).toBeNull();
  });

  it('saves a full download and plays it back from an object URL', async () => {
    installFakeCaches();
    vi.stubGlobal('fetch', vi.fn(async () => audioResponse()));

    expect(await saveRadioTrack(TRACK)).toBe(true);
    expect(await getCachedRadioUrl(TRACK)).toBe('blob:radio');
    expect(await getRadioCacheBytes(TRACK)).toBe('mp3-bytes'.length);
  });

  it('does not download again once saved', async () => {
    installFakeCaches();
    const fetchMock = vi.fn(async () => audioResponse());
    vi.stubGlobal('fetch', fetchMock);

    await saveRadioTrack(TRACK);
    await saveRadioTrack(TRACK);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses partial or failed responses', async () => {
    const stores = installFakeCaches();
    vi.stubGlobal('fetch', vi.fn(async () => audioResponse(206)));

    expect(await saveRadioTrack(TRACK)).toBe(false);
    expect(stores.get(RADIO_CACHE_NAME)?.size ?? 0).toBe(0);
  });

  it('drops the previous track when a renamed one is saved', async () => {
    const stores = installFakeCaches();
    vi.stubGlobal('fetch', vi.fn(async () => audioResponse()));

    await saveRadioTrack(OLD_TRACK);
    await saveRadioTrack(TRACK);
    expect([...stores.get(RADIO_CACHE_NAME)!.keys()]).toEqual([TRACK]);
  });

  it('falls back to streaming when the save fails', async () => {
    installFakeCaches();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('QuotaExceededError'); }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await saveRadioTrack(TRACK)).toBe(false);
    expect(await getCachedRadioUrl(TRACK)).toBeNull();
  });

  it('clears the saved track', async () => {
    installFakeCaches();
    vi.stubGlobal('fetch', vi.fn(async () => audioResponse()));

    await saveRadioTrack(TRACK);
    await clearRadioCache();
    expect(await getCachedRadioUrl(TRACK)).toBeNull();
  });

  it('is a no-op without Cache Storage', async () => {
    vi.stubGlobal('caches', undefined);
    expect(await getCachedRadioUrl(TRACK)).toBeNull();
    expect(await saveRadioTrack(TRACK)).toBe(false);
  });
});
