import { create } from 'zustand';
import { AUTH_BASE } from './authApi';
import { useAuthStore } from '../stores/authStore';
import { clearRadioCache, getCachedRadioUrl, saveRadioTrack } from './radioCache';

// CatRealm Radio is a "live" station: the track position is derived from the
// listener's local wall clock, so everyone hears the same part at the same local
// time. With the 2h track, 03:26 local starts at 01:26:00 (time-of-day mod length).
export const RADIO_TRACK_TITLE = 'Cozy Vibes';
// Central hosts the file (see Agents-Docs/HANDOFF-Central-CatRealm-Radio.md).
// VITE_RADIO_TRACK_URL overrides it, e.g. to point at a CDN instead.
export const RADIO_TRACK_DEFAULT_PATH = '/radio/CatRealmCozyVibes.mp3';
export const RADIO_TRACK_URL: string = import.meta.env.VITE_RADIO_TRACK_URL
  || `${AUTH_BASE}${RADIO_TRACK_DEFAULT_PATH}`;
// Fallback until metadata loads; the real duration replaces it.
const RADIO_TRACK_FALLBACK_SECONDS = 7200;
// Re-seek when buffering/sleep drifts us further than this from the clock.
const RADIO_DRIFT_TOLERANCE_SECONDS = 4;
const RADIO_DRIFT_CHECK_MS = 15_000;
const RADIO_VOLUME_KEY = 'catrealm:radio-volume';
const RADIO_NIGHT_SKY_KEY = 'catrealm:radio-night-sky';
// Only save the full track for listeners who stay a while.
const RADIO_SAVE_AFTER_MS = 60_000;

export type RadioStatus = 'stopped' | 'loading' | 'playing' | 'error';

export function getRadioOffsetSeconds(now: Date, trackSeconds: number): number {
  const secondsOfDay = now.getHours() * 3600
    + now.getMinutes() * 60
    + now.getSeconds()
    + now.getMilliseconds() / 1000;
  if (!Number.isFinite(trackSeconds) || trackSeconds <= 0) return 0;
  return secondsOfDay % trackSeconds;
}

function readStoredVolume(): number {
  try {
    const raw = localStorage.getItem(RADIO_VOLUME_KEY);
    const parsed = raw == null ? NaN : Number(raw);
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, parsed));
  } catch { /* storage unavailable */ }
  return 50;
}

function readStoredNightSky(): boolean {
  try {
    return localStorage.getItem(RADIO_NIGHT_SKY_KEY) !== 'off';
  } catch { /* storage unavailable */ }
  return true;
}

type RadioState = {
  status: RadioStatus;
  volume: number;
  nightSky: boolean;
  play: () => void;
  stop: () => void;
  toggle: () => void;
  setVolume: (volume: number) => void;
  toggleNightSky: () => void;
};

let audio: HTMLAudioElement | null = null;
let driftTimer: ReturnType<typeof setInterval> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let localUrl: string | null = null;

function trackSeconds(el: HTMLAudioElement): number {
  return Number.isFinite(el.duration) && el.duration > 0 ? el.duration : RADIO_TRACK_FALLBACK_SECONDS;
}

function syncToClock(el: HTMLAudioElement) {
  const target = getRadioOffsetSeconds(new Date(), trackSeconds(el));
  if (Math.abs(el.currentTime - target) > RADIO_DRIFT_TOLERANCE_SECONDS) {
    el.currentTime = target;
  }
}

function teardown() {
  if (driftTimer) {
    clearInterval(driftTimer);
    driftTimer = null;
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio = null;
  }
  if (localUrl) {
    URL.revokeObjectURL(localUrl);
    localUrl = null;
  }
}

export const useRadioStore = create<RadioState>((set, get) => ({
  status: 'stopped',
  volume: readStoredVolume(),
  nightSky: readStoredNightSky(),

  play: () => {
    if (typeof window === 'undefined') return;
    teardown();
    const el = new Audio();
    audio = el;
    el.preload = 'metadata';
    el.loop = true;
    el.volume = get().volume / 100;
    set({ status: 'loading' });

    el.addEventListener('loadedmetadata', () => {
      if (audio !== el) return;
      el.currentTime = getRadioOffsetSeconds(new Date(), trackSeconds(el));
      el.play().catch((err) => {
        if (audio !== el) return;
        console.warn('[Radio] play() rejected:', err);
        teardown();
        set({ status: 'error' });
      });
    }, { once: true });
    el.addEventListener('playing', () => {
      if (audio === el) set({ status: 'playing' });
    });
    el.addEventListener('waiting', () => {
      if (audio === el) set({ status: 'loading' });
    });
    el.addEventListener('error', () => {
      if (audio !== el) return;
      console.warn('[Radio] stream error:', el.error?.code, el.error?.message);
      // A bad saved copy shouldn't stick: drop it so the next play streams.
      if (localUrl) void clearRadioCache();
      teardown();
      set({ status: 'error' });
    });

    driftTimer = setInterval(() => {
      if (audio === el && !el.paused) syncToClock(el);
    }, RADIO_DRIFT_CHECK_MS);

    void getCachedRadioUrl(RADIO_TRACK_URL).then((cachedUrl) => {
      if (audio !== el) {
        if (cachedUrl) URL.revokeObjectURL(cachedUrl);
        return;
      }
      localUrl = cachedUrl;
      el.src = cachedUrl ?? RADIO_TRACK_URL;
      if (!cachedUrl) {
        saveTimer = setTimeout(() => {
          saveTimer = null;
          if (audio === el) void saveRadioTrack(RADIO_TRACK_URL);
        }, RADIO_SAVE_AFTER_MS);
      }
    });
  },

  stop: () => {
    teardown();
    set({ status: 'stopped' });
  },

  toggle: () => {
    const { status, play, stop } = get();
    if (status === 'playing' || status === 'loading') stop();
    else play();
  },

  setVolume: (volume) => {
    const next = Math.max(0, Math.min(100, Math.round(volume)));
    if (audio) audio.volume = next / 100;
    try { localStorage.setItem(RADIO_VOLUME_KEY, String(next)); } catch { /* storage unavailable */ }
    set({ volume: next });
  },

  toggleNightSky: () => {
    const next = !get().nightSky;
    try { localStorage.setItem(RADIO_NIGHT_SKY_KEY, next ? 'on' : 'off'); } catch { /* storage unavailable */ }
    set({ nightSky: next });
  },
}));

export function getRadioPosition(): { current: number; total: number } | null {
  if (!audio) return null;
  return { current: audio.currentTime, total: trackSeconds(audio) };
}

// Don't keep the station playing behind the login screen.
useAuthStore.subscribe((state, prev) => {
  if (prev.user && !state.user) useRadioStore.getState().stop();
});
