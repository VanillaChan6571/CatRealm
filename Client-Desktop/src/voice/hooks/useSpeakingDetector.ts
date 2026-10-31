import { useEffect } from 'react';

export function useSpeakingDetector(
  stream: MediaStream | null,
  enabled: boolean,
  setSpeaking: (value: boolean) => void,
  onLevel?: (value: number) => void,
  mode: 'local' | 'remote' = 'local',
): void {
  useEffect(() => {
    if (
      !stream
      || !enabled
      || stream.getAudioTracks().length === 0
      || stream.getAudioTracks().every((track) => !track.enabled)
    ) {
      setSpeaking(false);
      onLevel?.(0);
      return;
    }

    const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) {
      setSpeaking(false);
      onLevel?.(0);
      return;
    }

    const ctx = new AudioCtor();
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = mode === 'local' ? 0.7 : 0.82;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    let rafId = 0;
    let stopped = false;
    let ema = 0;
    let noiseFloor = 0;
    let speaking = false;
    let aboveCount = 0;
    let belowCount = 0;
    let lastResumeAttempt = 0;

    const emaAlpha = mode === 'local' ? 0.6 : 0.42;
    const levelBoost = mode === 'local' ? 2.8 : 2.2;
    const speakOn = mode === 'local' ? 0.0016 : 0.0012;
    const speakOff = mode === 'local' ? 0.0010 : 0.00075;
    const minAboveFrames = mode === 'local' ? 2 : 3;
    const minBelowFrames = mode === 'local' ? 4 : 6;

    const tick = () => {
      if (stopped) return;
      if (ctx.state !== 'running') {
        const now = Date.now();
        if (now - lastResumeAttempt > 1000) {
          lastResumeAttempt = now;
          void ctx.resume().catch(() => {});
        }
      }

      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const x = (data[i] - 128) / 128;
        sum += x * x;
      }
      const rawRms = Math.sqrt(sum / data.length);
      const floorAlpha = speaking ? 0.01 : (mode === 'local' ? 0.08 : 0.06);
      noiseFloor = noiseFloor === 0 ? rawRms : floorAlpha * rawRms + (1 - floorAlpha) * noiseFloor;
      const gated = Math.max(0, rawRms - noiseFloor * (mode === 'local' ? 1.15 : 1.1));
      const rms = gated * levelBoost;
      ema = ema === 0 ? rms : emaAlpha * rms + (1 - emaAlpha) * ema;

      onLevel?.(ema);

      if (ema > speakOn) {
        aboveCount += 1;
        belowCount = 0;
      } else if (ema < speakOff) {
        belowCount += 1;
        aboveCount = 0;
      }

      if (!speaking && aboveCount >= minAboveFrames) {
        speaking = true;
        setSpeaking(true);
      } else if (speaking && belowCount >= minBelowFrames) {
        speaking = false;
        setSpeaking(false);
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    const resumeCtx = () => {
      if (ctx.state !== 'running') {
        void ctx.resume().catch(() => {});
      }
    };
    window.addEventListener('pointerdown', resumeCtx);
    window.addEventListener('keydown', resumeCtx);

    return () => {
      stopped = true;
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('pointerdown', resumeCtx);
      window.removeEventListener('keydown', resumeCtx);
      source.disconnect();
      analyser.disconnect();
      void ctx.close().catch(() => {});
      setSpeaking(false);
      onLevel?.(0);
    };
  }, [stream, enabled, setSpeaking, onLevel, mode]);
}
