import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { AppWindow, Camera, Check, Gauge, Monitor, Play, RotateCcw, Square, Wifi, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore, type ScreenShareNativeProfile } from '../../stores/settingsStore';
import {
  captureScreenShare,
  getDesktopSources,
  getVideoDevices,
  isElectronDesktop,
  type CaptureScreenShareOptions,
} from '../../lib/desktopCapture';
import { restartAndReconnectClient } from '../../lib/clientRestart';

type WizardStep = 'streaming' | 'video' | 'internet' | 'run' | 'result';
type TestPhase = 'opening' | 'measuring' | null;
type TestMode = 'quick' | 'full';
type TestSourceKind = 'screen' | 'application' | 'device';
type TestResolution = 720 | 1080 | 1440;
type TestFps = 24 | 48 | 60;
type TestEncoder = 'catrealm' | 'chromium';
type FpsStrategy = 'adaptive-framerate' | 'adaptive-resolution' | '60' | '48' | '24';
type BitratePreset = 'quality' | 'efficiency' | 'compressed';

type ProbeResult = {
  desktop: boolean;
  nativeOk: boolean;
  nativeReason: string | null;
  chromiumHwEncode: boolean;
  requiresRestart: boolean;
  currentBackend: 'auto' | 'd3d11' | 'vulkan';
};

type Recommendation = {
  gpuEncoding: boolean;
  profile: ScreenShareNativeProfile;
  resolution: TestResolution;
  fps: TestFps;
  preset: BitratePreset;
  codec: 'h264' | 'vp8' | 'h265';
  encoderBackend: 'd3d11' | 'vulkan';
};

type TestProfile = {
  encoder: TestEncoder;
  resolution: TestResolution;
  fps: TestFps;
};

type TestSource = {
  id: string;
  name: string;
  kind: TestSourceKind;
  nativeOnly?: boolean;
};

type CurrentTest = {
  mode: TestMode;
  sourceKind: TestSourceKind;
  sourceName: string;
  index: number;
  total: number;
  profile: TestProfile;
  durationMs: number;
};

type TestResult = {
  id: string;
  mode: TestMode;
  sourceKind: TestSourceKind;
  sourceName: string;
  encoder: TestEncoder;
  resolution: TestResolution;
  fps: TestFps;
  measuredFps: number;
  width: number;
  height: number;
  verdictFps: TestFps;
  passed: boolean;
  durationMs: number;
};

type NavigatorWithConnection = Navigator & {
  connection?: {
    downlink?: number;
  };
};

const QUICK_TEST_DURATION_MS = 5000;
const FULL_TEST_DURATION_MS = 60_000;
const CAPTURE_PICKER_TIMEOUT_MS = 15_000;
const SPEED_TEST_BYTES = 2 * 1024 * 1024;
const RESOLUTION_OPTIONS: TestResolution[] = [1440, 1080, 720];
const FPS_STRATEGIES: Array<{ value: FpsStrategy; fps: TestFps | null }> = [
  { value: 'adaptive-framerate', fps: null },
  { value: 'adaptive-resolution', fps: null },
  { value: '60', fps: 60 },
  { value: '48', fps: 48 },
  { value: '24', fps: 24 },
];
const BITRATE_BASE_1440P60: Record<BitratePreset, number> = {
  quality: 18,
  efficiency: 11,
  compressed: 8,
};

function fpsTier(fps: number): TestFps {
  if (fps >= 54) return 60;
  if (fps >= 41) return 48;
  return 24;
}

function profileWidth(resolution: TestResolution) {
  return Math.round((resolution * 16) / 9);
}

function getCurrentScreenResolution(): TestResolution {
  if (typeof window === 'undefined') return 1080;
  const logicalScreenHeight = Math.max(window.screen?.height ?? 0, window.screen?.availHeight ?? 0);
  const pixelDensity = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
    ? window.devicePixelRatio
    : 1;
  const screenHeight = Math.max(logicalScreenHeight, Math.round(logicalScreenHeight * pixelDensity));
  if (screenHeight >= 1200) return 1440;
  if (screenHeight >= 900) return 1080;
  return 720;
}

function stopStreamTracks(stream: MediaStream) {
  stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // Ignore already-ended tracks.
    }
  });
}

function captureTestDebugEnabled() {
  try {
    return window.electron?.captureTestDebugEnabled?.() === true;
  } catch {
    return false;
  }
}

function logCaptureTestDebug(
  message: string,
  details?: Record<string, unknown>,
  level: VoiceDebugLogEntry['level'] = 'debug',
) {
  if (!captureTestDebugEnabled()) return;
  const entry: VoiceDebugLogEntry = {
    at: Date.now(),
    level,
    scope: 'screenshare-wizard',
    message,
    details,
  };
  window.electron?.clientDebugLog?.(entry).catch(() => {});
  if (level === 'warn') {
    console.warn('[screenshare-wizard]', message, details ?? {});
  } else if (level === 'error') {
    console.error('[screenshare-wizard]', message, details ?? {});
  } else {
    console.debug('[screenshare-wizard]', message, details ?? {});
  }
}

function desiredFpsFromStrategy(strategy: FpsStrategy): TestFps {
  if (strategy === '24') return 24;
  if (strategy === '48') return 48;
  return 60;
}

function fallbackFpsFromStrategy(strategy: FpsStrategy): TestFps | null {
  if (strategy === 'adaptive-framerate' || strategy === 'adaptive-resolution') return 48;
  return null;
}

function degradationPreferenceFromStrategy(strategy: FpsStrategy) {
  return strategy === 'adaptive-resolution' ? 'maintain-resolution' : 'maintain-framerate';
}

function encoderForSourceKind(kind: TestSourceKind, probe: ProbeResult | null): TestEncoder {
  if (!probe?.desktop) return 'chromium';
  if (kind === 'screen') return 'chromium';
  return probe.nativeOk ? 'catrealm' : 'chromium';
}

function capResolutionForEncoder(encoder: TestEncoder, resolution: TestResolution): TestResolution {
  if (encoder === 'chromium' && resolution > 1080) return 1080;
  return resolution;
}

function lowerResolution(resolution: TestResolution): TestResolution | null {
  if (resolution === 1440) return 1080;
  if (resolution === 1080) return 720;
  return null;
}

function requiredUploadMbps(resolution: TestResolution, fps: TestFps, preset: BitratePreset) {
  const resolutionScale = (resolution / 1440) ** 2;
  const fpsScale = fps / 60;
  return Math.round(BITRATE_BASE_1440P60[preset] * resolutionScale * fpsScale * 10) / 10;
}

function pickPresetForUpload(uploadMbps: number | null, resolution: TestResolution, fps: TestFps): BitratePreset {
  if (uploadMbps === null) return 'efficiency';
  if (uploadMbps >= requiredUploadMbps(resolution, fps, 'quality') * 1.25) return 'quality';
  if (uploadMbps >= requiredUploadMbps(resolution, fps, 'efficiency') * 1.2) return 'efficiency';
  return 'compressed';
}

function buildRecommendation({
  probe,
  sourceKind,
  desiredResolution,
  fpsStrategy,
  uploadMbps,
}: {
  probe: ProbeResult;
  sourceKind: TestSourceKind;
  desiredResolution: TestResolution;
  fpsStrategy: FpsStrategy;
  uploadMbps: number | null;
}): Recommendation {
  const primaryEncoder = encoderForSourceKind(sourceKind, probe);
  const resolution = capResolutionForEncoder(primaryEncoder, desiredResolution);
  const fps = desiredFpsFromStrategy(fpsStrategy);
  const encoderBackend: 'd3d11' | 'vulkan' = probe.currentBackend === 'vulkan'
    ? (probe.chromiumHwEncode ? 'vulkan' : 'd3d11')
    : (probe.chromiumHwEncode || probe.currentBackend !== 'd3d11' ? 'd3d11' : 'vulkan');
  return {
    gpuEncoding: primaryEncoder === 'catrealm',
    profile: 'high',
    resolution,
    fps,
    preset: pickPresetForUpload(uploadMbps, resolution, fps),
    codec: 'h264',
    encoderBackend,
  };
}

function buildFullTestProfiles(
  rec: Recommendation,
  probe: ProbeResult | null,
  desiredResolution: TestResolution,
  fpsStrategy: FpsStrategy,
): TestProfile[] {
  const primaryEncoder: TestEncoder = rec.gpuEncoding ? 'catrealm' : 'chromium';
  const encoders: TestEncoder[] = [primaryEncoder];
  if (probe?.desktop && probe.nativeOk) {
    const alternateEncoder: TestEncoder = primaryEncoder === 'catrealm' ? 'chromium' : 'catrealm';
    encoders.push(alternateEncoder);
  }

  const profiles: TestProfile[] = [];
  const addProfile = (profile: TestProfile) => {
    const exists = profiles.some((existing) => (
      existing.encoder === profile.encoder
      && existing.resolution === profile.resolution
      && existing.fps === profile.fps
    ));
    if (!exists) profiles.push(profile);
  };

  for (const encoder of encoders) {
    const resolution = capResolutionForEncoder(encoder, desiredResolution);
    const fps = desiredFpsFromStrategy(fpsStrategy);
    addProfile({ encoder, resolution, fps });
    const fallbackFps = fallbackFpsFromStrategy(fpsStrategy);
    if (fallbackFps) addProfile({ encoder, resolution, fps: fallbackFps });
    const fallbackResolution = encoder === 'catrealm' ? lowerResolution(resolution) : null;
    if (fallbackResolution) addProfile({ encoder, resolution: fallbackResolution, fps });
  }

  return profiles;
}

function resultRank(result: TestResult) {
  const encoderRank = result.encoder === 'catrealm' ? 10 : 0;
  return result.resolution * 1000 + result.verdictFps + encoderRank;
}

function pickBestResult(results: TestResult[]) {
  const sorted = [...results].sort((a, b) => resultRank(b) - resultRank(a));
  return sorted.find((result) => result.passed) ?? sorted[0] ?? null;
}

function compactSource(source: TestSource | null) {
  if (!source) return null;
  return { id: source.id, name: source.name, kind: source.kind };
}

function sourceSelectKey(kind: TestSourceKind) {
  if (kind === 'application') return 'settingsContent.ssWizardApplicationSource';
  if (kind === 'device') return 'settingsContent.ssWizardDeviceSource';
  return 'settingsContent.ssWizardTestScreen';
}

function emptySourceKey(kind: TestSourceKind) {
  if (kind === 'application') return 'settingsContent.ssWizardNoApplications';
  if (kind === 'device') return 'settingsContent.ssWizardNoDevices';
  return 'settingsContent.ssWizardLookingForScreens';
}

function encoderLabelKey(encoder: TestEncoder) {
  return encoder === 'catrealm'
    ? 'settingsContent.ssWizardEncoderBadgeCatRealm'
    : 'settingsContent.ssWizardEncoderBadgeChromium';
}

function measureFramesFromVideo(video: HTMLVideoElement) {
  const withQuality = video as HTMLVideoElement & {
    getVideoPlaybackQuality?: () => { totalVideoFrames: number };
    webkitDecodedFrameCount?: number;
  };
  return withQuality.getVideoPlaybackQuality?.().totalVideoFrames ?? withQuality.webkitDecodedFrameCount ?? 0;
}

function buildCaptureOptions(source: TestSource, profile: TestProfile): CaptureScreenShareOptions {
  const width = profileWidth(profile.resolution);
  if (source.kind === 'device') {
    return {
      kind: 'device',
      deviceId: source.id,
      width,
      height: profile.resolution,
      frameRate: profile.fps,
      includeAudio: false,
    };
  }
  return {
    kind: 'desktop',
    sourceId: source.id,
    width,
    height: profile.resolution,
    frameRate: profile.fps,
    includeAudio: false,
  };
}

function ScreenshareWizardSurface({
  onClose,
  standalone = false,
}: {
  onClose: () => void;
  standalone?: boolean;
}) {
  const { t } = useTranslation();
  const currentScreenResolution = useMemo(() => getCurrentScreenResolution(), []);
  const [step, setStep] = useState<WizardStep>('streaming');
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [screens, setScreens] = useState<TestSource[]>([]);
  const [applications, setApplications] = useState<TestSource[]>([]);
  const [devices, setDevices] = useState<TestSource[]>([]);
  const [sourceKind, setSourceKind] = useState<TestSourceKind>('application');
  const [desiredResolution, setDesiredResolution] = useState<TestResolution>(currentScreenResolution);
  const [fpsStrategy, setFpsStrategy] = useState<FpsStrategy>('adaptive-framerate');
  const [uploadMbpsInput, setUploadMbpsInput] = useState('');
  const [uploadMbps, setUploadMbps] = useState<number | null>(null);
  const [speedTestRunning, setSpeedTestRunning] = useState(false);
  const [speedTestError, setSpeedTestError] = useState<string | null>(null);
  const [speedTestEstimated, setSpeedTestEstimated] = useState(false);
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [testPhase, setTestPhase] = useState<TestPhase>(null);
  const [currentTest, setCurrentTest] = useState<CurrentTest | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [liveFps, setLiveFps] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [restartAfterApplyRequired, setRestartAfterApplyRequired] = useState(false);
  const [wizardGpus, setWizardGpus] = useState<ScreenShareGpu[]>([]);
  const screenShareGpuId = useSettingsStore((s) => s.screenShareGpuId);
  const setScreenShareGpu = useSettingsStore((s) => s.setScreenShareGpu);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);

  const stopTestStream = useCallback(() => {
    if (streamRef.current) stopStreamTracks(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    logCaptureTestDebug('capture-test:mounted', { standalone });
    return () => {
      cancelledRef.current = true;
      logCaptureTestDebug('capture-test:unmounted', { standalone });
      stopTestStream();
    };
  }, [standalone, stopTestStream]);

  useEffect(() => {
    let cancelled = false;
    window.electron?.listScreenShareGpus?.().then((result) => {
      if (!cancelled) setWizardGpus(result?.gpus ?? []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const desktop = isElectronDesktop();
      logCaptureTestDebug('probe:start', {
        desktop,
        hasElectron: Boolean(window.electron),
        hasDesktopSources: Boolean(window.electron?.getDesktopSources),
        standalone,
      });
      let nativeOk = false;
      let nativeReason: string | null = null;
      let chromiumHwEncode = false;
      let requiresRestart = false;
      let currentBackend: 'auto' | 'd3d11' | 'vulkan' = 'auto';
      if (desktop) {
        const [native, encoding] = await Promise.all([
          window.electron?.getNativeWhipPublisherSupport?.({ forceRefresh: false }).catch(() => null),
          window.electron?.getScreenShareVideoEncoding?.().catch(() => null),
        ]);
        nativeOk = !!native?.ok;
        nativeReason = native?.reason ?? (native ? null : 'native-publisher-check-failed');
        chromiumHwEncode = !!encoding?.diagnostics?.hardwareEncodeAvailable;
        requiresRestart = !!encoding?.requiresRestart;
        currentBackend = encoding?.encoderBackend ?? 'auto';
      }
      if (cancelled) return;
      setProbe({ desktop, nativeOk, nativeReason, chromiumHwEncode, requiresRestart, currentBackend });
      logCaptureTestDebug('probe:result', {
        desktop,
        nativeOk,
        nativeReason,
        chromiumHwEncode,
        requiresRestart,
        currentBackend,
      });

      const [desktopSources, videoDevices] = await Promise.all([
        desktop ? getDesktopSources().catch(() => []) : Promise.resolve([]),
        getVideoDevices({ native: desktop ? 'include' : 'skip', timeoutMs: 10_000 }).catch(() => []),
      ]);
      if (cancelled) return;

      const screenSources = desktopSources
        .filter((s) => s.id.startsWith('screen:') || s.id.startsWith('display:'))
        .map((s) => ({ id: s.id, name: s.name, kind: 'screen' as const }));
      const applicationSources = desktopSources
        .filter((s) => s.id.startsWith('window:'))
        .map((s) => ({ id: s.id, name: s.name, kind: 'application' as const }));
      const deviceSources = videoDevices
        .map((device, index) => ({
          id: device.deviceId,
          name: device.label || t('settingsContent.ssWizardUnnamedDevice', { index: index + 1 }),
          kind: 'device' as const,
          nativeOnly: device.nativeOnly === true,
        }));

      setScreens(screenSources);
      setApplications(applicationSources);
      setDevices(deviceSources);
      setSelectedScreenId((current) => current ?? screenSources[0]?.id ?? null);
      setSelectedApplicationId((current) => current ?? applicationSources[0]?.id ?? null);
      setSelectedDeviceId((current) => current ?? deviceSources[0]?.id ?? null);
      logCaptureTestDebug('sources:loaded', {
        totalDesktopSources: desktopSources.length,
        screenSources: screenSources.length,
        applicationSources: applicationSources.length,
        deviceSources: deviceSources.length,
        nativeOnlyDeviceSources: videoDevices.filter((device) => device.nativeOnly).length,
        selectedScreenId: screenSources[0]?.id ?? null,
        selectedApplicationId: applicationSources[0]?.id ?? null,
        selectedDeviceId: deviceSources[0]?.id ?? null,
      });
    })();
    return () => { cancelled = true; };
  }, [standalone, t]);

  useEffect(() => {
    if (!probe) return;
    setRec(buildRecommendation({
      probe,
      sourceKind,
      desiredResolution,
      fpsStrategy,
      uploadMbps,
    }));
  }, [desiredResolution, fpsStrategy, probe, sourceKind, uploadMbps]);

  const selectedScreen = useMemo(
    () => screens.find((source) => source.id === selectedScreenId) ?? screens[0] ?? null,
    [screens, selectedScreenId],
  );
  const selectedApplication = useMemo(
    () => applications.find((source) => source.id === selectedApplicationId) ?? applications[0] ?? null,
    [applications, selectedApplicationId],
  );
  const selectedDevice = useMemo(
    () => devices.find((source) => source.id === selectedDeviceId) ?? devices[0] ?? null,
    [devices, selectedDeviceId],
  );

  const selectedFullSource = useMemo(() => {
    if (sourceKind === 'application') return selectedApplication;
    if (sourceKind === 'device') return selectedDevice;
    return selectedScreen;
  }, [selectedApplication, selectedDevice, selectedScreen, sourceKind]);

  const sourceOptions = sourceKind === 'application'
    ? applications
    : sourceKind === 'device'
      ? devices
      : screens;
  const selectedSourceId = sourceKind === 'application'
    ? selectedApplicationId
    : sourceKind === 'device'
      ? selectedDeviceId
      : selectedScreenId;
  const setSelectedSourceId = sourceKind === 'application'
    ? setSelectedApplicationId
    : sourceKind === 'device'
      ? setSelectedDeviceId
      : setSelectedScreenId;

  const testProfiles = useMemo(
    () => (rec ? buildFullTestProfiles(rec, probe, desiredResolution, fpsStrategy) : []),
    [desiredResolution, fpsStrategy, probe, rec],
  );

  const uploadTooSlow = useMemo(() => {
    if (!rec || uploadMbps === null) return false;
    return uploadMbps < requiredUploadMbps(rec.resolution, rec.fps, 'compressed') * 1.15;
  }, [rec, uploadMbps]);

  const measureProfile = useCallback(async ({
    mode,
    source,
    profile,
    index,
    total,
    durationMs,
  }: {
    mode: TestMode;
    source: TestSource;
    profile: TestProfile;
    index: number;
    total: number;
    durationMs: number;
  }): Promise<TestResult> => {
    const width = profileWidth(profile.resolution);
    const captureOptions = buildCaptureOptions(source, profile);
    flushSync(() => {
      setCurrentTest({ mode, sourceKind: source.kind, sourceName: source.name, index, total, profile, durationMs });
      setLiveFps(null);
      setTestPhase('opening');
    });
    stopTestStream();
    logCaptureTestDebug('capture-test:run-start', {
      mode,
      source: compactSource(source),
      profile,
      width,
      height: profile.resolution,
      durationMs,
      index,
      total,
      captureOptions,
      wasCancelled: cancelledRef.current,
    });

    try {
      let captureTimedOut = false;
      const stream = await new Promise<MediaStream>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          captureTimedOut = true;
          logCaptureTestDebug('capture-test:acquire-timeout', {
            mode,
            source: compactSource(source),
            profile,
            timeoutMs: CAPTURE_PICKER_TIMEOUT_MS,
          }, 'warn');
          reject(new Error(t('settingsContent.ssWizardCapturePickerTimedOut')));
        }, CAPTURE_PICKER_TIMEOUT_MS);

        captureScreenShare(captureOptions).then((result) => {
          window.clearTimeout(timeout);
          const capturedStream = result.stream;
          if (captureTimedOut || cancelledRef.current) {
            logCaptureTestDebug('capture-test:discard-stream', {
              captureTimedOut,
              cancelled: cancelledRef.current,
              videoTracks: capturedStream.getVideoTracks().length,
              audioTracks: capturedStream.getAudioTracks().length,
            }, 'warn');
            stopStreamTracks(capturedStream);
            if (!captureTimedOut) {
              reject(new Error(t('settingsContent.ssWizardCaptureFailed')));
            }
            return;
          }
          const videoTrack = capturedStream.getVideoTracks()[0] ?? null;
          videoTrack?.addEventListener('ended', () => {
            logCaptureTestDebug('capture-test:track-ended', {
              mode,
              source: compactSource(source),
              profile,
              trackState: videoTrack.readyState,
              trackSettings: videoTrack.getSettings?.() ?? null,
            });
          }, { once: true });
          logCaptureTestDebug('capture-test:stream-acquired', {
            mode,
            source: compactSource(source),
            profile,
            videoTracks: capturedStream.getVideoTracks().length,
            audioTracks: capturedStream.getAudioTracks().length,
            audioStatus: result.audioStatus,
            trackState: videoTrack?.readyState ?? null,
            trackSettings: videoTrack?.getSettings?.() ?? null,
          });
          resolve(capturedStream);
        }).catch((error: unknown) => {
          window.clearTimeout(timeout);
          logCaptureTestDebug('capture-test:acquire-failed', {
            mode,
            source: compactSource(source),
            profile,
            error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
          }, 'error');
          reject(error);
        });
      });

      if (cancelledRef.current) {
        stopStreamTracks(stream);
        throw new Error(t('settingsContent.ssWizardCaptureCancelled'));
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error(t('settingsContent.ssWizardPreviewMissing'));
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setTestPhase('measuring');
      logCaptureTestDebug('capture-test:preview-playing', {
        mode,
        source: compactSource(source),
        profile,
        videoReadyState: video.readyState,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      });

      const startFrames = measureFramesFromVideo(video);
      const startedAt = performance.now();
      let lastFrames = startFrames;
      let lastAt = startedAt;
      await new Promise<void>((resolve) => {
        const tick = () => {
          if (cancelledRef.current) { resolve(); return; }
          const now = performance.now();
          const frames = measureFramesFromVideo(video);
          if (now - lastAt >= 900) {
            setLiveFps(Math.round(((frames - lastFrames) / (now - lastAt)) * 1000));
            lastFrames = frames;
            lastAt = now;
          }
          if (now - startedAt >= durationMs) { resolve(); return; }
          window.setTimeout(tick, 250);
        };
        tick();
      });
      if (cancelledRef.current) throw new Error(t('settingsContent.ssWizardCaptureCancelled'));

      const elapsed = performance.now() - startedAt;
      const measuredFps = ((measureFramesFromVideo(video) - startFrames) / elapsed) * 1000;
      const roundedFps = Math.round(measuredFps * 10) / 10;
      const settingsNow = stream.getVideoTracks()[0]?.getSettings() ?? {};
      const verdictFps = fpsTier(measuredFps);
      const result: TestResult = {
        id: `${Date.now()}-${mode}-${profile.encoder}-${source.kind}-${profile.resolution}-${profile.fps}`,
        mode,
        sourceKind: source.kind,
        sourceName: source.name,
        encoder: profile.encoder,
        resolution: profile.resolution,
        fps: profile.fps,
        measuredFps: roundedFps,
        width: settingsNow.width ?? video.videoWidth ?? 0,
        height: settingsNow.height ?? video.videoHeight ?? 0,
        verdictFps,
        passed: measuredFps >= profile.fps * 0.9,
        durationMs,
      };
      logCaptureTestDebug('capture-test:measured', {
        mode,
        source: compactSource(source),
        profile,
        measuredFps: roundedFps,
        verdictFps,
        passed: result.passed,
        trackSettings: settingsNow,
        elapsedMs: Math.round(elapsed),
      });
      return result;
    } finally {
      stopTestStream();
      logCaptureTestDebug('capture-test:profile-cleanup', {
        mode,
        source: compactSource(source),
        profile,
      });
    }
  }, [stopTestStream, t]);

  const finishTestSession = useCallback(() => {
    setTestRunning(false);
    setTestPhase(null);
    setCurrentTest(null);
    setLiveFps(null);
    stopTestStream();
    logCaptureTestDebug('capture-test:cleanup');
  }, [stopTestStream]);

  const startQuickTest = useCallback(async () => {
    if (!rec || !selectedScreen) {
      setTestError(t('settingsContent.ssWizardNoSourceSelected'));
      return;
    }
    const profile: TestProfile = {
      encoder: rec.gpuEncoding ? 'catrealm' : 'chromium',
      resolution: rec.resolution,
      fps: rec.fps,
    };
    cancelledRef.current = false;
    setTestRunning(true);
    setTestError(null);
    setTestResult(null);
    setTestResults([]);
    setStep('run');
    try {
      const result = await measureProfile({
        mode: 'quick',
        source: selectedScreen,
        profile,
        index: 1,
        total: 1,
        durationMs: QUICK_TEST_DURATION_MS,
      });
      setTestResults([result]);
      setTestResult(result);
      setStep('result');
    } catch (error) {
      logCaptureTestDebug('capture-test:error', {
        mode: 'quick',
        error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
      }, 'error');
      if (!cancelledRef.current) {
        setTestError(error instanceof Error ? error.message : t('settingsContent.ssWizardCaptureFailed'));
      }
    } finally {
      finishTestSession();
    }
  }, [finishTestSession, measureProfile, rec, selectedScreen, t]);

  const startFullTest = useCallback(async () => {
    if (!rec || !selectedFullSource) {
      setTestError(t('settingsContent.ssWizardNoSourceSelected'));
      return;
    }
    const profiles = buildFullTestProfiles(rec, probe, desiredResolution, fpsStrategy);
    let results: TestResult[] = [];
    cancelledRef.current = false;
    setTestRunning(true);
    setTestError(null);
    setTestResult(null);
    setTestResults([]);
    setStep('run');

    for (let index = 0; index < profiles.length; index += 1) {
      if (cancelledRef.current) break;
      const profile = profiles[index];
      try {
        const result = await measureProfile({
          mode: 'full',
          source: selectedFullSource,
          profile,
          index: index + 1,
          total: profiles.length,
          durationMs: FULL_TEST_DURATION_MS,
        });
        results = [...results, result];
        setTestResults(results);
      } catch (error) {
        logCaptureTestDebug('capture-test:profile-error', {
          mode: 'full',
          source: compactSource(selectedFullSource),
          profile,
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
        }, cancelledRef.current ? 'warn' : 'error');
        if (!cancelledRef.current) {
          setTestError(error instanceof Error ? error.message : t('settingsContent.ssWizardCaptureFailed'));
        }
      }
    }

    if (!cancelledRef.current) {
      const best = pickBestResult(results);
      if (best) {
        setTestResult(best);
        setStep('result');
      } else {
        setTestError(t('settingsContent.ssWizardCaptureFailed'));
      }
    }
    finishTestSession();
  }, [desiredResolution, finishTestSession, fpsStrategy, measureProfile, probe, rec, selectedFullSource, t]);

  const cancelTest = useCallback(() => {
    cancelledRef.current = true;
    logCaptureTestDebug('capture-test:cancel-requested', {
      currentTest,
    }, 'warn');
    finishTestSession();
  }, [currentTest, finishTestSession]);

  const runUploadSpeedTest = useCallback(async () => {
    setSpeedTestRunning(true);
    setSpeedTestError(null);
    setSpeedTestEstimated(false);
    const applyEstimate = (mbps: number, estimated: boolean) => {
      const rounded = Math.max(0.1, Math.round(mbps * 10) / 10);
      setUploadMbps(rounded);
      setUploadMbpsInput(String(rounded));
      setSpeedTestEstimated(estimated);
    };

    try {
      const startedAt = performance.now();
      const payload = new Blob([new Uint8Array(SPEED_TEST_BYTES)]);
      await fetch('https://speed.cloudflare.com/__up', {
        method: 'POST',
        body: payload,
        cache: 'no-store',
        mode: 'cors',
      });
      const elapsedSeconds = Math.max(0.1, (performance.now() - startedAt) / 1000);
      applyEstimate((SPEED_TEST_BYTES * 8) / elapsedSeconds / 1_000_000, false);
    } catch {
      const downlink = (navigator as NavigatorWithConnection).connection?.downlink;
      if (typeof downlink === 'number' && Number.isFinite(downlink) && downlink > 0) {
        applyEstimate(downlink * 0.55, true);
        setSpeedTestError(t('settingsContent.ssWizardSpeedTestEstimatedFallback'));
      } else {
        setSpeedTestError(t('settingsContent.ssWizardSpeedTestFailed'));
      }
    } finally {
      setSpeedTestRunning(false);
    }
  }, [t]);

  const applyAndFinish = useCallback(async () => {
    if (!rec) return;
    const store = useSettingsStore.getState();
    const finalGpuEncoding = testResult ? testResult.encoder === 'catrealm' : rec.gpuEncoding;
    const finalResolution = testResult?.resolution ?? rec.resolution;
    const finalFps = testResult?.verdictFps ?? rec.fps;
    setRestartAfterApplyRequired(!!probe?.desktop && (finalGpuEncoding !== store.screenShareNativeWhipEnabled || !!probe.requiresRestart));
    store.setScreenshareFps(finalFps);
    store.setScreenshareResolution(finalResolution);
    store.setScreenshareQualityPreset(rec.preset);
    store.setScreenshareCodecPreference(rec.codec);
    store.setScreenshareDegradationPreference(degradationPreferenceFromStrategy(fpsStrategy));
    store.setScreenShareNativeWhipEnabled(finalGpuEncoding);
    store.setScreenShareNativeProfile(rec.profile);
    store.setScreenShareSimulcastEnabled(true);
    if (probe?.desktop) {
      store.setScreenShareEncoderBackend(rec.encoderBackend);
      await window.electron?.setScreenShareVideoEncoding?.({
        hardwareEncoding: true,
        encoderBackend: rec.encoderBackend,
      }).catch(() => null);
    }
    store.setScreenshareWizardCompletedAt(Date.now());
    setApplied(true);
    setStep('result');
  }, [fpsStrategy, probe, rec, testResult]);

  const backendName = rec?.encoderBackend === 'vulkan' ? 'Vulkan' : 'Direct3D 11';
  const nativeReasonText = probe?.nativeReason === 'native-publisher-check-failed'
    ? t('settingsContent.ssWizardNativeCheckFailed')
    : probe?.nativeReason;
  const recommendationEncoder = rec?.gpuEncoding
    ? t('settingsContent.ssWizardEncoderBadgeCatRealm')
    : t('settingsContent.ssWizardEncoderBadgeChromium');
  const selectedWizardGpu = wizardGpus.find((gpu) => gpu.id === screenShareGpuId) ?? null;
  const resolvedWizardGpu = selectedWizardGpu ?? wizardGpus[0] ?? null;
  const wizardGpuSelectValue = selectedWizardGpu ? selectedWizardGpu.id : 'auto';
  const wizardGpuAutoLabel = wizardGpus.length === 1
    ? `${t('settingsContent.ssGpuAuto')} - ${wizardGpus[0].label}`
    : t('settingsContent.ssGpuAuto');
  const finalEncoder = testResult
    ? t(encoderLabelKey(testResult.encoder))
    : recommendationEncoder;
  const finalResolution = testResult?.resolution ?? rec?.resolution ?? 720;
  const finalFps = testResult?.verdictFps ?? rec?.fps ?? 60;
  const currentStatusText = currentTest
    ? testPhase === 'opening'
      ? t('settingsContent.ssWizardStartingSource', {
        source: currentTest.sourceName,
        resolution: currentTest.profile.resolution,
        fps: currentTest.profile.fps,
        encoder: t(encoderLabelKey(currentTest.profile.encoder)),
        current: currentTest.index,
        total: currentTest.total,
      })
      : t('settingsContent.ssWizardTestingProgress', {
        source: currentTest.sourceName,
        resolution: currentTest.profile.resolution,
        fps: currentTest.profile.fps,
        encoder: t(encoderLabelKey(currentTest.profile.encoder)),
        current: currentTest.index,
        total: currentTest.total,
        liveFps: liveFps !== null ? `${liveFps} fps` : '',
      })
    : null;

  const resolutionOptions = useMemo(
    () => [currentScreenResolution, ...RESOLUTION_OPTIONS.filter((resolution) => resolution !== currentScreenResolution)],
    [currentScreenResolution],
  );

  const sourceCards: Array<{
    kind: TestSourceKind;
    icon: typeof Monitor;
    titleKey: string;
    descKey: string;
  }> = [
    {
      kind: 'application',
      icon: AppWindow,
      titleKey: 'settingsContent.ssWizardSourceApplicationTitle',
      descKey: 'settingsContent.ssWizardSourceApplicationDesc',
    },
    {
      kind: 'screen',
      icon: Monitor,
      titleKey: 'settingsContent.ssWizardSourceScreenTitle',
      descKey: 'settingsContent.ssWizardSourceScreenDesc',
    },
    {
      kind: 'device',
      icon: Camera,
      titleKey: 'settingsContent.ssWizardSourceDeviceTitle',
      descKey: 'settingsContent.ssWizardSourceDeviceDesc',
    },
  ];

  const stepItems: Array<{ step: WizardStep; labelKey: string }> = [
    { step: 'streaming', labelKey: 'settingsContent.ssWizardStepStreamingTitle' },
    { step: 'video', labelKey: 'settingsContent.ssWizardStepVideoTitle' },
    { step: 'internet', labelKey: 'settingsContent.ssWizardStepInternetTitle' },
    { step: 'run', labelKey: 'settingsContent.ssWizardStepRunTitle' },
  ];
  const activeStepIndex = step === 'result'
    ? stepItems.length - 1
    : stepItems.findIndex((item) => item.step === step);

  const goBack = useCallback(() => {
    if (testRunning) return;
    if (step === 'video') setStep('streaming');
    else if (step === 'internet') setStep('video');
    else if (step === 'run') setStep('internet');
    else if (step === 'result') setStep('run');
  }, [step, testRunning]);

  const goNext = useCallback(() => {
    if (testRunning) return;
    if (step === 'streaming') setStep('video');
    else if (step === 'video') setStep('internet');
    else if (step === 'internet') setStep('run');
  }, [step, testRunning]);

  const canGoNext = step === 'streaming'
    ? !!probe && !!rec
    : step === 'video'
      ? !!rec
      : step === 'internet';
  const selectedSourceRequiresNativeTest = selectedFullSource?.kind === 'device' && selectedFullSource.nativeOnly === true;
  const canBeginTest = !!probe?.desktop && !!selectedFullSource && !selectedSourceRequiresNativeTest && !testRunning;
  const fullTestMinutes = testProfiles.length;
  const compressedNeed = rec ? requiredUploadMbps(rec.resolution, rec.fps, 'compressed') : 0;
  const efficiencyNeed = rec ? requiredUploadMbps(rec.resolution, rec.fps, 'efficiency') : 0;
  const qualityNeed = rec ? requiredUploadMbps(rec.resolution, rec.fps, 'quality') : 0;

  const renderStepBody = () => {
    if (step === 'streaming') {
      return (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">{t('settingsContent.ssWizardStepStreamingTitle')}</h3>
            <p className="mt-1 text-xs text-text-muted">{t('settingsContent.ssWizardStepStreamingQuestion')}</p>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            {sourceCards.map(({ kind, icon: Icon, titleKey, descKey }) => {
              const encoder = encoderForSourceKind(kind, probe);
              const checked = sourceKind === kind;
              return (
                <button
                  type="button"
                  key={kind}
                  onClick={() => setSourceKind(kind)}
                  className={`min-h-36 rounded border p-3 text-left transition-colors ${
                    checked
                      ? 'border-accent bg-accent/15'
                      : 'border-border bg-bg-input/45 hover:bg-bg-hover/60'
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <Icon size={18} aria-hidden="true" className={checked ? 'text-accent' : 'text-text-muted'} />
                    <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border ${
                      checked ? 'border-accent bg-accent text-white' : 'border-border text-transparent'
                    }`}>
                      <Check size={11} aria-hidden="true" />
                    </span>
                  </span>
                  <span className="mt-3 block text-xs font-medium text-text-primary">{t(titleKey)}</span>
                  <span className="mt-1 block text-[11px] leading-4 text-text-muted">{t(descKey)}</span>
                  <span className="mt-2 inline-flex rounded bg-bg-elevated px-2 py-0.5 text-[10px] text-text-muted">
                    {t(encoderLabelKey(encoder))}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="rounded border border-border bg-bg-input/45 p-3 text-[11px] text-text-muted">
            <p>{t('settingsContent.ssWizardStepStreamingHint')}</p>
            {!probe && <p className="mt-1 animate-pulse">{t('settingsContent.ssWizardProbing')}</p>}
            {probe && (
              <div className="mt-2 grid gap-1 sm:grid-cols-2">
                <p className={probe.nativeOk ? 'text-emerald-300' : 'text-amber-200'}>
                  {probe.nativeOk
                    ? t('settingsContent.ssWizardNativeAvailable')
                    : t('settingsContent.ssWizardNativeUnavailable', {
                      reason: nativeReasonText ? ` (${nativeReasonText})` : '',
                    })}
                </p>
                <p className={probe.chromiumHwEncode ? 'text-emerald-300' : 'text-amber-200'}>
                  {probe.chromiumHwEncode
                    ? t('settingsContent.ssWizardChromeHwActive', { backend: backendName })
                    : probe.desktop
                      ? t('settingsContent.ssWizardChromeHwInactive', { backend: backendName })
                      : t('settingsContent.ssWizardBrowserClient')}
                </p>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (step === 'video' && rec) {
      return (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">{t('settingsContent.ssWizardStepVideoTitle')}</h3>
            <p className="mt-1 text-xs text-text-muted">
              {t('settingsContent.ssWizardVideoRecommendation', { encoder: recommendationEncoder })}
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-text-primary">{t('settingsContent.ssWizardResolutionLabel')}</span>
              <select
                value={desiredResolution}
                onChange={(e) => setDesiredResolution(Number(e.target.value) as TestResolution)}
                className="w-full rounded border border-border bg-bg-input px-3 py-2 text-xs text-text-primary"
              >
                {resolutionOptions.map((resolution) => (
                  <option key={resolution} value={resolution}>
                    {resolution === currentScreenResolution
                      ? t('settingsContent.ssWizardCurrentScreenResolution', { resolution })
                      : `${resolution}p`}
                  </option>
                ))}
              </select>
            </label>

            <div className="rounded border border-border bg-bg-input/45 p-3 text-[11px] text-text-muted">
              <p className="font-medium text-text-primary">{t('settingsContent.ssWizardSelectedVideoTarget')}</p>
              <p className="mt-1">
                {t('settingsContent.ssWizardRecommendedSummary', {
                  resolution: rec.resolution,
                  fps: rec.fps,
                  encoder: recommendationEncoder,
                  preset: t(`settingsContent.${rec.preset}`),
                })}
              </p>
              {!rec.gpuEncoding && desiredResolution > rec.resolution && (
                <p className="mt-1 text-amber-200">{t('settingsContent.ssWizardChromiumResolutionCap')}</p>
              )}
            </div>
          </div>

          {rec.gpuEncoding && (
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-text-primary">{t('settingsContent.ssGpuLabel')}</label>
              <select
                value={wizardGpuSelectValue}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === 'auto') { setScreenShareGpu(null, null); return; }
                  const gpu = wizardGpus.find((g) => g.id === value);
                  setScreenShareGpu(gpu?.id ?? null, gpu?.encoder ?? null);
                }}
                className="w-full rounded border border-border bg-bg-input px-3 py-2 text-xs text-text-primary"
              >
                <option value="auto">{wizardGpuAutoLabel}</option>
                {wizardGpus.map((gpu) => (
                  <option key={gpu.id} value={gpu.id}>
                    {gpu.integrated ? `${gpu.label} ${t('settingsContent.ssGpuIntegratedTag')}` : gpu.label}
                  </option>
                ))}
              </select>
              {resolvedWizardGpu ? (
                <p className="text-[10px] text-text-muted">
                  {t('settingsContent.ssGpuUsing', { gpu: resolvedWizardGpu.label })}
                </p>
              ) : (
                <p className="text-[10px] text-text-muted">{t('settingsContent.ssGpuAutoUnavailable')}</p>
              )}
              {resolvedWizardGpu?.integrated && (
                <p className="text-[10px] text-amber-200">{t('settingsContent.ssGpuIntegratedWarning')}</p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[11px] font-medium text-text-primary">{t('settingsContent.ssWizardFpsLabel')}</p>
            <div className="grid gap-2 md:grid-cols-5">
              {FPS_STRATEGIES.map(({ value, fps }) => {
                const checked = fpsStrategy === value;
                const labelKey = value === 'adaptive-framerate'
                  ? 'settingsContent.ssWizardFpsAdaptiveFramerate'
                  : value === 'adaptive-resolution'
                    ? 'settingsContent.ssWizardFpsAdaptiveResolution'
                    : 'settingsContent.ssWizardFpsFixed';
                const descKey = value === 'adaptive-framerate'
                  ? 'settingsContent.ssWizardFpsAdaptiveFramerateDesc'
                  : value === 'adaptive-resolution'
                    ? 'settingsContent.ssWizardFpsAdaptiveResolutionDesc'
                    : 'settingsContent.ssWizardFpsFixedDesc';
                return (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setFpsStrategy(value)}
                    className={`rounded border px-3 py-2 text-left transition-colors ${
                      checked
                        ? 'border-accent bg-accent/15'
                        : 'border-border bg-bg-input/45 hover:bg-bg-hover/60'
                    }`}
                  >
                    <span className="block text-[11px] font-medium text-text-primary">
                      {t(labelKey, { fps })}
                    </span>
                    <span className="mt-1 block text-[10px] leading-4 text-text-muted">
                      {t(descKey)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      );
    }

    if (step === 'internet' && rec) {
      return (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">{t('settingsContent.ssWizardStepInternetTitle')}</h3>
            <p className="mt-1 text-xs text-text-muted">{t('settingsContent.ssWizardInternetDesc')}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-[auto_1fr]">
            <button
              type="button"
              onClick={() => { void runUploadSpeedTest(); }}
              disabled={speedTestRunning}
              className="inline-flex items-center justify-center gap-2 rounded bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
            >
              <Wifi size={14} aria-hidden="true" />
              {speedTestRunning ? t('settingsContent.ssWizardSpeedTesting') : t('settingsContent.ssWizardRunSpeedTest')}
            </button>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-text-primary">{t('settingsContent.ssWizardUploadMbpsLabel')}</span>
              <input
                value={uploadMbpsInput}
                onChange={(e) => {
                  const next = e.target.value;
                  setUploadMbpsInput(next);
                  const parsed = Number(next);
                  setUploadMbps(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
                  setSpeedTestEstimated(false);
                }}
                inputMode="decimal"
                placeholder={t('settingsContent.ssWizardUploadMbpsPlaceholder')}
                className="w-full rounded border border-border bg-bg-input px-3 py-2 text-xs text-text-primary"
              />
            </label>
          </div>

          {speedTestEstimated && (
            <p className="text-[11px] text-amber-200">{t('settingsContent.ssWizardSpeedEstimated')}</p>
          )}
          {speedTestError && (
            <p className="text-[11px] text-amber-200">{speedTestError}</p>
          )}

          <div className="rounded border border-border bg-bg-input/45 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-text-primary">
              <Gauge size={14} aria-hidden="true" />
              <span>{t('settingsContent.ssWizardPresetCheckTitle')}</span>
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              {(['compressed', 'efficiency', 'quality'] as BitratePreset[]).map((preset) => {
                const required = requiredUploadMbps(rec.resolution, rec.fps, preset);
                const ok = uploadMbps === null || uploadMbps >= required * 1.15;
                return (
                  <div key={preset} className="rounded border border-border bg-bg-elevated/60 px-2 py-1.5 text-[11px]">
                    <p className="font-medium text-text-primary">{t(`settingsContent.${preset}`)}</p>
                    <p className={ok ? 'text-text-muted' : 'text-amber-200'}>
                      {t('settingsContent.ssWizardPresetNeeds', { mbps: required })}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className={`mt-2 text-[11px] ${uploadTooSlow ? 'text-amber-200' : 'text-text-muted'}`}>
              {uploadMbps === null
                ? t('settingsContent.ssWizardNoUploadEstimate')
                : uploadTooSlow
                  ? t('settingsContent.ssWizardPresetTooSlow', { mbps: compressedNeed })
                  : t('settingsContent.ssWizardPresetSelected', {
                    preset: t(`settingsContent.${rec.preset}`),
                    upload: uploadMbps,
                  })}
            </p>
            <p className="mt-1 text-[10px] text-text-muted">
              {t('settingsContent.ssWizardSpeedManualHint', {
                compressed: compressedNeed,
                efficiency: efficiencyNeed,
                quality: qualityNeed,
              })}
            </p>
          </div>
        </div>
      );
    }

    if (step === 'run' && rec) {
      return (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">{t('settingsContent.ssWizardStepRunTitle')}</h3>
            <p className="mt-1 text-xs text-text-muted">{t('settingsContent.ssWizardRunIdeaBody')}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
            <div className="space-y-3">
              {probe?.desktop ? (
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-text-primary">{t(sourceSelectKey(sourceKind))}</label>
                  <select
                    value={selectedSourceId ?? ''}
                    disabled={testRunning || sourceOptions.length === 0}
                    onChange={(e) => setSelectedSourceId(e.target.value || null)}
                    className="w-full rounded border border-border bg-bg-input px-2 py-2 text-[11px] text-text-primary"
                  >
                    {sourceOptions.map((source) => (
                      <option key={source.id} value={source.id}>{source.name}</option>
                    ))}
                  </select>
                  {sourceOptions.length === 0 && (
                    <p className="text-[11px] text-amber-200">{t(emptySourceKey(sourceKind))}</p>
                  )}
                </div>
              ) : (
                <p className="rounded border border-amber-400/60 bg-amber-500/10 p-3 text-[11px] text-text-primary">
                  {t('settingsContent.ssWizardBrowserCapturePrompt')}
                </p>
              )}

              <div className="rounded border border-border bg-bg-input/45 p-3 space-y-1 text-[11px] text-text-muted">
                <p className="font-medium text-text-primary">{t('settingsContent.ssWizardRunIdeaTitle')}</p>
                <p>{t('settingsContent.ssWizardTestPlanSummary', { count: testProfiles.length, minutes: fullTestMinutes })}</p>
                <p>{t('settingsContent.ssWizardRestartWarning')}</p>
              </div>

              {testResults.length > 0 && (
                <div className="rounded border border-border bg-bg-input/45 p-3 space-y-2">
                  <p className="text-[11px] font-medium text-text-primary">{t('settingsContent.ssWizardResultsSoFar')}</p>
                  <div className="grid gap-1">
                    {testResults.map((result) => (
                      <div key={result.id} className="rounded border border-border bg-bg-elevated/60 px-2 py-1.5 text-[11px]">
                        <p className="text-text-primary">
                          {t(encoderLabelKey(result.encoder))} - {result.resolution}p{result.fps} - {result.sourceName}
                        </p>
                        <p className={result.passed ? 'text-emerald-300' : 'text-amber-200'}>
                          {t('settingsContent.ssWizardResultRow', {
                            width: result.width,
                            height: result.height,
                            fps: result.measuredFps,
                            verdictFps: result.verdictFps,
                          })}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="relative overflow-hidden rounded border border-border bg-black/60 aspect-video">
                <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-contain" />
                {testRunning && currentStatusText && (
                  <div className="absolute left-1.5 top-1.5 rounded bg-black/70 px-2 py-0.5 text-[10px] text-emerald-300">
                    {currentStatusText}
                  </div>
                )}
              </div>
              {testRunning && testPhase === 'opening' && (
                <p className="text-[11px] text-text-muted">{t('settingsContent.ssWizardCapturePickerWaiting')}</p>
              )}
              {testError && <p className="text-[11px] text-danger">{testError}</p>}
              {selectedSourceRequiresNativeTest && !testRunning && (
                <p className="text-[11px] text-amber-200">
                  Native device capture is available from the share picker, but this browser preview test cannot open it directly.
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <button
              type="button"
              onClick={() => { void applyAndFinish(); }}
              disabled={testRunning || !rec}
              className="inline-flex items-center justify-center gap-2 rounded bg-bg-hover px-3 py-2 text-xs font-medium text-text-primary disabled:opacity-50"
            >
              <Check size={14} aria-hidden="true" />
              {t('settingsContent.ssWizardApplySimpleSetup')}
            </button>
            <button
              type="button"
              onClick={() => { void startFullTest(); }}
              disabled={!canBeginTest}
              className="inline-flex items-center justify-center gap-2 rounded bg-success px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
            >
              <RotateCcw size={14} aria-hidden="true" />
              {t('settingsContent.ssWizardBeginTest')}
            </button>
            {testRunning ? (
              <button
                type="button"
                onClick={cancelTest}
                className="inline-flex items-center justify-center gap-2 rounded bg-bg-hover px-3 py-2 text-xs font-medium text-text-primary"
              >
                <Square size={13} aria-hidden="true" />
                {t('settingsContent.ssWizardCancelTest')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { void startQuickTest(); }}
                disabled={!selectedScreen}
                className="inline-flex items-center justify-center gap-2 rounded bg-bg-hover px-3 py-2 text-xs font-medium text-text-muted hover:text-text-primary disabled:opacity-50"
              >
                <Play size={14} aria-hidden="true" />
                {t('settingsContent.ssWizardQuickScreenTest')}
              </button>
            )}
          </div>
        </div>
      );
    }

    if (step === 'result' && rec) {
      return (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">{t('settingsContent.ssWizardResultTitle')}</h3>
            <p className="mt-1 text-xs text-text-muted">
              {applied ? t('settingsContent.ssWizardSimpleSetupApplied') : t('settingsContent.ssWizardResultIntro')}
            </p>
          </div>

          {testResult && (
            <div className="rounded border border-border bg-bg-input/45 p-3 space-y-1 text-[11px]">
              <p className="font-medium text-text-primary">{t('settingsContent.ssWizardBestResult')}</p>
              <p className={testResult.passed ? 'text-emerald-300' : 'text-amber-200'}>
                {testResult.passed
                  ? t('settingsContent.ssWizardTestPassed', {
                    width: testResult.width,
                    height: testResult.height,
                    fps: testResult.measuredFps,
                  })
                  : t('settingsContent.ssWizardTestBelowTarget', {
                    width: testResult.width,
                    height: testResult.height,
                    fps: testResult.measuredFps,
                    targetFps: testResult.fps,
                    recommendedFps: testResult.verdictFps,
                  })}
              </p>
              <p className="text-text-muted">
                {t('settingsContent.ssWizardResultSource', {
                  source: testResult.sourceName,
                  resolution: testResult.resolution,
                  fps: testResult.fps,
                })}
              </p>
            </div>
          )}

          <div className="rounded border border-border bg-bg-input/45 p-3 space-y-1 text-[11px]">
            <p className="font-medium text-text-primary">{t('settingsContent.ssWizardSettingsToApply')}</p>
            <p className="text-text-muted">
              {t('settingsContent.ssWizardApplyResolutionFps', { resolution: finalResolution, fps: finalFps })}
            </p>
            <p className="text-text-muted">
              {t('settingsContent.ssWizardApplyEncoder', { encoder: finalEncoder })}
            </p>
            <p className="text-text-muted">
              {t('settingsContent.ssWizardApplyBitratePreset', { preset: t(`settingsContent.${rec.preset}`) })}
            </p>
            {probe?.desktop && (
              <p className="text-text-muted">{t('settingsContent.ssWizardApplyChromeBackend', { backend: backendName })}</p>
            )}
          </div>

          {!applied ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => { void applyAndFinish(); }}
                className="rounded bg-success px-3 py-2 text-xs font-medium text-white"
              >
                {t('settingsContent.ssWizardApplyFinish')}
              </button>
              <button
                type="button"
                onClick={() => { setTestResult(null); setStep('run'); }}
                className="rounded bg-bg-hover px-3 py-2 text-xs font-medium text-text-muted hover:text-text-primary"
              >
                {t('settingsContent.ssWizardAdjustRunAgain')}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] text-emerald-300">{t('settingsContent.ssWizardSettingsApplied')}</p>
              {restartAfterApplyRequired && (
                <div className="rounded border border-amber-400/60 bg-amber-500/10 p-2.5 space-y-2">
                  <p className="text-[11px] text-text-primary">
                    {t('settingsContent.ssWizardEncoderRestartRequired')}
                  </p>
                  <button
                    type="button"
                    onClick={() => { void restartAndReconnectClient(); }}
                    className="rounded bg-yellow-500 px-3 py-1.5 text-xs font-medium text-black hover:bg-yellow-400"
                  >
                    {t('settingsContent.ssRestartAndReconnect')}
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded bg-accent px-3 py-2 text-xs font-medium text-white"
              >
                {t('settingsContent.ssWizardDone')}
              </button>
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  const panel = (
    <div
      className={[
        'bg-bg-elevated text-text-primary shadow-xl flex flex-col overflow-hidden',
        standalone
          ? 'min-h-[calc(100vh-2rem)] w-full max-w-5xl mx-auto rounded-lg border border-border'
          : 'w-full max-w-4xl max-h-[calc(100vh-2rem)] rounded-lg',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-text-primary">{t('settingsContent.ssWizardTitle')}</h2>
          {standalone && (
            <p className="text-[11px] text-text-muted">{t('settingsContent.ssWizardStandaloneIntro')}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={testRunning}
          aria-label={t('common.close')}
          className="inline-flex h-8 w-8 items-center justify-center rounded text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="border-b border-border px-4 py-3">
        <div className="grid grid-cols-4 gap-1">
          {stepItems.map((item, index) => {
            const active = index === activeStepIndex;
            const complete = index < activeStepIndex;
            return (
              <div key={item.step} className="min-w-0">
                <div className={`h-1 rounded ${active || complete ? 'bg-accent' : 'bg-bg-input'}`} />
                <p className={`mt-1 truncate text-[10px] ${active ? 'text-text-primary' : 'text-text-muted'}`}>
                  {index + 1}. {t(item.labelKey)}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {renderStepBody()}
      </div>

      {step !== 'run' && step !== 'result' && (
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 'streaming' || testRunning}
            className="rounded px-3 py-2 text-xs font-medium text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
          >
            {t('common.back')}
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={!canGoNext || testRunning}
            className="rounded bg-accent px-4 py-2 text-xs font-medium text-white disabled:opacity-60"
          >
            {t('settingsContent.ssWizardNext')}
          </button>
        </div>
      )}

      {step === 'run' && (
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={goBack}
            disabled={testRunning}
            className="rounded px-3 py-2 text-xs font-medium text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
          >
            {t('common.back')}
          </button>
          <p className="text-[10px] text-text-muted">{t('settingsContent.ssWizardRunFooter')}</p>
        </div>
      )}
    </div>
  );

  if (standalone) {
    return (
      <div className="min-h-screen bg-bg-chat p-4">
        {panel}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !testRunning) onClose(); }}
    >
      {panel}
    </div>
  );
}

export function ScreenshareWizardApp() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'CatRealm - Screenshare Setup';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return <ScreenshareWizardSurface standalone onClose={() => window.close()} />;
}

export function ScreenshareWizardModal({ onClose }: { onClose: () => void }) {
  return <ScreenshareWizardSurface onClose={onClose} />;
}
