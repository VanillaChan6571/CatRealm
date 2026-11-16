import { describe, expect, it, vi } from 'vitest';
import { getCaptionTracks, pickCaptionTrack, setYouTubeCaptions } from '../youtubeCaptions';

const english = { languageCode: 'en', kind: '', displayName: 'English' };
const englishAuto = { languageCode: 'en', kind: 'asr', displayName: 'English (auto-generated)' };
const britishEnglish = { languageCode: 'en-GB', kind: '', displayName: 'English (United Kingdom)' };
const spanish = { languageCode: 'es', kind: '', displayName: 'Spanish' };

describe('pickCaptionTrack', () => {
  it('prefers an uploaded track over an auto-generated one', () => {
    expect(pickCaptionTrack([englishAuto, english, spanish], 'en')).toBe(english);
  });

  it('falls back to the auto-generated track in the language', () => {
    expect(pickCaptionTrack([englishAuto, spanish], 'en')).toBe(englishAuto);
  });

  it('matches regional variants by base language', () => {
    expect(pickCaptionTrack([spanish, britishEnglish], 'en')).toBe(britishEnglish);
  });

  it('returns null when no track is in the language', () => {
    expect(pickCaptionTrack([spanish], 'en')).toBeNull();
    expect(pickCaptionTrack([], 'en')).toBeNull();
  });
});

describe('getCaptionTracks', () => {
  it('drops malformed entries and tolerates a missing module', () => {
    const player = { getOption: () => [english, null, { kind: 'asr' }, { languageCode: '' }] };
    expect(getCaptionTracks(player)).toEqual([english]);
    expect(getCaptionTracks({ getOption: () => undefined })).toEqual([]);
    expect(getCaptionTracks({ getOption: () => { throw new Error('no module'); } })).toEqual([]);
    expect(getCaptionTracks(null)).toEqual([]);
  });
});

describe('setYouTubeCaptions', () => {
  it('selects a track or clears it', () => {
    const setOption = vi.fn();
    setYouTubeCaptions({ setOption }, spanish);
    setYouTubeCaptions({ setOption }, null);
    expect(setOption).toHaveBeenNthCalledWith(1, 'captions', 'track', spanish);
    expect(setOption).toHaveBeenNthCalledWith(2, 'captions', 'track', {});
  });
});
