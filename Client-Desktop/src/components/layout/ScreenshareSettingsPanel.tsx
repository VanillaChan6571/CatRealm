import { useCallback, useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useSettingsStore, type ScreenShareDesktopCaptureMode, type ScreenShareNativeProfile, type ScreenshareCodecPreference } from '../../stores/settingsStore';
import { restartAndReconnectClient } from '../../lib/clientRestart';
import { useScreenshareSettingsSync } from '../../lib/screenshareSettingsSync';
import { ScreenshareWizardModal } from './ScreenshareWizardModal';

type ScreenShareVideoEncoderBackend = 'auto' | 'd3d11' | 'vulkan';

// The hidden 'catrealm' preset is intentionally absent: it is forced for
// DM / group-chat shares by callStore and enforced by Central.
const BITRATE_PRESETS = ['quality', 'efficiency', 'compressed'] as const;

const NATIVE_PROFILES: ScreenShareNativeProfile[] = ['high', 'constrained-baseline', 'baseline', 'main'];

function formatVideoEncodingDiagnostics(diagnostics: ScreenShareVideoEncodingDiagnostics | null, t: TFunction) {
  if (!diagnostics) return null;
  const profileCount = diagnostics.hardwareEncodeProfiles?.length ?? 0;
  if (diagnostics.hardwareEncodeAvailable) {
    return t('settingsContent.ssDiagAvailable', {
      count: profileCount,
      plural: profileCount === 1 ? '' : 's',
    });
  }
  if (diagnostics.reason === 'pending') {
    return t('settingsContent.ssDiagPending');
  }
  if (diagnostics.reason === 'no-video-encode-profiles') {
    return t('settingsContent.ssDiagNoProfiles');
  }
  if (diagnostics.reason === 'gpu-info-error') {
    return t('settingsContent.ssDiagGpuInfoError');
  }
  if (diagnostics.chromiumVideoEncode) {
    return t('settingsContent.ssDiagVideoEncodeUnavailable', { status: diagnostics.chromiumVideoEncode });
  }
  return t('settingsContent.ssDiagUnavailable');
}

/**
 * The one Screenshare Settings surface (Settings → Voice, share picker, manage
 * modal). Self-contained: probes encoder support itself, hosts its own
 * restart-&-reconnect banner and launches the wizard. Gated behind the wizard
 * until taken once.
 */
export function ScreenshareSettingsPanel() {
  const { t } = useTranslation();
  const screenshareFps = useSettingsStore((s) => s.screenshareFps);
  const setScreenshareFps = useSettingsStore((s) => s.setScreenshareFps);
  const screenshareResolution = useSettingsStore((s) => s.screenshareResolution);
  const setScreenshareResolution = useSettingsStore((s) => s.setScreenshareResolution);
  const screenshareAudio = useSettingsStore((s) => s.screenshareAudio);
  const setScreenshareAudio = useSettingsStore((s) => s.setScreenshareAudio);
  const screenshareQualityPreset = useSettingsStore((s) => s.screenshareQualityPreset);
  const setScreenshareQualityPreset = useSettingsStore((s) => s.setScreenshareQualityPreset);
  const screenshareDegradationPreference = useSettingsStore((s) => s.screenshareDegradationPreference);
  const setScreenshareDegradationPreference = useSettingsStore((s) => s.setScreenshareDegradationPreference);
  const screenshareCodecPreference = useSettingsStore((s) => s.screenshareCodecPreference);
  const setScreenshareCodecPreference = useSettingsStore((s) => s.setScreenshareCodecPreference);
  const screenShareSimulcastEnabled = useSettingsStore((s) => s.screenShareSimulcastEnabled);
  const setScreenShareSimulcastEnabled = useSettingsStore((s) => s.setScreenShareSimulcastEnabled);
  const screenShareHardwareEncoding = useSettingsStore((s) => s.screenShareHardwareEncoding);
  const setScreenShareHardwareEncoding = useSettingsStore((s) => s.setScreenShareHardwareEncoding);
  const screenShareEncoderBackend = useSettingsStore((s) => s.screenShareEncoderBackend);
  const setScreenShareEncoderBackend = useSettingsStore((s) => s.setScreenShareEncoderBackend);
  const screenShareDesktopCaptureMode = useSettingsStore((s) => s.screenShareDesktopCaptureMode);
  const setScreenShareDesktopCaptureMode = useSettingsStore((s) => s.setScreenShareDesktopCaptureMode);
  const screenShareNativeWhipEnabled = useSettingsStore((s) => s.screenShareNativeWhipEnabled);
  const setScreenShareNativeWhipEnabled = useSettingsStore((s) => s.setScreenShareNativeWhipEnabled);
  const screenShareNativeProfile = useSettingsStore((s) => s.screenShareNativeProfile);
  const setScreenShareNativeProfile = useSettingsStore((s) => s.setScreenShareNativeProfile);
  const screenShareGpuId = useSettingsStore((s) => s.screenShareGpuId);
  const setScreenShareGpu = useSettingsStore((s) => s.setScreenShareGpu);
  const wizardCompletedAt = useSettingsStore((s) => s.screenshareWizardCompletedAt);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [availableGpus, setAvailableGpus] = useState<ScreenShareGpu[]>([]);

  // Webapp (browser) shows the browser-path settings only — the CatRealm custom
  // encoder and DXGI/WGC capture handling are desktop-client features.
  const runningOnDesktop = typeof window !== 'undefined' && !!window.electron;
  const desktopVideoEncodingAvailable = typeof window !== 'undefined' && !!window.electron?.getScreenShareVideoEncoding;
  const [hardwareDiscoveryPending, setHardwareDiscoveryPending] = useState(desktopVideoEncodingAvailable);
  const [videoEncodingRestartRequired, setVideoEncodingRestartRequired] = useState(false);
  const [videoEncodingDiagnostics, setVideoEncodingDiagnostics] = useState<ScreenShareVideoEncodingDiagnostics | null>(null);
  const [nativeWhipSupport, setNativeWhipSupport] = useState<NativeWhipPublisherSupport | null>(null);
  // Shown after the GPU Encoding toggle changes — the encoder switch needs a
  // client restart, offered inline with a Restart & Reconnect button.
  const [showRestartBanner, setShowRestartBanner] = useState(false);

  useScreenshareSettingsSync();

  useEffect(() => {
    if (!desktopVideoEncodingAvailable) return;
    let cancelled = false;
    setHardwareDiscoveryPending(true);
    const diagnosticsRequest = window.electron?.getScreenShareVideoEncoding?.().then((config) => {
      if (cancelled) return;
      setScreenShareHardwareEncoding(config.hardwareEncoding);
      setScreenShareEncoderBackend(config.encoderBackend);
      setVideoEncodingDiagnostics(config.diagnostics ?? null);
      setVideoEncodingRestartRequired(!!config.requiresRestart);
    }).catch(() => undefined);
    const supportRequest = window.electron?.getNativeWhipPublisherSupport?.().then((support) => {
      if (cancelled) return;
      setNativeWhipSupport(support);
    }).catch(() => undefined);
    const gpuRequest = window.electron?.listScreenShareGpus?.().then((result) => {
      if (cancelled) return;
      setAvailableGpus(result?.gpus ?? []);
    }).catch(() => undefined);
    void Promise.allSettled([diagnosticsRequest, supportRequest, gpuRequest]).then(() => {
      if (!cancelled) setHardwareDiscoveryPending(false);
    });
    return () => { cancelled = true; };
  }, [desktopVideoEncodingAvailable, setScreenShareEncoderBackend, setScreenShareHardwareEncoding]);

  const updateVideoEncoding = useCallback(async (next: {
    hardwareEncoding?: boolean;
    encoderBackend?: ScreenShareVideoEncoderBackend;
  }) => {
    const hardwareEncoding = next.hardwareEncoding ?? screenShareHardwareEncoding;
    const encoderBackend = next.encoderBackend ?? screenShareEncoderBackend;
    if (next.hardwareEncoding !== undefined) setScreenShareHardwareEncoding(next.hardwareEncoding);
    if (next.encoderBackend !== undefined) setScreenShareEncoderBackend(next.encoderBackend);
    const result = await window.electron?.setScreenShareVideoEncoding?.({ hardwareEncoding, encoderBackend }).catch(() => null);
    if (result) {
      setVideoEncodingDiagnostics(result.diagnostics ?? null);
      setVideoEncodingRestartRequired(!!result.requiresRestart);
    }
  }, [screenShareHardwareEncoding, screenShareEncoderBackend, setScreenShareHardwareEncoding, setScreenShareEncoderBackend]);

  const gpuEncodingOn = runningOnDesktop && screenShareNativeWhipEnabled;
  const selectedGpu = availableGpus.find((gpu) => gpu.id === screenShareGpuId) ?? null;
  const resolvedGpu = selectedGpu ?? availableGpus[0] ?? null;
  const gpuSelectValue = selectedGpu ? selectedGpu.id : 'auto';
  const gpuAutoLabel = availableGpus.length === 1
    ? `${t('settingsContent.ssGpuAuto')} - ${availableGpus[0].label}`
    : t('settingsContent.ssGpuAuto');
  const videoEncodingStatusText = formatVideoEncodingDiagnostics(videoEncodingDiagnostics, t);
  const nativeWhipStatusText = nativeWhipSupport
    ? nativeWhipSupport.ok
      ? t('settingsContent.ssNativeReady')
      : t('settingsContent.ssNativeUnavailable', {
        reason: nativeWhipSupport.reason ?? t('settingsContent.ssNativeChecking'),
      })
    : null;
  const nativeWhipStatusClass = nativeWhipSupport?.ok ? 'text-emerald-300' : 'text-amber-200';

  const openWizard = useCallback(() => {
    if (window.electron?.openScreenshareWizard) {
      window.electron.openScreenshareWizard()
        .then((result) => {
          if (!result?.ok) setWizardOpen(true);
        })
        .catch(() => setWizardOpen(true));
      return;
    }
    setWizardOpen(true);
  }, []);

  const wizardButton = (
    <button
      type="button"
      onClick={openWizard}
      title={t('settingsContent.ssWizardGuideTitle')}
      className="w-full px-3 py-2 rounded text-xs font-medium bg-accent text-white"
    >
      {t('settingsContent.ssWizardGuide')}
    </button>
  );
  const wizardOverlay = wizardOpen
    ? <ScreenshareWizardModal onClose={() => setWizardOpen(false)} />
    : null;
  const discoveryStatus = hardwareDiscoveryPending
    ? <p role="status" className="text-xs text-text-muted">Detecting screen-sharing hardware… You can keep using Voice settings.</p>
    : null;

  // Gate: settings stay hidden until the wizard has been taken at least once.
  if (wizardCompletedAt === null) {
    return (
      <div className="rounded border border-border bg-bg-input/50 p-3 space-y-3">
        <p className="text-xs font-medium text-text-primary">{t('settingsContent.screenshareSettings')}</p>
        {discoveryStatus}
        <p className="text-[11px] text-text-muted">{t('settingsContent.ssWizardGateText')}</p>
        {wizardButton}
        {wizardOverlay}
      </div>
    );
  }

  return (
    <div className="rounded border border-border bg-bg-input/50 p-3 space-y-3">
      <p className="text-xs font-medium text-text-primary">{t('settingsContent.screenshareSettings')}</p>
      {discoveryStatus}

      {wizardButton}

      {showRestartBanner && (
        <div className="rounded border border-amber-400/60 bg-amber-500/10 p-2.5 space-y-2">
          <p className="text-[11px] text-text-primary">{t('settingsContent.ssRestartRequired')}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { void restartAndReconnectClient(); }}
              className="px-3 py-1.5 rounded-full text-xs font-medium bg-yellow-500 text-black hover:bg-yellow-400"
            >
              {t('settingsContent.ssRestartAndReconnect')}
            </button>
            <button
              type="button"
              onClick={() => setShowRestartBanner(false)}
              className="px-3 py-1.5 rounded-full text-xs bg-bg-hover text-text-muted hover:text-text-primary"
            >
              {t('settingsContent.ssLater')}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <label className="text-[11px] text-text-muted">{t('settingsContent.ssFrameRate')}</label>
        <select
          value={screenshareFps}
          onChange={(e) => setScreenshareFps(Number(e.target.value) as 24 | 48 | 60)}
          className="bg-bg-input border border-border rounded px-2 py-1 text-xs text-text-primary"
        >
          <option value={24}>24 FPS</option>
          <option value={48}>48 FPS</option>
          <option value={60}>60 FPS</option>
        </select>
      </div>

      <div className="flex items-center justify-between">
        <label className="text-[11px] text-text-muted">{t('settingsContent.ssResolution')}</label>
        <select
          value={screenshareResolution}
          onChange={(e) => setScreenshareResolution(Number(e.target.value) as 720 | 1080 | 1440)}
          className="bg-bg-input border border-border rounded px-2 py-1 text-xs text-text-primary"
        >
          <option value={720}>720p</option>
          <option value={1080}>1080p</option>
          <option value={1440}>1440p</option>
        </select>
      </div>

      <label className="flex items-center justify-between gap-2 cursor-pointer">
        <span className="text-[11px] text-text-muted">{t('settingsContent.ssShareSystemAudio')}</span>
        <input
          type="checkbox"
          checked={screenshareAudio}
          onChange={(e) => setScreenshareAudio(e.target.checked)}
          className="h-3.5 w-3.5"
        />
      </label>

      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-text-primary">{t('settingsContent.ssBitrateSettings')}</p>
        <label className="flex items-center justify-between gap-2 cursor-pointer">
          <span className="text-[11px] text-text-muted">{t('settingsContent.ssSimulcast')}</span>
          <input
            type="checkbox"
            checked={screenShareSimulcastEnabled}
            onChange={(e) => setScreenShareSimulcastEnabled(e.target.checked)}
            className="h-3.5 w-3.5"
          />
        </label>
        {gpuEncodingOn && screenShareSimulcastEnabled && (
          <p className="text-[10px] text-text-muted italic">{t('settingsContent.ssSimulcastNativeNote')}</p>
        )}
        <div className="space-y-1">
          {BITRATE_PRESETS.map((preset) => (
            <label key={preset} className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="screenshare-bitrate-preset"
                checked={screenshareQualityPreset === preset}
                onChange={() => setScreenshareQualityPreset(preset)}
                className="mt-0.5 h-3 w-3"
              />
              <span className="text-[11px] text-text-primary">
                {t(`settingsContent.${preset}`)}
                {preset === 'efficiency' && <span className="text-text-muted"> {t('settingsContent.ssDefaultTag')}</span>}
                <span className="block text-[10px] text-text-muted">
                  {t(`settingsContent.ssPreset${preset.charAt(0).toUpperCase()}${preset.slice(1)}Desc`)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] text-text-muted">{t('settingsContent.ssPreferredTarget')}</label>
          <div className="flex rounded overflow-hidden border border-border text-[11px]">
            <button
              type="button"
              onClick={() => setScreenshareDegradationPreference('maintain-framerate')}
              className={`px-2 py-1 transition-colors ${
                screenshareDegradationPreference === 'maintain-framerate' ? 'bg-accent text-white' : 'bg-bg-input text-text-muted hover:text-text-primary'
              }`}
            >
              {t('settingsContent.ssTargetFramerate')}
            </button>
            <button
              type="button"
              onClick={() => setScreenshareDegradationPreference('maintain-resolution')}
              className={`px-2 py-1 transition-colors border-l border-border ${
                screenshareDegradationPreference === 'maintain-resolution' ? 'bg-accent text-white' : 'bg-bg-input text-text-muted hover:text-text-primary'
              }`}
            >
              {t('settingsContent.ssTargetResolution')}
            </button>
          </div>
        </div>
        <p className="text-[10px] text-text-muted italic">
          {screenshareDegradationPreference === 'maintain-resolution'
            ? t('settingsContent.ssTargetResolutionDesc')
            : t('settingsContent.ssTargetFramerateDesc')}
        </p>
      </div>

      {runningOnDesktop && (
        <div className="rounded border border-border/70 bg-bg-input/35 p-2 space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={gpuEncodingOn}
              onChange={(e) => {
                setScreenShareNativeWhipEnabled(e.target.checked);
                setShowRestartBanner(true);
              }}
              className="mt-0.5 h-3.5 w-3.5"
            />
            <span className="text-[11px] text-text-primary">
              {t('settingsContent.ssGpuEncoding')}
              <span className="block text-[10px] text-text-muted">
                {gpuEncodingOn
                  ? t('settingsContent.ssGpuEncodingOnDesc')
                  : t('settingsContent.ssGpuEncodingOffDesc')}
              </span>
            </span>
          </label>

          {gpuEncodingOn && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[11px] text-text-muted">{t('settingsContent.ssGpuLabel')}</label>
                <select
                  value={gpuSelectValue}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === 'auto') { setScreenShareGpu(null, null); return; }
                    const gpu = availableGpus.find((g) => g.id === value);
                    setScreenShareGpu(gpu?.id ?? null, gpu?.encoder ?? null);
                  }}
                  className="bg-bg-input border border-border rounded px-2 py-1 text-[11px] text-text-primary max-w-[60%]"
                >
                  <option value="auto">{gpuAutoLabel}</option>
                  {availableGpus.map((gpu) => (
                    <option key={gpu.id} value={gpu.id}>
                      {gpu.integrated ? `${gpu.label} ${t('settingsContent.ssGpuIntegratedTag')}` : gpu.label}
                    </option>
                  ))}
                </select>
              </div>
              {resolvedGpu ? (
                <p className="text-[10px] text-text-muted">
                  {t('settingsContent.ssGpuUsing', { gpu: resolvedGpu.label })}
                </p>
              ) : (
                <p className="text-[10px] text-text-muted">{t('settingsContent.ssGpuAutoUnavailable')}</p>
              )}
              {resolvedGpu?.integrated && (
                <p className="text-[10px] text-amber-200">{t('settingsContent.ssGpuIntegratedWarning')}</p>
              )}
            </div>
          )}

          {gpuEncodingOn && (
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] text-text-muted">{t('settingsContent.ssBackendCatRealm')}</label>
              <select
                value={screenShareNativeProfile}
                onChange={(e) => setScreenShareNativeProfile(e.target.value as ScreenShareNativeProfile)}
                className="bg-bg-input border border-border rounded px-2 py-1 text-[11px] text-text-primary max-w-[60%]"
              >
                {NATIVE_PROFILES.map((profile) => (
                  <option key={profile} value={profile}>
                    {profile === 'high' ? t('settingsContent.ssProfileHighLabel') : profile}
                  </option>
                ))}
              </select>
            </div>
          )}

          {nativeWhipStatusText && (
            <p className={`text-[10px] ${nativeWhipStatusClass}`}>{nativeWhipStatusText}</p>
          )}
        </div>
      )}

      {/* Browser encoder rows: also controls Electron's ANGLE path after restart. */}
      <div className={`rounded border border-border/70 bg-bg-input/35 p-2 space-y-2 ${gpuEncodingOn ? 'opacity-75' : ''}`}>
        {desktopVideoEncodingAvailable && (
          <div className="flex items-center justify-between gap-2">
            <label className="text-[11px] text-text-muted">{t('settingsContent.ssBackendChrome')}</label>
            <select
              value={screenShareEncoderBackend}
              onChange={(e) => { void updateVideoEncoding({ encoderBackend: e.target.value as ScreenShareVideoEncoderBackend }); }}
              className="bg-bg-input border border-border rounded px-2 py-1 text-[11px] text-text-primary"
            >
              <option value="auto">{t('settingsContent.ssAutoWizardChooses')}</option>
              <option value="d3d11">Direct3D 11</option>
              <option value="vulkan">Vulkan</option>
            </select>
          </div>
        )}
        {gpuEncodingOn && desktopVideoEncodingAvailable && (
          <p className="text-[10px] text-text-muted">
            Changing this backend takes effect after Restart & Reconnect and can affect UI GPU compositing.
          </p>
        )}

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label className="text-[11px] text-text-muted">{t('settingsContent.ssChromeEncodingPreferred')}</label>
            <select
              value={screenshareCodecPreference}
              disabled={gpuEncodingOn}
              onChange={(e) => setScreenshareCodecPreference(e.target.value as ScreenshareCodecPreference)}
              className="bg-bg-input border border-border rounded px-2 py-1 text-[11px] text-text-primary disabled:cursor-not-allowed"
            >
              {screenshareCodecPreference === 'auto' && <option value="auto">{t('settingsContent.ssAutoLegacy')}</option>}
              <option value="h264">{t('settingsContent.ssSoftwareH264Default')}</option>
              <option value="h265">H.265 HEVC</option>
              <option value="vp8">VP8</option>
            </select>
          </div>
          {screenshareCodecPreference === 'h264' && !gpuEncodingOn && (
            <p className="text-[10px] text-text-muted">{t('settingsContent.ssH264Notice')}</p>
          )}
          {screenshareCodecPreference === 'h265' && (
            <p className="text-[10px] codec-warn-glow">{t('settingsContent.ssH265Warning')}</p>
          )}
        </div>

        {runningOnDesktop && (
          <div className="flex items-center justify-between gap-2">
            <label className="text-[11px] text-text-muted">{t('settingsContent.ssCaptureHandling')}</label>
            <select
              value={screenShareDesktopCaptureMode}
              disabled={gpuEncodingOn}
              onChange={(e) => setScreenShareDesktopCaptureMode(e.target.value as ScreenShareDesktopCaptureMode)}
              className="bg-bg-input border border-border rounded px-2 py-1 text-[11px] text-text-primary disabled:cursor-not-allowed"
            >
              {screenShareDesktopCaptureMode === 'auto' && <option value="auto">{t('settingsContent.ssAutoWizardChooses')}</option>}
              <option value="monitor-dxgi">DXGI</option>
              <option value="window-wgc">WGC</option>
            </select>
          </div>
        )}

        {videoEncodingStatusText && (
          <p className={`text-[10px] ${videoEncodingDiagnostics?.hardwareEncodeAvailable ? 'text-emerald-300' : 'text-amber-200'}`}>
            {videoEncodingStatusText}
          </p>
        )}

        {videoEncodingRestartRequired && (
          <p className="text-[10px] text-amber-300">{t('settingsContent.ssRestartHint')}</p>
        )}
      </div>

      {wizardOverlay}
    </div>
  );
}
