import { Track } from 'livekit-client';
import { useAudioTapStore, type AudioTapTrack } from '../stores/audioTapStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useBlockedUsersStore } from '../stores/blockedUsersStore';
import { useMediaStore } from '../stores/mediaStore';

/**
 * Cat Lab — per-person audio tap playback engine.
 *
 * Reconciles hidden <audio> elements — one per (audio source × tap track) —
 * against the tap definitions in audioTapStore and the live audio sources in
 * mediaStore. Taps play at unity gain to the track's own output device and are
 * fully independent of the normal voice mix (which stays managed by
 * mediaPlayback.ts / mediaStore untouched).
 *
 * Unlike the main mix, a tap must NEVER fall back to the default output device
 * when sink assignment fails — that would leak the "capture" feed out of the
 * user's speakers. Failed sinks are skipped and surfaced via tapErrors.
 */

type TapElement = {
  element: HTMLAudioElement;
  stream: MediaStream;
  deviceId: string;
};

type SinkCapableAudioElement = HTMLAudioElement & {
  setSinkId?: (id: string) => Promise<void>;
};

const tapElements = new Map<string, TapElement>();
// (trackId::deviceId) combos whose setSinkId rejected; skipped until the
// track's device is changed, so a failing device can't cause a retry loop.
const failedSinks = new Set<string>();
let interactListenerAttached = false;
let selfMicStream: MediaStream | null = null;
let selfMicSourceTrack: MediaStreamTrack | null = null;
let initialized = false;

function sinkSupported() {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

function tryPlayAll() {
  tapElements.forEach(({ element }) => {
    if (!element.isConnected) return;
    void element.play().catch(() => {});
  });
}

function ensureInteractListener() {
  if (interactListenerAttached || tapElements.size === 0) return;
  interactListenerAttached = true;
  window.addEventListener('pointerdown', onInteract);
  window.addEventListener('keydown', onInteract);
}

function maybeRemoveInteractListener() {
  if (!interactListenerAttached || tapElements.size > 0) return;
  interactListenerAttached = false;
  window.removeEventListener('pointerdown', onInteract);
  window.removeEventListener('keydown', onInteract);
}

function onInteract() {
  tryPlayAll();
}

function destroyTapElement(key: string) {
  const entry = tapElements.get(key);
  if (!entry) return;
  tapElements.delete(key);
  try {
    entry.element.pause();
    entry.element.srcObject = null;
    entry.element.remove();
  } catch {
    // Ignore cleanup failures from already-detached elements.
  }
}

function getSelfMicStream(track: MediaStreamTrack | null | undefined): MediaStream | null {
  if (!track) {
    selfMicStream = null;
    selfMicSourceTrack = null;
    return null;
  }
  if (selfMicSourceTrack !== track || !selfMicStream) {
    selfMicSourceTrack = track;
    selfMicStream = new MediaStream([track]);
  }
  return selfMicStream;
}

type DesiredTap = {
  key: string;
  participantId: string;
  tapTrackId: string;
  stream: MediaStream;
  deviceId: string;
};

function computeDesiredTaps(tracks: AudioTapTrack[]): DesiredTap[] {
  const media = useMediaStore.getState();
  const isBlocked = useBlockedUsersStore.getState().isBlocked;
  const liveTracks = tracks.filter((t) => !!t.outputDeviceId && t.memberUserIds.length > 0);
  if (liveTracks.length === 0) return [];

  type AudioSource = { sourceKey: string; participantId: string; stream: MediaStream };
  const sources: AudioSource[] = [];

  for (const [trackKey, remote] of Object.entries(media.remoteTracks)) {
    if (remote.kind !== 'audio') continue;
    if (remote.source === Track.Source.ScreenShareAudio) continue;
    if (!remote.mediaStream) continue;
    if (isBlocked(remote.participantId)) continue;
    sources.push({ sourceKey: trackKey, participantId: remote.participantId, stream: remote.mediaStream });
  }

  const session = media.activeSession;
  if (session?.identity) {
    const stream = getSelfMicStream(session.localMicrophoneTrack);
    if (stream) {
      sources.push({ sourceKey: 'self-microphone', participantId: session.identity, stream });
    }
  }

  const desired: DesiredTap[] = [];
  for (const tap of liveTracks) {
    const deviceId = tap.outputDeviceId as string;
    if (failedSinks.has(`${tap.id}::${deviceId}`)) continue;
    for (const source of sources) {
      if (!tap.memberUserIds.includes(source.participantId)) continue;
      desired.push({
        key: `${source.sourceKey}::${tap.id}`,
        participantId: source.participantId,
        tapTrackId: tap.id,
        stream: source.stream,
        deviceId,
      });
    }
  }
  return desired;
}

function createTapElement(tap: DesiredTap) {
  const element = document.createElement('audio') as SinkCapableAudioElement;
  element.dataset.catrealmManagedAudio = 'audio-tap';
  element.dataset.participantId = tap.participantId;
  element.dataset.tapTrackId = tap.tapTrackId;
  element.autoplay = true;
  element.preload = 'auto';
  element.style.display = 'none';
  element.srcObject = tap.stream;
  element.volume = 1;
  element.muted = false;
  document.body.appendChild(element);
  tapElements.set(tap.key, { element, stream: tap.stream, deviceId: tap.deviceId });

  applyTapSink(tap.key, element, tap.tapTrackId, tap.deviceId);
  void element.play().catch(() => {});
}

function applyTapSink(key: string, element: SinkCapableAudioElement, tapTrackId: string, deviceId: string) {
  if (!element.setSinkId) return;
  element.setSinkId(deviceId).then(
    () => {
      useAudioTapStore.getState().setTapError(tapTrackId, null);
    },
    () => {
      failedSinks.add(`${tapTrackId}::${deviceId}`);
      destroyTapElement(key);
      maybeRemoveInteractListener();
      useAudioTapStore.getState().setTapError(tapTrackId, deviceId);
    }
  );
}

export function reconcileAudioTaps() {
  if (typeof window === 'undefined' || !sinkSupported()) return;

  const enabled = useSettingsStore.getState().catLabAudioTracks;
  const desired = enabled ? computeDesiredTaps(useAudioTapStore.getState().tracks) : [];
  const desiredByKey = new Map(desired.map((d) => [d.key, d]));

  for (const key of Array.from(tapElements.keys())) {
    if (!desiredByKey.has(key)) destroyTapElement(key);
  }

  for (const tap of desired) {
    const existing = tapElements.get(tap.key);
    if (!existing) {
      createTapElement(tap);
      continue;
    }
    if (existing.stream !== tap.stream) {
      existing.stream = tap.stream;
      existing.element.srcObject = tap.stream;
      void existing.element.play().catch(() => {});
    }
    if (existing.deviceId !== tap.deviceId) {
      existing.deviceId = tap.deviceId;
      applyTapSink(tap.key, existing.element as SinkCapableAudioElement, tap.tapTrackId, tap.deviceId);
    }
  }

  ensureInteractListener();
  maybeRemoveInteractListener();
}

/** Forget prior sink failures for a track (e.g. after the user re-picks a device). */
export function clearFailedSinksForTrack(tapTrackId: string) {
  for (const key of Array.from(failedSinks)) {
    if (key.startsWith(`${tapTrackId}::`)) failedSinks.delete(key);
  }
}

export function initAudioTapManager() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  useMediaStore.subscribe(() => reconcileAudioTaps());
  useAudioTapStore.subscribe(() => reconcileAudioTaps());
  useBlockedUsersStore.subscribe(() => reconcileAudioTaps());

  let lastEnabled = useSettingsStore.getState().catLabAudioTracks;
  useSettingsStore.subscribe((state) => {
    if (state.catLabAudioTracks === lastEnabled) return;
    lastEnabled = state.catLabAudioTracks;
    reconcileAudioTaps();
  });

  reconcileAudioTaps();
}
