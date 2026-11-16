import { describe, expect, it } from 'vitest';
import { uploadThumbnailUrl } from '../uploadThumbnail';

describe('uploadThumbnailUrl', () => {
  it('maps a chat upload to its WebP thumbnail', () => {
    expect(uploadThumbnailUrl('https://realm.example:40820/ugc/images/719fb4f8-f548.JPG'))
      .toBe('https://realm.example:40820/ugc/images/thumbs/719fb4f8-f548.webp');
    expect(uploadThumbnailUrl('/ugc/images/abc.png')).toBe('/ugc/images/thumbs/abc.webp');
  });

  it('leaves everything else alone', () => {
    expect(uploadThumbnailUrl('https://realm.example/ugc/images/thumbs/abc.webp')).toBeNull();
    expect(uploadThumbnailUrl('https://realm.example/ugc/images/abc.mp4')).toBeNull();
    expect(uploadThumbnailUrl('https://realm.example/ugc/images/abc.png?e=1&s=2')).toBeNull();
    expect(uploadThumbnailUrl('https://elsewhere.example/cover.png')).toBeNull();
    expect(uploadThumbnailUrl('blob:http://tauri.localhost/1234')).toBeNull();
  });
});
