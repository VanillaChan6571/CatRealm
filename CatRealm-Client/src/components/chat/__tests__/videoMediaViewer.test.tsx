import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { buildImmediateEmbed } from '../EmbedRenderers';
import { MediaViewerModal } from '../MediaViewerModal';
import { useUIStore } from '../../../stores/uiStore';

beforeEach(() => {
  // jsdom doesn't implement media playback.
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  act(() => useUIStore.getState().closeModal());
});

describe('linked video embeds', () => {
  it.each([
    'https://cdn.example.test/clip.mp4',
    'https://cdn.example.test/clip.webm?sig=1',
    'https://cdn.example.test/clip.mov',
  ])('play %s inline and expand into the media viewer, not the browser', (url) => {
    const onOpenExternalLink = vi.fn();
    const onOpenMedia = vi.fn();
    const { container } = render(buildImmediateEmbed(url, onOpenExternalLink, onOpenMedia)!);

    const video = container.querySelector('video')!;
    expect(video.getAttribute('src')).toBe(url);
    // CatRealm's own player chrome replaces the native controls; nothing autoplays.
    expect(video.hasAttribute('controls')).toBe(false);
    expect(video.hasAttribute('autoplay')).toBe(false);
    expect(screen.getByRole('button', { name: 'Play video' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open in media viewer' }));
    expect(onOpenMedia).toHaveBeenCalledWith(url, 'video', expect.objectContaining({ resume: false }));
    expect(onOpenExternalLink).not.toHaveBeenCalled();
  });

  it('keeps linked images opening as images', () => {
    const onOpenMedia = vi.fn();
    const url = 'https://cdn.example.test/photo.png';
    const { container } = render(buildImmediateEmbed(url, undefined, onOpenMedia)!);
    fireEvent.click(container.querySelector('a')!);
    expect(onOpenMedia).toHaveBeenCalledWith(url, 'image');
  });
});

describe('MediaViewerModal with videos', () => {
  const items = [
    { id: '0', url: 'https://cdn.example.test/photo.png', type: 'image/png' },
    // Callers that don't know the type pass the 'image/*' placeholder.
    { id: '1', url: 'https://cdn.example.test/clip.mp4', type: 'image/*' },
  ];

  it('shows a playable video for an mp4 even when typed as image/*, without image zoom', () => {
    act(() => useUIStore.getState().openModal('mediaViewer', { ...items[1], items, index: 1 }));
    const { container } = render(<MediaViewerModal />);

    const viewerVideo = container.querySelector('.flex-1 video')!;
    expect(viewerVideo).not.toBeNull();
    expect(viewerVideo.getAttribute('src')).toBe(items[1].url);
    expect(viewerVideo.hasAttribute('controls')).toBe(true);
    expect(container.querySelector('.flex-1 img')).toBeNull();
    expect(screen.queryByTitle('Zoom in')).toBeNull();
  });

  it('pages between images and videos with the arrow keys and closes on Escape', () => {
    act(() => useUIStore.getState().openModal('mediaViewer', { ...items[0], items, index: 0 }));
    const { container } = render(<MediaViewerModal />);
    expect(container.querySelector('.flex-1 img')?.getAttribute('src')).toBe(items[0].url);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(container.querySelector('.flex-1 video')?.getAttribute('src')).toBe(items[1].url);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUIStore.getState().activeModal).toBeNull();
  });
});
