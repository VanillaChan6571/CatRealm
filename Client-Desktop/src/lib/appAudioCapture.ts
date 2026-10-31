import { logVoiceDebug } from './voiceDebugConsole';

type AppAudioTrackResult =
  | {
      ok: true;
      stream: MediaStream;
      stop: () => void;
    }
  | {
      ok: false;
      reason: string;
      message?: string;
    };

type QueuedAudioChunk = {
  data: Float32Array;
  offset: number;
};

type AppAudioCaptureStopPayload = {
  code: number | null;
  signal: string | null;
  error?: string;
};

const APP_AUDIO_CAPTURE_READY_TIMEOUT_MS = 1500;
const APP_AUDIO_PROCESSOR_BUFFER_SIZE = 1024;
const APP_AUDIO_MAX_QUEUE_MS = 180;
const APP_AUDIO_TARGET_QUEUE_MS = 80;

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getAppAudioFailureMessage(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return null;
  return /\berror:/i.test(trimmed) ? trimmed : null;
}

export async function createWindowsAppAudioStream(sourceId: string): Promise<AppAudioTrackResult> {
  if (!window.electron?.startAppAudioCapture || !window.electron.onAppAudioCaptureData) {
    return { ok: false, reason: 'unavailable', message: 'Native app audio capture is unavailable.' };
  }

  let activeCaptureId: string | null = null;
  const pendingStatusMessages: Array<{ captureId: string; message: string }> = [];
  let startupFailure: string | null = null;
  let startupReady = false;
  let resolveStartupProbe: (() => void) | null = null;
  const startupProbe = new Promise<void>((resolve) => {
    resolveStartupProbe = resolve;
  });
  const handleStartupStatus = (message: string) => {
    const failure = getAppAudioFailureMessage(message);
    if (failure) {
      startupFailure = failure;
      resolveStartupProbe?.();
      return;
    }
    if (/capture started/i.test(message)) {
      startupReady = true;
      resolveStartupProbe?.();
    }
  };
  let unsubscribeStatus = window.electron.onAppAudioCaptureStatus?.((payload) => {
    if (!activeCaptureId) {
      pendingStatusMessages.push(payload);
      return;
    }
    if (payload.captureId !== activeCaptureId) return;
    handleStartupStatus(payload.message);
    logVoiceDebug('livekit', 'app audio capture status', {
      sourceId,
      captureId: activeCaptureId,
      message: payload.message,
    });
  }) ?? (() => {});

  const started = await window.electron.startAppAudioCapture({ sourceId });
  if (!started.ok) {
    unsubscribeStatus();
    return started;
  }
  activeCaptureId = started.captureId;
  let earlyStop: AppAudioCaptureStopPayload | null = null;
  let unsubscribeStartupStopped = window.electron.onAppAudioCaptureStopped?.((payload) => {
    if (payload.captureId !== started.captureId) return;
    earlyStop = {
      code: payload.code,
      signal: payload.signal,
      error: payload.error,
    };
    resolveStartupProbe?.();
  }) ?? (() => {});
  logVoiceDebug('livekit', 'app audio capture started', {
    sourceId,
    captureId: started.captureId,
    sampleRate: started.sampleRate,
    channels: started.channels,
  });
  pendingStatusMessages
    .filter((payload) => payload.captureId === started.captureId)
    .forEach((payload) => {
      logVoiceDebug('livekit', 'app audio capture status', {
        sourceId,
        captureId: started.captureId,
        message: payload.message,
      });
      handleStartupStatus(payload.message);
    });

  await Promise.race([
    startupProbe,
    wait(APP_AUDIO_CAPTURE_READY_TIMEOUT_MS),
  ]);
  const stoppedBeforeReady = earlyStop as AppAudioCaptureStopPayload | null;
  if (!startupReady && (startupFailure || stoppedBeforeReady)) {
    unsubscribeStatus();
    unsubscribeStartupStopped();
    await window.electron.stopAppAudioCapture(started.captureId);
    const detail = startupFailure
      ?? stoppedBeforeReady?.error
      ?? `helper stopped before capture initialized (code=${stoppedBeforeReady?.code ?? 'null'}, signal=${stoppedBeforeReady?.signal ?? 'null'})`;
    logVoiceDebug('livekit', 'app audio capture failed before publish', {
      sourceId,
      captureId: started.captureId,
      message: detail,
    }, 'warn');
    return {
      ok: false,
      reason: 'native-helper',
      message: `App audio capture failed: ${detail}`,
    };
  }
  unsubscribeStartupStopped();

  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    unsubscribeStatus();
    await window.electron.stopAppAudioCapture(started.captureId);
    return { ok: false, reason: 'audio-context', message: 'Web Audio is unavailable.' };
  }

  const context = new AudioContextCtor({ sampleRate: started.sampleRate });
  const destination = context.createMediaStreamDestination();
  const processor = context.createScriptProcessor(APP_AUDIO_PROCESSOR_BUFFER_SIZE, 0, started.channels);
  const silentSink = context.createGain();
  silentSink.gain.value = 0;
  const queue: QueuedAudioChunk[] = [];

  processor.onaudioprocess = (event) => {
    const outputs = Array.from({ length: started.channels }, (_unused, index) => event.outputBuffer.getChannelData(index));
    outputs.forEach((output) => output.fill(0));

    let frame = 0;
    while (frame < event.outputBuffer.length && queue.length > 0) {
      const current = queue[0];
      const availableFrames = Math.floor((current.data.length - current.offset) / started.channels);
      const framesToCopy = Math.min(event.outputBuffer.length - frame, availableFrames);
      for (let i = 0; i < framesToCopy; i += 1) {
        for (let channel = 0; channel < started.channels; channel += 1) {
          outputs[channel][frame + i] = current.data[current.offset + (i * started.channels) + channel] ?? 0;
        }
      }
      current.offset += framesToCopy * started.channels;
      frame += framesToCopy;
      if (current.offset >= current.data.length) queue.shift();
    }
  };

  processor.connect(destination);
  // Chromium can suspend a generated stream graph when the only output is a
  // MediaStreamDestination. A muted connection to the real destination keeps
  // onaudioprocess ticking without playing the captured app audio locally.
  processor.connect(silentSink);
  silentSink.connect(context.destination);
  await context.resume().catch(() => undefined);

  let stopped = false;
  let unsubscribeData = () => {};
  let unsubscribeStopped = () => {};
  let chunkCount = 0;
  let totalChunkCount = 0;
  let sampleCount = 0;
  let sumSquares = 0;
  let peak = 0;
  let lastLevelLogAt = Date.now();
  let lastDropLogAt = 0;
  const maxQueuedFrames = Math.round((started.sampleRate * APP_AUDIO_MAX_QUEUE_MS) / 1000);
  const targetQueuedFrames = Math.round((started.sampleRate * APP_AUDIO_TARGET_QUEUE_MS) / 1000);

  const getQueuedFrameCount = () => queue.reduce((total, chunk) => (
    total + Math.floor((chunk.data.length - chunk.offset) / started.channels)
  ), 0);

  const dropQueuedFrames = (framesToDrop: number) => {
    let remaining = Math.max(0, framesToDrop);
    let dropped = 0;
    while (remaining > 0 && queue.length > 0) {
      const current = queue[0];
      const availableFrames = Math.floor((current.data.length - current.offset) / started.channels);
      if (availableFrames <= remaining) {
        dropped += availableFrames;
        remaining -= availableFrames;
        queue.shift();
        continue;
      }
      current.offset += remaining * started.channels;
      dropped += remaining;
      remaining = 0;
    }
    return dropped;
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    unsubscribeData();
    unsubscribeStatus();
    unsubscribeStopped();
    processor.disconnect();
    silentSink.disconnect();
    destination.stream.getTracks().forEach((entry) => entry.stop());
    void context.close().catch(() => undefined);
    void window.electron?.stopAppAudioCapture?.(started.captureId);
  };

  unsubscribeData = window.electron.onAppAudioCaptureData((payload) => {
    if (payload.captureId !== started.captureId) return;
    const data = new Float32Array(payload.chunk);
    for (let i = 0; i < data.length; i += 1) {
      const sample = data[i] ?? 0;
      sumSquares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    chunkCount += 1;
    totalChunkCount += 1;
    sampleCount += data.length;
    const now = Date.now();
    if (now - lastLevelLogAt >= 1000) {
      const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
      const queuedFrames = getQueuedFrameCount();
      logVoiceDebug('livekit', 'app audio capture level', {
        sourceId,
        captureId: started.captureId,
        chunks: chunkCount,
        samples: sampleCount,
        rms: Number(rms.toFixed(6)),
        peak: Number(peak.toFixed(6)),
        queueDepth: queue.length,
        queuedMs: Math.round((queuedFrames / started.sampleRate) * 1000),
      });
      chunkCount = 0;
      sampleCount = 0;
      sumSquares = 0;
      peak = 0;
      lastLevelLogAt = now;
    }
    queue.push({ data, offset: 0 });
    const queuedFrames = getQueuedFrameCount();
    if (queuedFrames > maxQueuedFrames) {
      const droppedFrames = dropQueuedFrames(queuedFrames - targetQueuedFrames);
      if (now - lastDropLogAt >= 1000) {
        lastDropLogAt = now;
        logVoiceDebug('livekit', 'app audio capture dropped stale audio', {
          sourceId,
          captureId: started.captureId,
          droppedMs: Math.round((droppedFrames / started.sampleRate) * 1000),
          queuedMs: Math.round((getQueuedFrameCount() / started.sampleRate) * 1000),
          queueDepth: queue.length,
        }, 'warn');
      }
    }
  });
  unsubscribeStopped = window.electron.onAppAudioCaptureStopped((payload) => {
    if (payload.captureId !== started.captureId) return;
    logVoiceDebug('livekit', 'app audio capture stopped', {
      sourceId,
      captureId: started.captureId,
      code: payload.code,
      signal: payload.signal,
      error: payload.error,
    }, payload.error ? 'warn' : 'info');
    stop();
  });

  const [track] = destination.stream.getAudioTracks();
  track?.addEventListener('ended', stop, { once: true });
  window.setTimeout(() => {
    if (stopped || totalChunkCount > 0) return;
    logVoiceDebug('livekit', 'app audio capture no chunks', {
      sourceId,
      captureId: started.captureId,
    }, 'warn');
  }, 2500);

  return {
    ok: true,
    stream: destination.stream,
    stop,
  };
}
