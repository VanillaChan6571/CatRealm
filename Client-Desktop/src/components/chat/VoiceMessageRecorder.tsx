import { useState, useRef, useEffect, useCallback } from 'react';
import { AudioPlayer } from './AudioPlayer';
import { ComposerIconButton } from './ComposerActionButtons';

interface VoiceMessageRecorderProps {
  onCancel: () => void;
  onSend: (blob: Blob, waveformData: number[]) => void;
  disabled?: boolean;
}

type RecorderMode = 'idle' | 'recording' | 'paused' | 'stopped';

const BAR_COUNT = 40;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VoiceMessageRecorder({ onCancel, onSend, disabled = false }: VoiceMessageRecorderProps) {
  const [mode, setMode] = useState<RecorderMode>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [liveBarData, setLiveBarData] = useState<number[]>(Array(BAR_COUNT).fill(0));
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);
  const [capturedWaveform, setCapturedWaveform] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedElapsedRef = useRef<number>(0);
  const peakHistoryRef = useRef<number[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAnimLoop();
      if (timerRef.current) clearInterval(timerRef.current);
      mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
      if (recordedBlobUrl) URL.revokeObjectURL(recordedBlobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopAnimLoop = () => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  };

  const startAnimLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);

    const loop = () => {
      analyser.getByteFrequencyData(data);
      const sliceSize = Math.floor(data.length / BAR_COUNT);
      const bars: number[] = [];
      for (let i = 0; i < BAR_COUNT; i++) {
        let sum = 0;
        for (let j = 0; j < sliceSize; j++) {
          sum += data[i * sliceSize + j];
        }
        bars.push(sum / sliceSize / 255);
      }
      setLiveBarData(bars);

      // Track peak history for waveform capture
      const rms = Math.sqrt(bars.reduce((acc, v) => acc + v * v, 0) / bars.length);
      peakHistoryRef.current.push(rms);

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const raw = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = raw;

      const ctx = new AudioContext({ sampleRate: 48000 });
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(raw);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const recorder = new MediaRecorder(raw, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setRecordedBlob(blob);
        setRecordedBlobUrl(url);
        // Capture waveform from peak history
        const history = peakHistoryRef.current;
        if (history.length > 0) {
          const blockSize = Math.max(1, Math.floor(history.length / BAR_COUNT));
          const waveform: number[] = [];
          for (let i = 0; i < BAR_COUNT; i++) {
            const slice = history.slice(i * blockSize, (i + 1) * blockSize);
            waveform.push(slice.reduce((a, v) => a + v, 0) / (slice.length || 1));
          }
          const max = Math.max(...waveform, 0.001);
          setCapturedWaveform(waveform.map((v) => v / max));
        } else {
          setCapturedWaveform(Array(BAR_COUNT).fill(0.3));
        }
        setMode('stopped');
        stopAnimLoop();
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        audioCtxRef.current?.close();
        audioCtxRef.current = null;
      };

      recorder.start(100);
      peakHistoryRef.current = [];
      startTimeRef.current = Date.now();
      pausedElapsedRef.current = 0;
      setElapsed(0);
      setMode('recording');
      startAnimLoop();

      timerRef.current = setInterval(() => {
        setElapsed(pausedElapsedRef.current + (Date.now() - startTimeRef.current));
      }, 100);
    } catch (err) {
      setError('Microphone access denied');
      console.error('[VoiceMessageRecorder] getUserMedia failed:', err);
    }
  }, [startAnimLoop]);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      pausedElapsedRef.current += Date.now() - startTimeRef.current;
      if (timerRef.current) clearInterval(timerRef.current);
      stopAnimLoop();
      setMode('paused');
    }
  }, []);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
      startTimeRef.current = Date.now();
      setMode('recording');
      startAnimLoop();
      timerRef.current = setInterval(() => {
        setElapsed(pausedElapsedRef.current + (Date.now() - startTimeRef.current));
      }, 100);
    }
  }, [startAnimLoop]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    stopAnimLoop();
    mediaRecorderRef.current?.stop();
    // onstop handler will set mode to 'stopped'
  }, []);

  const handleSend = useCallback(() => {
    if (!recordedBlob) return;
    onSend(recordedBlob, capturedWaveform);
  }, [recordedBlob, capturedWaveform, onSend]);

  const handleCancel = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    stopAnimLoop();
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    if (recordedBlobUrl) URL.revokeObjectURL(recordedBlobUrl);
    onCancel();
  }, [recordedBlobUrl, onCancel]);

  return (
    <div className="flex items-center gap-2 w-full min-h-[44px]">
      {/* Cancel button */}
      <ComposerIconButton
        action={{ onClick: handleCancel, title: 'Cancel recording', disabled }}
        className="shrink-0 text-text-muted hover:text-danger disabled:opacity-40 transition-colors"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
        </svg>
      </ComposerIconButton>

      {/* Mic icon + timer */}
      <div className="flex items-center gap-1.5 shrink-0">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="currentColor"
          className={mode === 'recording' ? 'text-red-400 animate-pulse' : 'text-text-muted'}
        >
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z" />
        </svg>
        <span className="text-xs text-text-muted tabular-nums">{formatElapsed(elapsed)}</span>
      </div>

      {/* Waveform / Preview */}
      <div className="flex-1 min-w-0">
        {mode === 'stopped' && recordedBlobUrl ? (
          <AudioPlayer src={recordedBlobUrl} className="w-full max-w-none" />
        ) : (
          <div className="flex items-end gap-px h-8">
            {liveBarData.map((h, i) => (
              <div
                key={i}
                className={`flex-1 rounded-sm transition-all duration-75 ${
                  mode === 'recording' ? 'bg-accent' : 'bg-text-muted/30'
                }`}
                style={{ height: `${Math.max(12, h * 100)}%` }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1 shrink-0">
        {mode === 'idle' && (
          <ComposerIconButton
            action={{ onClick: startRecording, title: 'Start recording', disabled }}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-red-500 hover:bg-red-600 text-white disabled:opacity-40 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="8" />
            </svg>
          </ComposerIconButton>
        )}

        {(mode === 'recording' || mode === 'paused') && (
          <>
            <ComposerIconButton
              action={{
                onClick: mode === 'recording' ? pauseRecording : resumeRecording,
                title: mode === 'recording' ? 'Pause' : 'Resume',
                disabled,
              }}
              className="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-accent disabled:opacity-40 transition-colors"
            >
              {mode === 'recording' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </ComposerIconButton>
            <ComposerIconButton
              action={{ onClick: stopRecording, title: 'Stop', disabled }}
              className="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-danger disabled:opacity-40 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" />
              </svg>
            </ComposerIconButton>
          </>
        )}

        {mode === 'stopped' && (
          <ComposerIconButton
            action={{ onClick: handleSend, title: 'Send voice message', disabled: disabled || !recordedBlob }}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-accent hover:opacity-90 text-white disabled:opacity-40 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </ComposerIconButton>
        )}
      </div>

      {error && (
        <span className="text-xs text-danger shrink-0">{error}</span>
      )}
    </div>
  );
}
