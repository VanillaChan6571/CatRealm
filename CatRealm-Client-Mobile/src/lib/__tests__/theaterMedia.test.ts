import { theaterMediaSource, theaterYouTubeId } from '../theaterMedia';

const realms = [{ url: 'https://realm.example/cat', token: 'realm-token' }];
test.each([
  'https://evil.example/https://realm.example/cat/video.mp4',
  'https://realm.example.evil.example/cat/video.mp4',
  'http://realm.example/cat/video.mp4',
  'https://realm.example/catalog/video.mp4',
  'https://realm.example:444/cat/video.mp4',
])('does not send credentials to %s', (url) => {
  expect(theaterMediaSource(url, realms)).toBe(url);
});
test('uses only the matching realm credential', () => {
  expect(theaterMediaSource('https://realm.example/cat/video.mp4', realms)).toEqual({
    uri: 'https://realm.example/cat/video.mp4', headers: { Authorization: 'Bearer realm-token', 'X-CatRealm-Client': 'mobile' },
  });
  expect(theaterMediaSource('https://realm.example/cat/video.mp4', [])).toBe('https://realm.example/cat/video.mp4');
});
test('resolves a realm-relative video against the active realm', () => {
  const uri = 'https://realm.example/cat/ugc/temp-theater/channel/video.mp4';
  const headers = { Authorization: 'Bearer realm-token', 'X-CatRealm-Client': 'mobile' };
  expect(theaterMediaSource('/ugc/temp-theater/channel/video.mp4', realms, 'https://realm.example/cat')).toEqual({ uri, headers });
  expect(theaterMediaSource('/ugc/temp-theater/channel/video.mp4', realms, 'https://realm.example/cat/')).toEqual({ uri, headers });
});
test('uses the active realm rather than another joined realm for a relative video', () => {
  const joined = [...realms, { url: 'https://other.example', token: 'other-token' }];
  expect(theaterMediaSource('/ugc/video.mp4', joined, 'https://other.example')).toEqual({
    uri: 'https://other.example/ugc/video.mp4', headers: { Authorization: 'Bearer other-token', 'X-CatRealm-Client': 'mobile' },
  });
});
test.each([
  '//evil.example/video.mp4',
  'https://evil.example/video.mp4',
])('does not resolve or credential %s through the active realm', (url) => {
  expect(theaterMediaSource(url, realms, 'https://realm.example/cat')).toBe(url);
});
test('leaves a relative video unchanged when no realm is active', () => {
  expect(theaterMediaSource('/ugc/video.mp4', realms)).toBe('/ugc/video.mp4');
  expect(theaterMediaSource('/ugc/video.mp4', realms, null)).toBe('/ugc/video.mp4');
});
test('recognizes genuine YouTube URLs only', () => {
  expect(theaterYouTubeId('https://youtu.be/abcdefghijk')).toBe('abcdefghijk');
  expect(theaterYouTubeId('youtube:abcdefghijk')).toBe('abcdefghijk');
  expect(theaterYouTubeId('https://evil.example/?v=abcdefghijk')).toBeNull();
  expect(theaterYouTubeId('youtube:invalid')).toBeNull();
});
