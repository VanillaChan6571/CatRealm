import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type PlayResult = 'ok' | 'blocked' | 'error';

let playResults: PlayResult[] = [];
const played: string[] = [];

class FakeAudio {
  volume = 1;
  src: string;
  constructor(src: string) {
    this.src = src;
  }
  addEventListener() {}
  play() {
    const result = playResults.shift() ?? 'ok';
    if (result === 'ok') {
      played.push(this.src);
      return Promise.resolve();
    }
    const name = result === 'blocked' ? 'NotAllowedError' : 'NotSupportedError';
    return Promise.reject(new DOMException('play failed', name));
  }
}

async function loadSounds() {
  vi.resetModules();
  return import('../notificationSounds');
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('playNotificationSound', () => {
  beforeEach(() => {
    playResults = [];
    played.length = 0;
    vi.stubGlobal('Audio', FakeAudio);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('plays immediately without a user gesture when autoplay is allowed', async () => {
    const { playNotificationSound } = await loadSounds();
    playNotificationSound('message-in-server', 60);
    await flush();
    expect(played).toHaveLength(1);
  });

  it('queues a blocked sound and plays it on the next user gesture', async () => {
    const { playNotificationSound } = await loadSounds();
    playResults = ['blocked'];
    playNotificationSound('dm-message-other', 60);
    await flush();
    expect(played).toHaveLength(0);

    window.dispatchEvent(new Event('pointerdown'));
    await flush();
    expect(played).toHaveLength(1);
  });

  it('falls back to the next candidate on a non-autoplay error without queueing', async () => {
    const { playNotificationSound, getSoundCandidates } = await loadSounds();
    const candidates = getSoundCandidates('message-in-server');
    expect(candidates.length).toBeGreaterThan(1);
    playResults = ['error', 'ok'];
    playNotificationSound('message-in-server', 60);
    await flush();
    expect(played).toEqual([candidates[1]]);

    window.dispatchEvent(new Event('keydown'));
    await flush();
    expect(played).toHaveLength(1);
  });
});
