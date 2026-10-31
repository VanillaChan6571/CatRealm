export type RemoteAudioPlaybackOptions = {
  participantId: string;
  stream: MediaStream;
  volumePct: number;
  muted: boolean;
  outputDeviceId: string | null;
};

export type RemoteAudioPlaybackUpdate = Partial<Omit<RemoteAudioPlaybackOptions, 'participantId'>>;

export type ManagedRemoteAudioPlayback = {
  elements: HTMLAudioElement[];
  update: (update: RemoteAudioPlaybackUpdate) => void;
  tryPlay: () => void;
  destroy: () => void;
};

function clampVolumePct(volumePct: number) {
  return Math.max(0, Math.min(300, Math.round(Number.isFinite(volumePct) ? volumePct : 50)));
}

function layeredVolumes(volumePct: number) {
  const scale = clampVolumePct(volumePct) / 100;
  return [0, 1, 2].map((layer) => Math.max(0, Math.min(1, scale - layer)));
}

export async function applySinkId(element: HTMLMediaElement, deviceId: string | null) {
  const target = deviceId || 'default';
  const maybeSetSinkId = (element as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
  if (!maybeSetSinkId) return;
  try {
    await maybeSetSinkId.call(element, target);
  } catch {
    if (target !== 'default') {
      await maybeSetSinkId.call(element, 'default').catch(() => {});
    }
  }
}

export function playRemoteParticipantAudio(options: RemoteAudioPlaybackOptions): ManagedRemoteAudioPlayback {
  let stream = options.stream;
  let volumePct = clampVolumePct(options.volumePct);
  let muted = options.muted;
  let outputDeviceId = options.outputDeviceId;

  const elements = [0, 1, 2].map((layer) => {
    const element = document.createElement('audio');
    element.dataset.catrealmManagedAudio = 'remote-participant';
    element.dataset.participantId = options.participantId;
    element.dataset.volumeLayer = String(layer);
    element.autoplay = true;
    element.preload = 'auto';
    element.style.display = 'none';
    element.srcObject = stream;
    document.body.appendChild(element);
    return element;
  });

  const tryPlay = () => {
    elements.forEach((element) => {
      if (!element.isConnected) return;
      void element.play().catch(() => {});
    });
  };

  const applyState = () => {
    const volumes = layeredVolumes(volumePct);
    elements.forEach((element, layer) => {
      if (element.srcObject !== stream) element.srcObject = stream;
      const layerVolume = volumes[layer] ?? 0;
      element.volume = layerVolume;
      element.muted = muted || layerVolume <= 0;
      void applySinkId(element, outputDeviceId);
    });
    tryPlay();
  };

  const onInteract = () => tryPlay();
  window.addEventListener('pointerdown', onInteract);
  window.addEventListener('keydown', onInteract);

  applyState();

  return {
    elements,
    update(update) {
      if (update.stream) stream = update.stream;
      if (update.volumePct !== undefined) volumePct = clampVolumePct(update.volumePct);
      if (update.muted !== undefined) muted = update.muted;
      if (update.outputDeviceId !== undefined) outputDeviceId = update.outputDeviceId;
      applyState();
    },
    tryPlay,
    destroy() {
      window.removeEventListener('pointerdown', onInteract);
      window.removeEventListener('keydown', onInteract);
      elements.forEach((element) => {
        try {
          element.pause();
          element.srcObject = null;
          element.remove();
        } catch {
          // Ignore cleanup failures from already-detached elements.
        }
      });
    },
  };
}
