import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTheaterVideoUrl } from '../theaterVideoUrl';

describe('theater video URL', () => {
  it('keeps the current source and buffer stable when permissions refresh the token', () => {
    const { result, rerender } = renderHook(
      ({ rawUrl, serverBase, token }) => useTheaterVideoUrl(rawUrl, serverBase, token),
      { initialProps: { rawUrl: '/api/theater/video/one', serverBase: 'https://realm.example', token: 'old' } },
    );
    expect(result.current).toBe('https://realm.example/api/theater/video/one?token=old');
    rerender({ rawUrl: '/api/theater/video/one', serverBase: 'https://realm.example', token: 'new' });
    expect(result.current).toBe('https://realm.example/api/theater/video/one?token=old');
    rerender({ rawUrl: '/api/theater/video/two', serverBase: 'https://realm.example', token: 'new' });
    expect(result.current).toBe('https://realm.example/api/theater/video/two?token=new');
  });

  it('uses the latest token when the server or video changes', () => {
    const { result, rerender } = renderHook(
      ({ rawUrl, serverBase, token }) => useTheaterVideoUrl(rawUrl, serverBase, token),
      { initialProps: { rawUrl: '/video', serverBase: 'https://first.example', token: 'old' } },
    );
    rerender({ rawUrl: '/video', serverBase: 'https://second.example', token: 'new' });
    expect(result.current).toBe('https://second.example/video?token=new');
    rerender({ rawUrl: 'youtube:abc', serverBase: 'https://second.example', token: 'new' });
    expect(result.current).toBe('youtube:abc');
  });
});
