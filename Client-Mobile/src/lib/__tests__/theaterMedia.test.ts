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
test('recognizes genuine YouTube URLs only', () => {
  expect(theaterYouTubeId('https://youtu.be/abcdefghijk')).toBe('abcdefghijk');
  expect(theaterYouTubeId('youtube:abcdefghijk')).toBe('abcdefghijk');
  expect(theaterYouTubeId('https://evil.example/?v=abcdefghijk')).toBeNull();
  expect(theaterYouTubeId('youtube:invalid')).toBeNull();
});
