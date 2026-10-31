import { create } from 'zustand';
import i18n from '../i18n';
import { clearRealtimeReconnectTarget } from '../lib/realtimeReconnect';
import { DEFAULT_UPDATE_CHANNEL, normalizeUpdateChannelId } from '../lib/updateChannels';
import { useUIStore } from './uiStore';
import { detectAppLanguage, LANGUAGE_OPTIONS, type AppLanguage } from '../i18n/languages';

export { LANGUAGE_OPTIONS };
export type { AppLanguage };
export type ScreenshareCodecPreference = 'auto' | 'vp8' | 'h264' | 'h265';
export type ScreenShareViewerQuality = 'auto' | 'high' | 'medium' | 'low';
export type ScreenShareDesktopCaptureMode = 'auto' | 'monitor-dxgi' | 'window-wgc';
// H.264 profile for the native (CatRealm custom encoder) WHIP path. 'high' is the
// best quality-per-bit; baseline profiles are the universal-decode fallback.
export type ScreenShareNativeProfile = 'high' | 'main' | 'baseline' | 'constrained-baseline';
export const SCREEN_SHARE_NATIVE_PROFILES = ['high', 'main', 'baseline', 'constrained-baseline'] as const;

// GStreamer H.264 encoder element chosen via the GPU selector. null = auto (the
// main process picks the best available). nvh264enc=NVIDIA, amfh264enc=AMD,
// mfh264enc=Media Foundation (vendor-agnostic fallback, incl. Intel).
export type ScreenShareVideoEncoder = 'nvh264enc' | 'amfh264enc' | 'mfh264enc';
export const SCREEN_SHARE_VIDEO_ENCODERS = ['nvh264enc', 'amfh264enc', 'mfh264enc'] as const;

// Motion / animation intensity. Drives the Framer Motion timing profiles in
// src/lib/motion.ts. 'middle' is the default; OS prefers-reduced-motion is
// honored on top of this via <MotionConfig reducedMotion="user">.
export type MotionIntensity = 'snappy' | 'middle' | 'lively';

export type VoiceBgMode = 'default' | 'colors' | 'image';
export type VoiceBgPattern = 'radial' | 'linear' | 'diagonal' | 'stripes' | 'mesh';
export type VoiceBgScene = 'rings' | 'orbit' | 'particles' | 'pixels';
export const VOICE_BG_MAX_COLORS = 6;
export const MOTION_INTENSITIES = ['snappy', 'middle', 'lively'] as const;
const DEFAULT_LANGUAGE: AppLanguage = detectAppLanguage();

interface SettingsState {
  playGifAvatars: boolean;
  showAvatarBackground: boolean;
  enableImageThumbnailing: boolean;
  disableEmbedAutoplay: boolean;
  emoteSizePx: 24 | 32 | 48 | 64 | 96 | 128 | 256 | 512;
  voiceInputDeviceId: string | null;
  voiceInputMode: 'voice_activity' | 'push_to_talk';
  voiceOutputDeviceId: string | null;
  voiceCallE2EEEnabled: boolean;
  reconnectToRealtimeChannels: boolean;
  autoTryHttpRealmGateway: boolean;
  voiceUserVolumes: Record<string, number>;
  screenshareFps: 24 | 48 | 60;
  screenshareResolution: 720 | 1080 | 1440;
  screenshareAudio: boolean;
  screenshareDegradationPreference: 'maintain-framerate' | 'maintain-resolution';
  screenshareQualityPreset: 'quality' | 'efficiency' | 'compressed';
  screenshareCodecPreference: ScreenshareCodecPreference;
  screenShareViewerQuality: ScreenShareViewerQuality;
  screenShareSimulcastEnabled: boolean;
  screenShareHardwareEncoding: boolean;
  screenShareEncoderBackend: ScreenShareVideoEncoderBackend;
  screenShareDesktopCaptureMode: ScreenShareDesktopCaptureMode;
  screenShareNativeWhipEnabled: boolean;
  screenShareNativeProfile: ScreenShareNativeProfile;
  // GPU chooser: the selected GPU id (from listScreenShareGpus) for UI state, and
  // the resolved encoder element passed to the native publisher. null = auto.
  screenShareGpuId: string | null;
  screenShareVideoEncoder: ScreenShareVideoEncoder | null;
  screenShareNativeWhipSimulcastEnabled: boolean;
  // Unix ms when the screenshare wizard was last completed; null = never taken.
  // Screenshare settings stay hidden behind the wizard gate until this is set.
  screenshareWizardCompletedAt: number | null;
  voiceMuted: boolean;
  voiceDeafened: boolean;
  notificationsEnabled: boolean;

  // Chat Sounds
  soundMessageInChannel: boolean;
  soundMessageInServer: boolean;
  soundMessageMention: boolean;
  soundMessageEveryone: boolean;

  // DM Sounds
  soundDMIncomingCall: boolean;
  soundDMOutgoingCall: boolean;
  soundDMMessageInCurrent: boolean;
  soundDMMessageFromOther: boolean;

  // Voice Chat Sounds
  soundVoiceDeafen: boolean;
  soundVoiceUndeafen: boolean;
  soundVoiceMute: boolean;
  soundVoiceUnmute: boolean;
  soundVoicePTTActivate: boolean;
  soundVoicePTTDeactivate: boolean;

  // Voice Chat Users
  soundVoiceUserJoined: boolean;
  soundVoiceUserLeft: boolean;
  soundVoiceUserMoved: boolean;

  // Extra Voice Chat Sounds
  soundScreenshareGoLive: boolean;
  soundScreenshareUserJoin: boolean;
  soundScreenshareUserLeft: boolean;
  soundScreenshareEnded: boolean;
  soundScreenshareStopped: boolean;
  soundRTCFailed: boolean;
  soundRTCReconnecting: boolean;

  // Very Extra (disabled by default)
  soundUIButtonClick: boolean;
  soundHourlyBeep: boolean;
  soundAmbience: boolean;
  soundChannelCreated: boolean;
  soundCategoryCreated: boolean;
  soundUploadingAttachment: boolean;
  soundTyping: boolean;
  soundSendMessage: boolean;
  soundChannelDeleted: boolean;
  soundCategoryDeleted: boolean;
  soundDeletingMessage: boolean;
  soundEditingMessage: boolean;

  // Individual volume controls for each sound
  soundVolumes: Record<string, number>;

  // Audio Processing
  noiseGateEnabled: boolean;
  noiseGateThreshold: number; // dB, -60 to -10
  rnnoiseEnabled: boolean;
  setNoiseGateEnabled: (value: boolean) => void;
  setNoiseGateThreshold: (value: number) => void;
  setRnnoiseEnabled: (value: boolean) => void;

  // Cat Lab — OBS Voice Overlay
  obsOverlayEnabled: boolean;
  obsOverlayPort: number;
  obsOverlayShowNames: boolean;
  obsOverlayAvatarSize: 32 | 48 | 64 | 96 | 128 | 256 | 512;
  obsOverlayGrayscaleWhenSilent: boolean;
  obsOverlayHideWhenSilent: boolean;
  obsOverlaySquareIcons: boolean;
  // Cat Lab — reactive (per-state) avatars in the OBS overlay
  obsOverlayReactiveAvatars: boolean;
  // Cat Lab — Composer text preview (self-view live message preview while typing)
  catLabTextPreview: boolean;
  setCatLabTextPreview: (value: boolean) => void;
  catLabFullProfileButton: boolean;
  setCatLabFullProfileButton: (value: boolean) => void;
  // Cat Lab — Per-person audio tracks (route participants to extra output devices)
  catLabAudioTracks: boolean;
  setCatLabAudioTracks: (value: boolean) => void;
  // Cat Lab — On-device Spanish↔English auto-translation of chat messages
  catLabAutoTranslate: boolean;
  setCatLabAutoTranslate: (value: boolean) => void;

  // Appearance — server voice call background
  voiceBgMode: VoiceBgMode;
  voiceBgColors: string[]; // 1-6 hex colors used by the pattern modes
  voiceBgPattern: VoiceBgPattern;
  voiceBgAnimated: boolean;
  // Decorative signature effect layered over the pattern (null = none).
  voiceBgScene: VoiceBgScene | null;
  // Bumped when the locally stored background file changes so consumers reload it.
  voiceBgImageUpdatedAt: number | null;
  setVoiceBgMode: (value: VoiceBgMode) => void;
  setVoiceBgColors: (value: string[]) => void;
  setVoiceBgPattern: (value: VoiceBgPattern) => void;
  setVoiceBgAnimated: (value: boolean) => void;
  setVoiceBgScene: (value: VoiceBgScene | null) => void;
  setVoiceBgImageUpdatedAt: (value: number | null) => void;
  setObsOverlayEnabled: (value: boolean) => void;
  setObsOverlayPort: (value: number) => void;
  setObsOverlayShowNames: (value: boolean) => void;
  setObsOverlayAvatarSize: (value: 32 | 48 | 64 | 96 | 128 | 256 | 512) => void;
  setObsOverlayGrayscaleWhenSilent: (value: boolean) => void;
  setObsOverlayHideWhenSilent: (value: boolean) => void;
  setObsOverlaySquareIcons: (value: boolean) => void;
  setObsOverlayReactiveAvatars: (value: boolean) => void;

  theme: string;
  motionIntensity: MotionIntensity;
  heavyAnimationsEnabled: boolean;
  language: AppLanguage;
  timeFormat: '12' | '24';
  streamerMode: boolean;
  streamerModeAutoDetect: boolean;
  streamerModeHidePI: boolean;
  streamerModeDisableSounds: boolean;
  debugServerStates: boolean;
  debugCallingStates: boolean;
  debugTheaterStates: boolean;
  debugUIHoverInspector: boolean;
  debugFpsOverlay: boolean;
  debugGameActivity: boolean;
  forceMobileViewOnDesktop: boolean;
  openOnStartup: boolean;
  minimizeToTray: boolean;
  openLinksInApp: boolean;
  gameActivityEnabled: boolean;
  devBuilds: boolean;
  updateChannel: AppUpdateChannel;
  voiceDebugConsoleEnabled: boolean;
  setPlayGifAvatars: (value: boolean) => void;
  setShowAvatarBackground: (value: boolean) => void;
  setEnableImageThumbnailing: (value: boolean) => void;
  setDisableEmbedAutoplay: (value: boolean) => void;
  setEmoteSizePx: (value: 24 | 32 | 48 | 64 | 96 | 128 | 256 | 512) => void;
  setVoiceInputDeviceId: (value: string | null) => void;
  setVoiceInputMode: (value: 'voice_activity' | 'push_to_talk') => void;
  setVoiceOutputDeviceId: (value: string | null) => void;
  setVoiceCallE2EEEnabled: (value: boolean) => void;
  setReconnectToRealtimeChannels: (value: boolean) => void;
  setAutoTryHttpRealmGateway: (value: boolean) => void;
  setVoiceUserVolume: (userId: string, value: number) => void;
  setVoiceUserVolumes: (values: Record<string, number>) => void;
  clearVoiceUserVolumes: () => void;
  setScreenshareFps: (value: 24 | 48 | 60) => void;
  setScreenshareResolution: (value: 720 | 1080 | 1440) => void;
  setScreenshareAudio: (value: boolean) => void;
  setScreenshareDegradationPreference: (value: 'maintain-framerate' | 'maintain-resolution') => void;
  setScreenshareQualityPreset: (value: 'quality' | 'efficiency' | 'compressed') => void;
  setScreenshareCodecPreference: (value: ScreenshareCodecPreference) => void;
  setScreenShareViewerQuality: (value: ScreenShareViewerQuality) => void;
  setScreenShareSimulcastEnabled: (value: boolean) => void;
  setScreenShareHardwareEncoding: (value: boolean) => void;
  setScreenShareEncoderBackend: (value: ScreenShareVideoEncoderBackend) => void;
  setScreenShareDesktopCaptureMode: (value: ScreenShareDesktopCaptureMode) => void;
  setScreenShareNativeWhipEnabled: (value: boolean) => void;
  setScreenShareNativeProfile: (value: ScreenShareNativeProfile) => void;
  setScreenShareGpu: (gpuId: string | null, encoder: ScreenShareVideoEncoder | null) => void;
  setScreenShareNativeWhipSimulcastEnabled: (value: boolean) => void;
  setScreenshareWizardCompletedAt: (value: number | null) => void;
  setVoiceMuted: (value: boolean) => void;
  setVoiceDeafened: (value: boolean) => void;
  setNotificationsEnabled: (value: boolean) => void;
  setSoundSetting: (key: string, value: boolean) => void;
  setSoundVolume: (key: string, value: number) => void;
  setTheme: (value: string) => void;
  setMotionIntensity: (value: MotionIntensity) => void;
  setHeavyAnimationsEnabled: (value: boolean) => void;
  setLanguage: (value: AppLanguage) => void;
  setTimeFormat: (value: '12' | '24') => void;
  setStreamerMode: (value: boolean) => void;
  setStreamerModeAutoDetect: (value: boolean) => void;
  setStreamerModeHidePI: (value: boolean) => void;
  setStreamerModeDisableSounds: (value: boolean) => void;
  setDebugServerStates: (value: boolean) => void;
  setDebugCallingStates: (value: boolean) => void;
  setDebugTheaterStates: (value: boolean) => void;
  setDebugUIHoverInspector: (value: boolean) => void;
  setDebugFpsOverlay: (value: boolean) => void;
  setDebugGameActivity: (value: boolean) => void;
  setForceMobileViewOnDesktop: (value: boolean) => void;
  setOpenOnStartup: (value: boolean) => void;
  setMinimizeToTray: (value: boolean) => void;
  setOpenLinksInApp: (value: boolean) => void;
  setGameActivityEnabled: (value: boolean) => void;
  setDevBuilds: (value: boolean) => void;
  setUpdateChannel: (value: AppUpdateChannel) => void;
  setVoiceDebugConsoleEnabled: (value: boolean) => void;
}

const STORAGE_KEY = 'catrealm.settings';
const SCREEN_SHARE_VIEWER_QUALITIES = ['auto', 'high', 'medium', 'low'] as const;
const SCREEN_SHARE_DESKTOP_CAPTURE_MODES = ['auto', 'monitor-dxgi', 'window-wgc'] as const;

type SettingsData = Omit<SettingsState, 'setAutoTryHttpRealmGateway' | 'setPlayGifAvatars' | 'setShowAvatarBackground' | 'setEnableImageThumbnailing' | 'setDisableEmbedAutoplay' | 'setEmoteSizePx' | 'setVoiceInputDeviceId' | 'setVoiceInputMode' | 'setVoiceOutputDeviceId' | 'setVoiceCallE2EEEnabled' | 'setReconnectToRealtimeChannels' | 'setVoiceUserVolume' | 'setVoiceUserVolumes' | 'clearVoiceUserVolumes' | 'setScreenshareFps' | 'setScreenshareResolution' | 'setScreenshareAudio' | 'setScreenshareDegradationPreference' | 'setScreenshareQualityPreset' | 'setScreenshareCodecPreference' | 'setScreenShareViewerQuality' | 'setScreenShareSimulcastEnabled' | 'setScreenShareHardwareEncoding' | 'setScreenShareEncoderBackend' | 'setScreenShareDesktopCaptureMode' | 'setScreenShareNativeWhipEnabled' | 'setScreenShareNativeProfile' | 'setScreenShareGpu' | 'setScreenShareNativeWhipSimulcastEnabled' | 'setScreenshareWizardCompletedAt' | 'setVoiceMuted' | 'setVoiceDeafened' | 'setNotificationsEnabled' | 'setSoundSetting' | 'setSoundVolume' | 'setNoiseGateEnabled' | 'setNoiseGateThreshold' | 'setRnnoiseEnabled' | 'setTheme' | 'setMotionIntensity' | 'setHeavyAnimationsEnabled' | 'setLanguage' | 'setTimeFormat' | 'setStreamerMode' | 'setStreamerModeAutoDetect' | 'setStreamerModeHidePI' | 'setStreamerModeDisableSounds' | 'setDebugServerStates' | 'setDebugCallingStates' | 'setDebugTheaterStates' | 'setDebugUIHoverInspector' | 'setDebugFpsOverlay' | 'setDebugGameActivity' | 'setForceMobileViewOnDesktop' | 'setOpenOnStartup' | 'setMinimizeToTray' | 'setOpenLinksInApp' | 'setGameActivityEnabled' | 'setDevBuilds' | 'setUpdateChannel' | 'setVoiceDebugConsoleEnabled' | 'setObsOverlayEnabled' | 'setObsOverlayPort' | 'setObsOverlayShowNames' | 'setObsOverlayAvatarSize' | 'setObsOverlayGrayscaleWhenSilent' | 'setObsOverlayHideWhenSilent' | 'setObsOverlaySquareIcons' | 'setObsOverlayReactiveAvatars' | 'setCatLabTextPreview' | 'setCatLabFullProfileButton' | 'setCatLabGifPicker' | 'setCatLabAudioTracks' | 'setCatLabAutoTranslate' | 'setVoiceBgMode' | 'setVoiceBgColors' | 'setVoiceBgPattern' | 'setVoiceBgAnimated' | 'setVoiceBgScene' | 'setVoiceBgImageUpdatedAt'>;

const DEFAULT_SETTINGS: SettingsData = {
  playGifAvatars: true,
  showAvatarBackground: false,
  enableImageThumbnailing: true,
  disableEmbedAutoplay: false,
  emoteSizePx: 128,
  voiceInputDeviceId: null,
  voiceInputMode: 'voice_activity',
  voiceOutputDeviceId: null,
  voiceCallE2EEEnabled: false,
  reconnectToRealtimeChannels: true,
  autoTryHttpRealmGateway: false,
  voiceUserVolumes: {},
  screenshareFps: 60,
  screenshareResolution: 720,
  screenshareAudio: true,
  screenshareDegradationPreference: 'maintain-framerate',
  screenshareQualityPreset: 'efficiency',
  screenshareCodecPreference: 'h264',
  screenShareViewerQuality: 'auto',
  screenShareSimulcastEnabled: true,
  screenShareHardwareEncoding: true,
  screenShareEncoderBackend: 'auto',
  screenShareDesktopCaptureMode: 'auto',
  screenShareNativeWhipEnabled: true,
  screenShareNativeProfile: 'high',
  screenShareGpuId: null,
  screenShareVideoEncoder: null,
  screenShareNativeWhipSimulcastEnabled: false,
  screenshareWizardCompletedAt: null,
  voiceMuted: false,
  voiceDeafened: false,
  notificationsEnabled: true,

  // Chat Sounds (enabled by default)
  soundMessageInChannel: true,
  soundMessageInServer: true,
  soundMessageMention: true,
  soundMessageEveryone: true,

  // DM Sounds (enabled by default)
  soundDMIncomingCall: true,
  soundDMOutgoingCall: true,
  soundDMMessageInCurrent: true,
  soundDMMessageFromOther: true,

  // Voice Chat Sounds (enabled by default)
  soundVoiceDeafen: true,
  soundVoiceUndeafen: true,
  soundVoiceMute: true,
  soundVoiceUnmute: true,
  soundVoicePTTActivate: true,
  soundVoicePTTDeactivate: true,

  // Voice Chat Users (enabled by default)
  soundVoiceUserJoined: true,
  soundVoiceUserLeft: true,
  soundVoiceUserMoved: true,

  // Extra Voice Chat Sounds (enabled by default)
  soundScreenshareGoLive: true,
  soundScreenshareUserJoin: true,
  soundScreenshareUserLeft: true,
  soundScreenshareEnded: true,
  soundScreenshareStopped: true,
  soundRTCFailed: true,
  soundRTCReconnecting: true,

  // Very Extra (disabled by default)
  soundUIButtonClick: false,
  soundHourlyBeep: false,
  // On while we gather feedback on it, though it sits in the "very extra" group.
  soundAmbience: true,
  soundChannelCreated: false,
  soundCategoryCreated: false,
  soundUploadingAttachment: false,
  soundTyping: false,
  soundSendMessage: false,
  soundChannelDeleted: false,
  soundCategoryDeleted: false,
  soundDeletingMessage: false,
  soundEditingMessage: false,

  // Individual volume controls (default 60% for all sounds)
  soundVolumes: {},

  // Audio Processing (both enabled by default)
  noiseGateEnabled: true,
  noiseGateThreshold: -40,
  rnnoiseEnabled: true,

  // Cat Lab — OBS Voice Overlay
  obsOverlayEnabled: false,
  obsOverlayPort: 42069,
  obsOverlayShowNames: true,
  obsOverlayAvatarSize: 64,
  obsOverlayGrayscaleWhenSilent: false,
  obsOverlayHideWhenSilent: false,
  obsOverlaySquareIcons: true,
  obsOverlayReactiveAvatars: false,

  // Cat Lab — Composer text preview
  catLabTextPreview: false,
  catLabFullProfileButton: false,
  catLabAudioTracks: false,
  catLabAutoTranslate: false,

  // Appearance — server voice call background (defaults mirror the built-in blue)
  voiceBgMode: 'default',
  voiceBgColors: ['#3a418f', '#23274f', '#16182d'],
  voiceBgPattern: 'radial',
  voiceBgAnimated: false,
  voiceBgScene: null,
  voiceBgImageUpdatedAt: null,

  theme: 'dark-cat',
  motionIntensity: 'middle',
  heavyAnimationsEnabled: true,
  language: DEFAULT_LANGUAGE,
  timeFormat: '12',
  streamerMode: false,
  streamerModeAutoDetect: false,
  streamerModeHidePI: false,
  streamerModeDisableSounds: false,
  debugServerStates: false,
  debugCallingStates: false,
  debugTheaterStates: false,
  debugUIHoverInspector: false,
  debugFpsOverlay: false,
  debugGameActivity: false,
  forceMobileViewOnDesktop: false,
  openOnStartup: false,
  minimizeToTray: false,
  openLinksInApp: false,
  gameActivityEnabled: false,
  devBuilds: false,
  updateChannel: DEFAULT_UPDATE_CHANNEL,
  voiceDebugConsoleEnabled: false,
};

// Defaults changed after release. Saved settings store every value, so a new
// default never reaches existing installs on its own: apply each once, keyed
// by a marker, after which the user's own choice sticks. Fresh installs just
// record the markers (they already got the new defaults).
const ONE_TIME_DEFAULT_CHANGES: ReadonlyArray<{ marker: string; apply: (settings: SettingsData) => void }> = [
  // Off by default meant chat previews decoded multi-megapixel originals for
  // ~200px tiles and stalled scrolling.
  { marker: 'catrealm:image-thumbnailing-default-on', apply: (s) => { s.enableImageThumbnailing = true; } },
  { marker: 'catrealm:heavy-animations-default-on', apply: (s) => { s.heavyAnimationsEnabled = true; } },
  { marker: 'catrealm:avatar-background-default-off', apply: (s) => { s.showAvatarBackground = false; } },
  { marker: 'catrealm:ambience-sounds-default-on', apply: (s) => { s.soundAmbience = true; } },
];

/** Applies pending default changes; returns whether any were applied. */
function applyOneTimeDefaultChanges(settings: SettingsData, hadSavedSettings: boolean): boolean {
  let changed = false;
  for (const change of ONE_TIME_DEFAULT_CHANGES) {
    try {
      if (window.localStorage.getItem(change.marker) === '1') continue;
      if (hadSavedSettings) {
        change.apply(settings);
        changed = true;
      }
      window.localStorage.setItem(change.marker, '1');
    } catch {
      // Storage blocked: settings can't persist either, so defaults stand.
    }
  }
  return changed;
}

function loadSettings(): SettingsData {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const defaults = { ...DEFAULT_SETTINGS };
      applyOneTimeDefaultChanges(defaults, false);
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<SettingsData>;

    // Merge parsed settings with defaults
    const result: SettingsData = { ...DEFAULT_SETTINGS };
    for (const key in DEFAULT_SETTINGS) {
      if (key in parsed && parsed[key as keyof SettingsData] !== undefined) {
        (result as any)[key] = parsed[key as keyof SettingsData];
      }
    }

    // Normalize legacy or malformed values from previous releases.
    const rawTimeFormat = (result as any).timeFormat;
    if (rawTimeFormat === 24 || rawTimeFormat === '24' || rawTimeFormat === '24h' || rawTimeFormat === '24-hour') {
      result.timeFormat = '24';
    } else {
      result.timeFormat = '12';
    }
    const rawVoiceUserVolumes = (result as any).voiceUserVolumes;
    const normalizedVoiceUserVolumes: Record<string, number> = {};
    if (rawVoiceUserVolumes && typeof rawVoiceUserVolumes === 'object' && !Array.isArray(rawVoiceUserVolumes)) {
      for (const [userId, rawValue] of Object.entries(rawVoiceUserVolumes as Record<string, unknown>)) {
        const key = String(userId || '').trim();
        if (!key) continue;
        const num = Number(rawValue);
        if (!Number.isFinite(num)) continue;
        const clamped = Math.max(0, Math.min(300, Math.round(num)));
        if (clamped === 50) continue;
        normalizedVoiceUserVolumes[key] = clamped;
      }
    }
    result.voiceUserVolumes = normalizedVoiceUserVolumes;
    const rawUpdateChannel = normalizeUpdateChannelId((result as any).updateChannel);
    result.updateChannel = rawUpdateChannel || (result.devBuilds ? 'dev' : DEFAULT_UPDATE_CHANNEL);
    result.devBuilds = result.updateChannel !== DEFAULT_UPDATE_CHANNEL;
    if (!LANGUAGE_OPTIONS.includes(result.language as AppLanguage)) {
      result.language = DEFAULT_LANGUAGE;
    }
    if (typeof result.autoTryHttpRealmGateway !== 'boolean') {
      result.autoTryHttpRealmGateway = false;
    }
    if (!MOTION_INTENSITIES.includes(result.motionIntensity as MotionIntensity)) {
      result.motionIntensity = 'middle';
    }
    if (!SCREEN_SHARE_VIEWER_QUALITIES.includes(result.screenShareViewerQuality as ScreenShareViewerQuality)) {
      result.screenShareViewerQuality = 'auto';
    }
    if (!SCREEN_SHARE_DESKTOP_CAPTURE_MODES.includes(result.screenShareDesktopCaptureMode as ScreenShareDesktopCaptureMode)) {
      result.screenShareDesktopCaptureMode = 'auto';
    }
    if (typeof result.screenShareNativeWhipEnabled !== 'boolean') {
      result.screenShareNativeWhipEnabled = true;
    }
    if (!SCREEN_SHARE_NATIVE_PROFILES.includes(result.screenShareNativeProfile as ScreenShareNativeProfile)) {
      result.screenShareNativeProfile = 'high';
    }
    if (typeof result.screenShareGpuId !== 'string') {
      result.screenShareGpuId = null;
    }
    if (!SCREEN_SHARE_VIDEO_ENCODERS.includes(result.screenShareVideoEncoder as ScreenShareVideoEncoder)) {
      result.screenShareVideoEncoder = null;
    }
    if (typeof result.screenShareNativeWhipSimulcastEnabled !== 'boolean') {
      result.screenShareNativeWhipSimulcastEnabled = false;
    }
    if (typeof result.screenshareWizardCompletedAt !== 'number' || !Number.isFinite(result.screenshareWizardCompletedAt)) {
      result.screenshareWizardCompletedAt = null;
    }
    if (!('debugGameActivity' in parsed)) {
      try {
        if (window.localStorage.getItem('catrealm:debug-game-activity') === '1') {
          result.debugGameActivity = true;
        }
      } catch {
        // ignore storage errors
      }
    }
    // The voice debug console used to default to on. Reset it once so the
    // debugger no longer auto-opens; re-enabling it afterward sticks.
    try {
      if (window.localStorage.getItem('catrealm:voice-debug-reset') !== '1') {
        result.voiceDebugConsoleEnabled = false;
        window.localStorage.setItem('catrealm:voice-debug-reset', '1');
        saveSettings(result);
      }
    } catch {
      result.voiceDebugConsoleEnabled = false;
    }
    if (applyOneTimeDefaultChanges(result, true)) saveSettings(result);
    return result;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(next: SettingsData) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

// Callbacks invoked whenever an audio-processing setting changes.
// Registered by voiceStore / callStore to rebuild pipelines without
// creating a circular import dependency.
const _audioSettingsCallbacks: Array<() => void> = [];
export function registerOnAudioSettingsChanged(cb: () => void): void {
  _audioSettingsCallbacks.push(cb);
}
function _notifyAudioSettingsChanged() {
  _audioSettingsCallbacks.forEach((cb) => cb());
}

// Separate callbacks for threshold-only changes (no full rebuild needed).
const _audioThresholdCallbacks: Array<(db: number) => void> = [];
export function registerOnNoiseGateThresholdChanged(cb: (db: number) => void): void {
  _audioThresholdCallbacks.push(cb);
}
function _notifyThresholdChanged(db: number) {
  _audioThresholdCallbacks.forEach((cb) => cb(db));
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const initial = loadSettings();
  const getSnapshot = (): SettingsData => {
    const state = get();
    const snapshot: Partial<SettingsData> = {};
    for (const key in DEFAULT_SETTINGS) {
      snapshot[key as keyof SettingsData] = state[key as keyof SettingsData] as any;
    }
    return snapshot as SettingsData;
  };
  return {
    // Spread all initial settings
    ...initial,

    // Setters
    setPlayGifAvatars: (value) => {
      set({ playGifAvatars: value });
      saveSettings({ ...getSnapshot(), playGifAvatars: value });
    },
    setShowAvatarBackground: (value) => {
      set({ showAvatarBackground: value });
      saveSettings({ ...getSnapshot(), showAvatarBackground: value });
    },
    setEnableImageThumbnailing: (value) => {
      set({ enableImageThumbnailing: value });
      saveSettings({ ...getSnapshot(), enableImageThumbnailing: value });
    },
    setDisableEmbedAutoplay: (value) => {
      set({ disableEmbedAutoplay: value });
      saveSettings({ ...getSnapshot(), disableEmbedAutoplay: value });
    },
    setEmoteSizePx: (value) => {
      set({ emoteSizePx: value });
      saveSettings({ ...getSnapshot(), emoteSizePx: value });
    },
    setVoiceInputDeviceId: (value) => {
      set({ voiceInputDeviceId: value });
      saveSettings({ ...getSnapshot(), voiceInputDeviceId: value });
    },
    setVoiceInputMode: (value) => {
      set({ voiceInputMode: value });
      saveSettings({ ...getSnapshot(), voiceInputMode: value });
    },
    setVoiceOutputDeviceId: (value) => {
      set({ voiceOutputDeviceId: value });
      saveSettings({ ...getSnapshot(), voiceOutputDeviceId: value });
    },
    setVoiceCallE2EEEnabled: (value) => {
      set({ voiceCallE2EEEnabled: value });
      saveSettings({ ...getSnapshot(), voiceCallE2EEEnabled: value });
    },
    setReconnectToRealtimeChannels: (value) => {
      set({ reconnectToRealtimeChannels: value });
      saveSettings({ ...getSnapshot(), reconnectToRealtimeChannels: value });
      if (!value) {
        clearRealtimeReconnectTarget();
        useUIStore.getState().clearRealtimeReconnectPrompt();
      }
    },
    setAutoTryHttpRealmGateway: (value) => {
      set({ autoTryHttpRealmGateway: value });
      saveSettings({ ...getSnapshot(), autoTryHttpRealmGateway: value });
    },
    setVoiceUserVolume: (userId, value) => {
      const next = Math.max(0, Math.min(300, Math.round(value)));
      const voiceUserVolumes = { ...get().voiceUserVolumes };
      if (next === 50) delete voiceUserVolumes[userId];
      else voiceUserVolumes[userId] = next;
      set({ voiceUserVolumes });
      saveSettings({ ...getSnapshot(), voiceUserVolumes });
    },
    setVoiceUserVolumes: (values) => {
      const voiceUserVolumes: Record<string, number> = {};
      for (const [userId, rawValue] of Object.entries(values || {})) {
        const key = String(userId || '').trim();
        if (!key) continue;
        const num = Number(rawValue);
        if (!Number.isFinite(num)) continue;
        const clamped = Math.max(0, Math.min(300, Math.round(num)));
        if (clamped === 50) continue;
        voiceUserVolumes[key] = clamped;
      }
      set({ voiceUserVolumes });
      saveSettings({ ...getSnapshot(), voiceUserVolumes });
    },
    clearVoiceUserVolumes: () => {
      const voiceUserVolumes: Record<string, number> = {};
      set({ voiceUserVolumes });
      saveSettings({ ...getSnapshot(), voiceUserVolumes });
    },
    setScreenshareFps: (value) => {
      set({ screenshareFps: value });
      saveSettings({ ...getSnapshot(), screenshareFps: value });
    },
    setScreenshareResolution: (value) => {
      set({ screenshareResolution: value });
      saveSettings({ ...getSnapshot(), screenshareResolution: value });
    },
    setScreenshareAudio: (value) => {
      set({ screenshareAudio: value });
      saveSettings({ ...getSnapshot(), screenshareAudio: value });
    },
    setScreenshareDegradationPreference: (value) => {
      set({ screenshareDegradationPreference: value });
      saveSettings({ ...getSnapshot(), screenshareDegradationPreference: value });
    },
    setScreenshareQualityPreset: (value) => {
      set({ screenshareQualityPreset: value });
      saveSettings({ ...getSnapshot(), screenshareQualityPreset: value });
    },
    setScreenshareCodecPreference: (value) => {
      set({ screenshareCodecPreference: value });
      saveSettings({ ...getSnapshot(), screenshareCodecPreference: value });
    },
    setScreenShareViewerQuality: (value) => {
      const screenShareViewerQuality = SCREEN_SHARE_VIEWER_QUALITIES.includes(value) ? value : 'auto';
      set({ screenShareViewerQuality });
      saveSettings({ ...getSnapshot(), screenShareViewerQuality });
    },
    setScreenShareSimulcastEnabled: (value) => {
      set({ screenShareSimulcastEnabled: value });
      saveSettings({ ...getSnapshot(), screenShareSimulcastEnabled: value });
    },
    setScreenShareHardwareEncoding: (value) => {
      set({ screenShareHardwareEncoding: value });
      const snapshot = { ...getSnapshot(), screenShareHardwareEncoding: value };
      saveSettings(snapshot);
      if (typeof window !== 'undefined') {
        void window.electron?.setScreenShareVideoEncoding?.({
          hardwareEncoding: value,
          encoderBackend: snapshot.screenShareEncoderBackend,
        }).catch(() => undefined);
      }
    },
    setScreenShareEncoderBackend: (value) => {
      set({ screenShareEncoderBackend: value });
      const snapshot = { ...getSnapshot(), screenShareEncoderBackend: value };
      saveSettings(snapshot);
      if (typeof window !== 'undefined') {
        void window.electron?.setScreenShareVideoEncoding?.({
          hardwareEncoding: snapshot.screenShareHardwareEncoding,
          encoderBackend: value,
        }).catch(() => undefined);
      }
    },
    setScreenShareDesktopCaptureMode: (value) => {
      const screenShareDesktopCaptureMode = SCREEN_SHARE_DESKTOP_CAPTURE_MODES.includes(value) ? value : 'auto';
      set({ screenShareDesktopCaptureMode });
      saveSettings({ ...getSnapshot(), screenShareDesktopCaptureMode });
    },
    setScreenShareNativeWhipEnabled: (value) => {
      set({ screenShareNativeWhipEnabled: value });
      saveSettings({ ...getSnapshot(), screenShareNativeWhipEnabled: value });
    },
    setScreenShareNativeProfile: (value) => {
      const screenShareNativeProfile = SCREEN_SHARE_NATIVE_PROFILES.includes(value) ? value : 'high';
      set({ screenShareNativeProfile });
      saveSettings({ ...getSnapshot(), screenShareNativeProfile });
    },
    setScreenShareGpu: (gpuId, encoder) => {
      const screenShareGpuId = gpuId || null;
      const screenShareVideoEncoder = encoder && SCREEN_SHARE_VIDEO_ENCODERS.includes(encoder) ? encoder : null;
      set({ screenShareGpuId, screenShareVideoEncoder });
      saveSettings({ ...getSnapshot(), screenShareGpuId, screenShareVideoEncoder });
    },
    setScreenShareNativeWhipSimulcastEnabled: (value) => {
      set({ screenShareNativeWhipSimulcastEnabled: value });
      saveSettings({ ...getSnapshot(), screenShareNativeWhipSimulcastEnabled: value });
    },
    setScreenshareWizardCompletedAt: (value) => {
      const screenshareWizardCompletedAt = typeof value === 'number' && Number.isFinite(value) ? value : null;
      set({ screenshareWizardCompletedAt });
      saveSettings({ ...getSnapshot(), screenshareWizardCompletedAt });
    },
    setVoiceMuted: (value) => {
      set({ voiceMuted: value });
      saveSettings({ ...getSnapshot(), voiceMuted: value });
    },
    setVoiceDeafened: (value) => {
      set({ voiceDeafened: value });
      saveSettings({ ...getSnapshot(), voiceDeafened: value });
    },
    setNotificationsEnabled: (value) => {
      set({ notificationsEnabled: value });
      saveSettings({ ...getSnapshot(), notificationsEnabled: value });
    },
    setSoundSetting: (key, value) => {
      set({ [key]: value } as any);
      saveSettings({ ...getSnapshot(), [key]: value });
    },
    setSoundVolume: (key, value) => {
      const volume = Math.max(0, Math.min(100, value));
      const soundVolumes = { ...get().soundVolumes, [key]: volume };
      set({ soundVolumes });
      saveSettings({ ...getSnapshot(), soundVolumes });
    },
    setTheme: (value) => {
      set({ theme: value });
      saveSettings({ ...getSnapshot(), theme: value });
    },
    setMotionIntensity: (value) => {
      const motionIntensity = MOTION_INTENSITIES.includes(value) ? value : 'middle';
      set({ motionIntensity });
      saveSettings({ ...getSnapshot(), motionIntensity });
    },
    setHeavyAnimationsEnabled: (value) => {
      set({ heavyAnimationsEnabled: value });
      saveSettings({ ...getSnapshot(), heavyAnimationsEnabled: value });
    },
    setLanguage: (value) => {
      const language = LANGUAGE_OPTIONS.includes(value) ? value : DEFAULT_LANGUAGE;
      set({ language });
      saveSettings({ ...getSnapshot(), language });
      void i18n.changeLanguage(language);
    },
    setTimeFormat: (value) => {
      set({ timeFormat: value });
      saveSettings({ ...getSnapshot(), timeFormat: value });
    },
    setStreamerMode: (value) => {
      set({ streamerMode: value });
      saveSettings({ ...getSnapshot(), streamerMode: value });
    },
    setStreamerModeAutoDetect: (value) => {
      set({ streamerModeAutoDetect: value });
      saveSettings({ ...getSnapshot(), streamerModeAutoDetect: value });
    },
    setStreamerModeHidePI: (value) => {
      set({ streamerModeHidePI: value });
      saveSettings({ ...getSnapshot(), streamerModeHidePI: value });
    },
    setStreamerModeDisableSounds: (value) => {
      set({ streamerModeDisableSounds: value });
      saveSettings({ ...getSnapshot(), streamerModeDisableSounds: value });
    },
    setDebugServerStates: (value) => {
      set({ debugServerStates: value });
      saveSettings({ ...getSnapshot(), debugServerStates: value });
    },
    setDebugCallingStates: (value) => {
      set({ debugCallingStates: value });
      saveSettings({ ...getSnapshot(), debugCallingStates: value });
    },
    setDebugTheaterStates: (value) => {
      set({ debugTheaterStates: value });
      saveSettings({ ...getSnapshot(), debugTheaterStates: value });
    },
    setDebugUIHoverInspector: (value) => {
      set({ debugUIHoverInspector: value });
      saveSettings({ ...getSnapshot(), debugUIHoverInspector: value });
    },
    setDebugFpsOverlay: (value) => {
      set({ debugFpsOverlay: value });
      saveSettings({ ...getSnapshot(), debugFpsOverlay: value });
    },
    setDebugGameActivity: (value) => {
      set({ debugGameActivity: value });
      saveSettings({ ...getSnapshot(), debugGameActivity: value });
      if (typeof window !== 'undefined') {
        try {
          if (value) window.localStorage.setItem('catrealm:debug-game-activity', '1');
          else window.localStorage.removeItem('catrealm:debug-game-activity');
        } catch {
          // ignore storage errors
        }
      }
    },
    setForceMobileViewOnDesktop: (value) => {
      set({ forceMobileViewOnDesktop: value });
      saveSettings({ ...getSnapshot(), forceMobileViewOnDesktop: value });
    },
    setOpenOnStartup: (value) => {
      set({ openOnStartup: value });
      saveSettings({ ...getSnapshot(), openOnStartup: value });
    },
    setMinimizeToTray: (value) => {
      set({ minimizeToTray: value });
      saveSettings({ ...getSnapshot(), minimizeToTray: value });
    },
    setOpenLinksInApp: (value) => {
      set({ openLinksInApp: value });
      saveSettings({ ...getSnapshot(), openLinksInApp: value });
    },
    setGameActivityEnabled: (value) => {
      set({ gameActivityEnabled: value });
      saveSettings({ ...getSnapshot(), gameActivityEnabled: value });
    },
    setDevBuilds: (value) => {
      const updateChannel: AppUpdateChannel = value ? 'dev' : DEFAULT_UPDATE_CHANNEL;
      set({ devBuilds: value, updateChannel });
      saveSettings({ ...getSnapshot(), devBuilds: value, updateChannel });
    },
    setUpdateChannel: (value) => {
      const updateChannel: AppUpdateChannel = normalizeUpdateChannelId(value) || DEFAULT_UPDATE_CHANNEL;
      const devBuilds = updateChannel !== DEFAULT_UPDATE_CHANNEL;
      set({ updateChannel, devBuilds });
      saveSettings({ ...getSnapshot(), updateChannel, devBuilds });
    },
    setVoiceDebugConsoleEnabled: (value) => {
      set({ voiceDebugConsoleEnabled: value });
      saveSettings({ ...getSnapshot(), voiceDebugConsoleEnabled: value });
    },
    setNoiseGateEnabled: (value) => {
      set({ noiseGateEnabled: value });
      saveSettings({ ...getSnapshot(), noiseGateEnabled: value });
      _notifyAudioSettingsChanged();
    },
    setNoiseGateThreshold: (value) => {
      const clamped = Math.max(-60, Math.min(-10, value));
      set({ noiseGateThreshold: clamped });
      saveSettings({ ...getSnapshot(), noiseGateThreshold: clamped });
      // Live-update worklet threshold — no pipeline rebuild needed
      _notifyThresholdChanged(clamped);
    },
    setRnnoiseEnabled: (value) => {
      set({ rnnoiseEnabled: value });
      saveSettings({ ...getSnapshot(), rnnoiseEnabled: value });
      _notifyAudioSettingsChanged();
    },
    setObsOverlayEnabled: (value) => {
      set({ obsOverlayEnabled: value });
      saveSettings({ ...getSnapshot(), obsOverlayEnabled: value });
    },
    setObsOverlayPort: (value) => {
      const port = Math.max(1, Math.min(65535, Math.round(value)));
      set({ obsOverlayPort: port });
      saveSettings({ ...getSnapshot(), obsOverlayPort: port });
    },
    setObsOverlayShowNames: (value) => {
      set({ obsOverlayShowNames: value });
      saveSettings({ ...getSnapshot(), obsOverlayShowNames: value });
    },
    setObsOverlayAvatarSize: (value) => {
      set({ obsOverlayAvatarSize: value });
      saveSettings({ ...getSnapshot(), obsOverlayAvatarSize: value });
    },
    setObsOverlayGrayscaleWhenSilent: (value) => {
      set({ obsOverlayGrayscaleWhenSilent: value });
      saveSettings({ ...getSnapshot(), obsOverlayGrayscaleWhenSilent: value });
    },
    setObsOverlayHideWhenSilent: (value) => {
      set({ obsOverlayHideWhenSilent: value });
      saveSettings({ ...getSnapshot(), obsOverlayHideWhenSilent: value });
    },
    setObsOverlaySquareIcons: (value) => {
      set({ obsOverlaySquareIcons: value });
      saveSettings({ ...getSnapshot(), obsOverlaySquareIcons: value });
    },
    setObsOverlayReactiveAvatars: (value) => {
      set({ obsOverlayReactiveAvatars: value });
      saveSettings({ ...getSnapshot(), obsOverlayReactiveAvatars: value });
    },
    setCatLabTextPreview: (value) => {
      set({ catLabTextPreview: value });
      saveSettings({ ...getSnapshot(), catLabTextPreview: value });
    },
    setCatLabFullProfileButton: (value) => {
      set({ catLabFullProfileButton: value });
      saveSettings({ ...getSnapshot(), catLabFullProfileButton: value });
    },
    setCatLabAudioTracks: (value) => {
      set({ catLabAudioTracks: value });
      saveSettings({ ...getSnapshot(), catLabAudioTracks: value });
    },
    setCatLabAutoTranslate: (value) => {
      set({ catLabAutoTranslate: value });
      saveSettings({ ...getSnapshot(), catLabAutoTranslate: value });
    },
    setVoiceBgMode: (value) => {
      set({ voiceBgMode: value });
      saveSettings({ ...getSnapshot(), voiceBgMode: value });
    },
    setVoiceBgColors: (value) => {
      const colors = value
        .filter((c) => /^#[0-9a-fA-F]{6}$/.test(c))
        .slice(0, VOICE_BG_MAX_COLORS);
      set({ voiceBgColors: colors });
      saveSettings({ ...getSnapshot(), voiceBgColors: colors });
    },
    setVoiceBgPattern: (value) => {
      set({ voiceBgPattern: value });
      saveSettings({ ...getSnapshot(), voiceBgPattern: value });
    },
    setVoiceBgAnimated: (value) => {
      set({ voiceBgAnimated: value });
      saveSettings({ ...getSnapshot(), voiceBgAnimated: value });
    },
    setVoiceBgScene: (value) => {
      set({ voiceBgScene: value });
      saveSettings({ ...getSnapshot(), voiceBgScene: value });
    },
    setVoiceBgImageUpdatedAt: (value) => {
      set({ voiceBgImageUpdatedAt: value });
      saveSettings({ ...getSnapshot(), voiceBgImageUpdatedAt: value });
    },
  };
});
