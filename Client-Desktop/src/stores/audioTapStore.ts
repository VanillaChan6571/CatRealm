import { create } from 'zustand';
import { useSettingsStore } from './settingsStore';

/**
 * Cat Lab — Per-person audio tracks ("taps").
 *
 * A tap track duplicates assigned participants' voice audio to an extra output
 * device (e.g. a virtual cable OBS captures) at unity gain. The normal voice
 * mix the local user hears is untouched. Definitions persist across restarts so
 * streamer routing survives; playback itself is managed by lib/audioTapManager.
 */
export type AudioTapTrack = {
  id: string;
  name: string;
  outputDeviceId: string | null;
  memberUserIds: string[];
};

type AudioTapState = {
  tracks: AudioTapTrack[];
  /** Per-track sink assignment failures (e.g. device unplugged), keyed by track id. */
  tapErrors: Record<string, string>;
  addTrack: () => void;
  removeTrack: (id: string) => void;
  renameTrack: (id: string, name: string) => void;
  setTrackDevice: (id: string, deviceId: string | null) => void;
  toggleMember: (id: string, userId: string) => void;
  removeMember: (id: string, userId: string) => void;
  setTapError: (id: string, error: string | null) => void;
};

const STORAGE_KEY = 'catrealm.audioTaps';

function loadTracks(): AudioTapTrack[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is AudioTapTrack => !!t && typeof t.id === 'string')
      .map((t) => ({
        id: t.id,
        name: typeof t.name === 'string' ? t.name : 'Track',
        outputDeviceId: typeof t.outputDeviceId === 'string' ? t.outputDeviceId : null,
        memberUserIds: Array.isArray(t.memberUserIds)
          ? t.memberUserIds.filter((u: unknown): u is string => typeof u === 'string')
          : [],
      }));
  } catch {
    return [];
  }
}

function saveTracks(tracks: AudioTapTrack[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tracks));
  } catch {
    // Ignore quota/serialization failures; taps still work for the session.
  }
}

function createTrackId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tap-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export const useAudioTapStore = create<AudioTapState>((set, get) => ({
  tracks: loadTracks(),
  tapErrors: {},
  addTrack: () => {
    const tracks = [
      ...get().tracks,
      {
        id: createTrackId(),
        name: `Track ${get().tracks.length + 1}`,
        outputDeviceId: null,
        memberUserIds: [],
      },
    ];
    set({ tracks });
    saveTracks(tracks);
  },
  removeTrack: (id) => {
    const tracks = get().tracks.filter((t) => t.id !== id);
    const tapErrors = { ...get().tapErrors };
    delete tapErrors[id];
    set({ tracks, tapErrors });
    saveTracks(tracks);
  },
  renameTrack: (id, name) => {
    const tracks = get().tracks.map((t) => (t.id === id ? { ...t, name } : t));
    set({ tracks });
    saveTracks(tracks);
  },
  setTrackDevice: (id, deviceId) => {
    const tracks = get().tracks.map((t) => (t.id === id ? { ...t, outputDeviceId: deviceId } : t));
    const tapErrors = { ...get().tapErrors };
    delete tapErrors[id];
    set({ tracks, tapErrors });
    saveTracks(tracks);
  },
  toggleMember: (id, userId) => {
    const tracks = get().tracks.map((t) => {
      if (t.id !== id) return t;
      const has = t.memberUserIds.includes(userId);
      return {
        ...t,
        memberUserIds: has
          ? t.memberUserIds.filter((u) => u !== userId)
          : [...t.memberUserIds, userId],
      };
    });
    set({ tracks });
    saveTracks(tracks);
  },
  removeMember: (id, userId) => {
    const tracks = get().tracks.map((t) =>
      t.id === id ? { ...t, memberUserIds: t.memberUserIds.filter((u) => u !== userId) } : t
    );
    set({ tracks });
    saveTracks(tracks);
  },
  setTapError: (id, error) => {
    const current = get().tapErrors;
    if ((current[id] ?? null) === error) return;
    const tapErrors = { ...current };
    if (error === null) delete tapErrors[id];
    else tapErrors[id] = error;
    set({ tapErrors });
  },
}));

/** True when the user is assigned to at least one track that has an output device. */
export function isUserTappedIn(tracks: AudioTapTrack[], userId: string): boolean {
  return tracks.some((t) => !!t.outputDeviceId && t.memberUserIds.includes(userId));
}

/** Reactive form of isUserTappedIn that also honors the Cat Lab gate. */
export function useIsUserTapped(userId: string | null | undefined): boolean {
  const enabled = useSettingsStore((s) => s.catLabAudioTracks);
  const tracks = useAudioTapStore((s) => s.tracks);
  if (!enabled || !userId) return false;
  return isUserTappedIn(tracks, userId);
}

/** Tile border/glow classes applied to participants with a live tap. */
export const AUDIO_TAP_GLOW_CLASS =
  'border-purple-400/80 ring-2 ring-purple-400/60 shadow-[0_0_14px_rgba(168,85,247,0.55)]';
