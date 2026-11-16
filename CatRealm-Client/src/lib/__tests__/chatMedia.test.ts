import { describe, expect, it } from 'vitest';
import { getChatMediaKind, getViewerVideoStart, isChatVideo, viewerTypeForKind } from '../chatMedia';

describe('getChatMediaKind', () => {
  it('recognizes linked videos by extension, including query strings and fragments', () => {
    expect(getChatMediaKind('https://cdn.example.test/clip.mp4')).toBe('video');
    expect(getChatMediaKind('https://cdn.example.test/clip.WEBM?sig=abc')).toBe('video');
    expect(getChatMediaKind('https://cdn.example.test/clip.mov#t=5')).toBe('video');
    expect(getChatMediaKind('/uploads/clip.m4v')).toBe('video');
  });

  it('trusts a specific MIME type over the extension', () => {
    expect(getChatMediaKind('/uploads/abc123', 'video/mp4')).toBe('video');
    expect(getChatMediaKind('/uploads/abc123', 'video/quicktime')).toBe('video');
    expect(getChatMediaKind('/uploads/abc123.bin', 'image/png')).toBe('image');
  });

  it('treats a wildcard MIME placeholder as unknown so an mp4 is still a video', () => {
    // Viewer callers pass 'image/*' when they don't know the type.
    expect(getChatMediaKind('https://cdn.example.test/clip.mp4', 'image/*')).toBe('video');
    expect(getChatMediaKind('https://cdn.example.test/photo.png', 'image/*')).toBe('image');
    expect(getChatMediaKind('https://cdn.example.test/no-extension', 'image/*')).toBe('image');
  });

  it('does not mistake non-media URLs or host names for media', () => {
    expect(getChatMediaKind('https://mp4.example.test/watch')).toBeNull();
    expect(getChatMediaKind('https://example.test/page?file=clip.mp4')).toBeNull();
    expect(getChatMediaKind(null)).toBeNull();
    expect(isChatVideo('https://cdn.example.test/song.mp3')).toBe(false);
  });

  it('maps a kind to the viewer type used when the MIME type is unknown', () => {
    expect(viewerTypeForKind('video')).toBe('video/*');
    expect(viewerTypeForKind('image')).toBe('image/*');
    expect(viewerTypeForKind(null)).toBe('image/*');
  });
});

describe('getViewerVideoStart', () => {
  it('autoplays muted by default, never with sound on its own', () => {
    expect(getViewerVideoStart(undefined, false)).toEqual({ autoPlay: true, muted: true, startTime: 0 });
  });

  it('does not autoplay when embed autoplay is disabled, and plays with sound when started by hand', () => {
    expect(getViewerVideoStart(undefined, true)).toEqual({ autoPlay: false, muted: false, startTime: 0 });
    expect(getViewerVideoStart({ startTime: 12, resume: false, muted: false }, true))
      .toEqual({ autoPlay: false, muted: false, startTime: 12 });
  });

  it('continues an inline player the user was already playing, keeping their sound choice', () => {
    expect(getViewerVideoStart({ startTime: 7.5, resume: true, muted: false }, true))
      .toEqual({ autoPlay: true, muted: false, startTime: 7.5 });
    expect(getViewerVideoStart({ startTime: 3, resume: true, muted: true }, false))
      .toEqual({ autoPlay: true, muted: true, startTime: 3 });
  });
});
