import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InlineChatVideo } from '../InlineChatVideo';
import { formatVideoTime } from '../../../lib/chatMedia';

const SRC = 'https://cdn.example.test/uploads/clip.mp4';

let playSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // jsdom has no media pipeline: play() fires 'play' like a browser would.
  playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, get: () => false });
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, get: () => true });
    this.dispatchEvent(new Event('pause'));
  });
  window.localStorage.removeItem('catrealm.chatVideoVolumePct');
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('InlineChatVideo', () => {
  it('starts on a purple play button with no native controls and no autoplay', () => {
    const { container } = render(<InlineChatVideo src={SRC} onExpand={vi.fn()} />);
    const video = container.querySelector('video')!;
    expect(video.hasAttribute('controls')).toBe(false);
    expect(video.hasAttribute('autoplay')).toBe(false);
    const play = screen.getByRole('button', { name: 'Play video' });
    expect(play.className).toContain('rounded-full');
    // Hover reuses the composer send button's "attachment ready" pulse keyframes.
    expect(play.className).toContain('hover:[animation:sendPulse');
    expect(screen.queryByRole('button', { name: 'Fullscreen' })).toBeNull();
  });

  it('shows the Theater-style bar once playing: pause, time, volume and fullscreen', () => {
    const { container } = render(<InlineChatVideo src={SRC} onExpand={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    expect(playSpy).toHaveBeenCalledTimes(1);
    const video = container.querySelector('video')!;
    // Started by the user, so it plays with sound.
    expect(video.muted).toBe(false);

    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(screen.getByText('0:00')).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(video.muted).toBe(true);
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeTruthy();
  });

  it('keeps the media viewer reachable and hands over playback', () => {
    const onExpand = vi.fn();
    render(<InlineChatVideo src={SRC} onExpand={onExpand} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in media viewer' }));
    expect(onExpand).toHaveBeenCalledWith(expect.objectContaining({ resume: true, muted: false }));
  });

  it('shows Modify only when the caller can edit, and downloads the attachment by name', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      { ok: true, blob: async () => new Blob(['x']) } as unknown as Response,
    );
    const createUrl = vi.fn(() => 'blob:clip');
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    const onModify = vi.fn();

    const { rerender } = render(<InlineChatVideo src={SRC} downloadName="holiday.mp4" />);
    expect(screen.queryByRole('button', { name: 'Modify' })).toBeNull();

    rerender(<InlineChatVideo src={SRC} downloadName="holiday.mp4" onModify={onModify} />);
    fireEvent.click(screen.getByRole('button', { name: 'Modify' }));
    expect(onModify).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(fetchSpy).toHaveBeenCalledWith(SRC);
    await vi.waitFor(() => expect(createUrl).toHaveBeenCalled());
  });

  it('hides every control behind an NSFW cover', () => {
    render(<InlineChatVideo src={SRC} onExpand={vi.fn()} onModify={vi.fn()} hideControls />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('keeps GIF-style previews as muted loops without the play button', () => {
    const { container } = render(<InlineChatVideo src={SRC} loopMuted onExpand={vi.fn()} />);
    const video = container.querySelector('video')!;
    expect(video.hasAttribute('autoplay')).toBe(true);
    expect(video.hasAttribute('loop')).toBe(true);
    expect(video.muted).toBe(true);
    expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open in media viewer' })).toBeTruthy();
  });

  it('window fullscreen lifts the same video out of the chat list to cover the screen', () => {
    const setWindowFullscreen = vi.fn(() => Promise.resolve());
    const electron = { setWindowFullscreen, onWindowFullscreenChanged: vi.fn(() => () => {}) };
    (window as unknown as { electron?: unknown }).electron = electron;
    try {
      const { container } = render(<div style={{ transform: 'translateZ(0)' }}><InlineChatVideo src={SRC} /></div>);
      const video = container.querySelector('video')!;
      fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
      fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));

      expect(setWindowFullscreen).toHaveBeenCalledWith(true);
      // Out of the transformed row (which would trap position: fixed), same element.
      expect(container.querySelector('video')).toBeNull();
      const cover = screen.getByTestId('inline-chat-video');
      expect(cover.parentElement?.parentElement).toBe(document.body);
      expect(cover.className).toContain('fixed inset-0');
      expect(cover.querySelector('video')).toBe(video);

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(setWindowFullscreen).toHaveBeenLastCalledWith(false);
      expect(container.querySelector('video')).toBe(video);
    } finally {
      delete (window as unknown as { electron?: unknown }).electron;
    }
  });

  it('formats times like Theater', () => {
    expect(formatVideoTime(4)).toBe('0:04');
    expect(formatVideoTime(75)).toBe('1:15');
    expect(formatVideoTime(3725)).toBe('1:02:05');
    expect(formatVideoTime(NaN)).toBe('0:00');
  });
});
