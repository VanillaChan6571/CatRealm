import { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowLeft, ChevronRight, X } from 'lucide-react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { ImageCropModal } from '../ui/ImageCropModal';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { createApi } from '../../lib/api';
import { isHttpGatewayRealm } from '../../lib/httpRealmGateway';
import { createAuthenticatedApi } from '../../lib/authApi';
import { useSettingsStore } from '../../stores/settingsStore';
import { useCustomThemeStore } from '../../stores/customThemeStore';
import { usePresenceStore } from '../../stores/presenceStore';
import { syncCentralProfileToJoinedServers, syncCentralProfileToServer, useServerStore } from '../../stores/serverStore';
import { getServerAvatarOverride } from '../../lib/serverProfileAvatar';
import { useContentSocialStore } from '../../stores/contentSocialStore';
import { useChannelStore } from '../../stores/channelStore';
import { useVersionStore } from '../../stores/versionStore';
import type { Profile } from '../../types';
import { buildAudioPipeline } from '../../lib/audioProcessing';
import { getSoundCandidates } from '../../lib/notificationSounds';
import { isTauriDesktop, isElectronDesktop } from '../../lib/desktopCapture';
import { useAmbienceFxStore } from '../../stores/ambienceFxStore';
import {
  clearCentralPresenceActivityCache,
  writeCentralPresenceCache,
} from '../../lib/centralPresenceCache';
import { isDetectorManagedActivity } from '../../lib/desktopGameActivity';
import { clearManualActivity, readManualActivity, writeManualActivity } from '../../lib/manualActivityCache';
import { useGameActivityStore } from '../../stores/gameActivityStore';

import type { ActivityType, CropKind, EmotePreviewItem, PersonalExpressionSummary, PersonalExpressionItem, PersonalExpressionGroups, ContentSocialPrefsPayload } from './settings/settingsTypes';
import { EMOTE_SIZE_OPTIONS, DEFAULT_PREVIEW_EMOJIS, EMPTY_PERSONAL_EXPRESSIONS, sanitizeExpressionName, pickRandomItems } from './settings/emoteHelpers';

import { ProfileTab } from './settings/ProfileTab';
import { ServerProfilesTab } from './settings/ServerProfilesTab';
import { VoiceTab } from './settings/VoiceTab';
import { NotificationsTab } from './settings/NotificationsTab';
import { AppearanceTab } from './settings/AppearanceTab';
import { AnimatePresence, motion } from 'motion/react';
import { useMotionProfile } from '../../lib/motion';
import { EmotesTab } from './settings/EmotesTab';
import { WindowsTab } from './settings/WindowsTab';
import { UpdatesTab } from './settings/UpdatesTab';
import { TimeFormatTab } from './settings/TimeFormatTab';
import { LanguageTab } from './settings/LanguageTab';
import { StreamerModeTab } from './settings/StreamerModeTab';
import { ContentSocialTab } from './settings/ContentSocialTab';
import { DeveloperTab } from './settings/DeveloperTab';
import { CentralStaffTab } from './settings/CentralStaffTab';

const CATREALM_ADMIN_ID = 'cb601179-57e4-476d-8fb4-b9d0c6235c30';
import { isViewAsRoleDebugEnabled, setViewAsRoleDebugEnabled } from '../../lib/viewAsRoleDebug';
import { CatLabTab } from './settings/CatLabTab';
import { AccountSecuritySection } from './settings/AccountSecuritySection';

type SettingsTab = 'profile' | 'server-profiles' | 'voice' | 'notifications' | 'appearance' | 'emotes-settings' | 'windows' | 'updates' | 'time-format' | 'language' | 'streamer-mode' | 'content-social' | 'cat-lab' | 'developer-debug' | 'central-staff' | 'account-security';

function readInitialSettingsTab(value: unknown): SettingsTab {
  if (value && typeof value === 'object' && 'initialTab' in value) {
    const candidate = (value as { initialTab?: unknown }).initialTab;
    if (
      candidate === 'profile'
      || candidate === 'server-profiles'
      || candidate === 'voice'
      || candidate === 'notifications'
      || candidate === 'appearance'
      || candidate === 'emotes-settings'
      || candidate === 'windows'
      || candidate === 'updates'
      || candidate === 'time-format'
      || candidate === 'language'
      || candidate === 'streamer-mode'
      || candidate === 'content-social'
      || candidate === 'cat-lab'
      || candidate === 'developer-debug'
      || candidate === 'central-staff'
      || candidate === 'account-security'
    ) {
      return candidate;
    }
  }
  return 'profile';
}

export function ProfileSettingsModal() {
  const { t } = useTranslation();
  const readDisplayName = (data: { displayName?: string | null; display_name?: string | null }) =>
    data.displayName ?? data.display_name ?? null;
  const readActivityType = (data: { activityType?: string | null; activity_type?: string | null }): ActivityType => {
    const value = data.activityType ?? data.activity_type ?? null;
    if (value === 'Playing' || value === 'Listening' || value === 'Watching' || value === 'Custom') return value;
    return null;
  };
  const readActivityText = (data: { activityText?: string | null; activity_text?: string | null }) =>
    data.activityText ?? data.activity_text ?? null;
  const readActivityStartedAt = (data: { activityStartedAt?: number | null; activity_started_at?: number | null }) =>
    data.activityStartedAt ?? data.activity_started_at ?? null;
  const readCustomStatusText = (data: { customStatusText?: string | null; custom_status_text?: string | null }) =>
    data.customStatusText ?? data.custom_status_text ?? null;

  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData);
  const closeModal = useUIStore((s) => s.closeModal);
  const openModal = useUIStore((s) => s.openModal);
  const settingsWasOpenRef = useRef(false);

  const scheduleRendererMemoryReclaim = useCallback((delayMs: number) => {
    let cancelled = false;
    let idleId: number | null = null;
    const timerId = window.setTimeout(() => {
      if (cancelled) return;
      const collect = () => {
        if (cancelled) return;
        const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
        if (typeof gc === 'function') gc();
      };
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(collect, { timeout: 2_000 });
      } else {
        collect();
      }
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
    };
  }, []);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const servers = useServerStore((s) => s.servers);
  const activeServerUrl = useServerStore((s) => s.activeServerUrl);
  const setContentSocialPrefs = useContentSocialStore((s) => s.setPrefs);

  // Settings from settingsStore
  const playGifAvatars = useSettingsStore((s) => s.playGifAvatars);
  const setPlayGifAvatars = useSettingsStore((s) => s.setPlayGifAvatars);
  const showAvatarBackground = useSettingsStore((s) => s.showAvatarBackground);
  const setShowAvatarBackground = useSettingsStore((s) => s.setShowAvatarBackground);
  const enableImageThumbnailing = useSettingsStore((s) => s.enableImageThumbnailing);
  const setEnableImageThumbnailing = useSettingsStore((s) => s.setEnableImageThumbnailing);
  const disableEmbedAutoplay = useSettingsStore((s) => s.disableEmbedAutoplay);
  const setDisableEmbedAutoplay = useSettingsStore((s) => s.setDisableEmbedAutoplay);
  const emoteSizePx = useSettingsStore((s) => s.emoteSizePx);
  const setEmoteSizePx = useSettingsStore((s) => s.setEmoteSizePx);
  const voiceInputDeviceId = useSettingsStore((s) => s.voiceInputDeviceId);
  const voiceOutputDeviceId = useSettingsStore((s) => s.voiceOutputDeviceId);
  const setVoiceOutputDeviceId = useSettingsStore((s) => s.setVoiceOutputDeviceId);
  const rnnoiseEnabled = useSettingsStore((s) => s.rnnoiseEnabled);
  const setRnnoiseEnabled = useSettingsStore((s) => s.setRnnoiseEnabled);
  const noiseGateEnabled = useSettingsStore((s) => s.noiseGateEnabled);
  const setNoiseGateEnabled = useSettingsStore((s) => s.setNoiseGateEnabled);
  const noiseGateThreshold = useSettingsStore((s) => s.noiseGateThreshold);
  const setNoiseGateThreshold = useSettingsStore((s) => s.setNoiseGateThreshold);
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useSettingsStore((s) => s.setNotificationsEnabled);
  const setSoundSetting = useSettingsStore((s) => s.setSoundSetting);
  const setSoundVolume = useSettingsStore((s) => s.setSoundVolume);
  const settings = useSettingsStore((s) => s);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const motionIntensity = useSettingsStore((s) => s.motionIntensity);
  const setMotionIntensity = useSettingsStore((s) => s.setMotionIntensity);
  const heavyAnimationsEnabled = useSettingsStore((s) => s.heavyAnimationsEnabled);
  const setHeavyAnimationsEnabled = useSettingsStore((s) => s.setHeavyAnimationsEnabled);
  const motionProfile = useMotionProfile();
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const setTimeFormat = useSettingsStore((s) => s.setTimeFormat);
  const streamerMode = useSettingsStore((s) => s.streamerMode);
  const setStreamerMode = useSettingsStore((s) => s.setStreamerMode);
  const streamerModeAutoDetect = useSettingsStore((s) => s.streamerModeAutoDetect);
  const setStreamerModeAutoDetect = useSettingsStore((s) => s.setStreamerModeAutoDetect);
  const streamerModeHidePI = useSettingsStore((s) => s.streamerModeHidePI);
  const setStreamerModeHidePI = useSettingsStore((s) => s.setStreamerModeHidePI);
  const streamerModeDisableSounds = useSettingsStore((s) => s.streamerModeDisableSounds);
  const setStreamerModeDisableSounds = useSettingsStore((s) => s.setStreamerModeDisableSounds);
  const debugServerStates = useSettingsStore((s) => s.debugServerStates);
  const setDebugServerStates = useSettingsStore((s) => s.setDebugServerStates);
  const debugCallingStates = useSettingsStore((s) => s.debugCallingStates);
  const setDebugCallingStates = useSettingsStore((s) => s.setDebugCallingStates);
  const debugTheaterStates = useSettingsStore((s) => s.debugTheaterStates);
  const setDebugTheaterStates = useSettingsStore((s) => s.setDebugTheaterStates);
  const debugUIHoverInspector = useSettingsStore((s) => s.debugUIHoverInspector);
  const setDebugUIHoverInspector = useSettingsStore((s) => s.setDebugUIHoverInspector);
  const debugFpsOverlay = useSettingsStore((s) => s.debugFpsOverlay);
  const setDebugFpsOverlay = useSettingsStore((s) => s.setDebugFpsOverlay);
  const debugGameActivity = useSettingsStore((s) => s.debugGameActivity);
  const setDebugGameActivity = useSettingsStore((s) => s.setDebugGameActivity);
  const forceMobileViewOnDesktop = useSettingsStore((s) => s.forceMobileViewOnDesktop);
  const setForceMobileViewOnDesktop = useSettingsStore((s) => s.setForceMobileViewOnDesktop);
  const openOnStartup = useSettingsStore((s) => s.openOnStartup);
  const setOpenOnStartup = useSettingsStore((s) => s.setOpenOnStartup);
  const minimizeToTray = useSettingsStore((s) => s.minimizeToTray);
  const setMinimizeToTray = useSettingsStore((s) => s.setMinimizeToTray);
  const openLinksInApp = useSettingsStore((s) => s.openLinksInApp);
  const setOpenLinksInApp = useSettingsStore((s) => s.setOpenLinksInApp);
  const gameActivityEnabled = useSettingsStore((s) => s.gameActivityEnabled);
  const setGameActivityEnabled = useSettingsStore((s) => s.setGameActivityEnabled);
  const devBuilds = useSettingsStore((s) => s.devBuilds);
  const setDevBuilds = useSettingsStore((s) => s.setDevBuilds);
  const updateChannel = useSettingsStore((s) => s.updateChannel);
  const setUpdateChannel = useSettingsStore((s) => s.setUpdateChannel);
  const voiceDebugConsoleEnabled = useSettingsStore((s) => s.voiceDebugConsoleEnabled);
  const setVoiceDebugConsoleEnabled = useSettingsStore((s) => s.setVoiceDebugConsoleEnabled);
  const obsOverlayEnabled = useSettingsStore((s) => s.obsOverlayEnabled);
  const setObsOverlayEnabled = useSettingsStore((s) => s.setObsOverlayEnabled);
  const obsOverlayPort = useSettingsStore((s) => s.obsOverlayPort);
  const setObsOverlayPort = useSettingsStore((s) => s.setObsOverlayPort);
  const obsOverlayShowNames = useSettingsStore((s) => s.obsOverlayShowNames);
  const setObsOverlayShowNames = useSettingsStore((s) => s.setObsOverlayShowNames);
  const obsOverlayAvatarSize = useSettingsStore((s) => s.obsOverlayAvatarSize);
  const setObsOverlayAvatarSize = useSettingsStore((s) => s.setObsOverlayAvatarSize);
  const obsOverlayGrayscaleWhenSilent = useSettingsStore((s) => s.obsOverlayGrayscaleWhenSilent);
  const setObsOverlayGrayscaleWhenSilent = useSettingsStore((s) => s.setObsOverlayGrayscaleWhenSilent);
  const obsOverlayHideWhenSilent = useSettingsStore((s) => s.obsOverlayHideWhenSilent);
  const setObsOverlayHideWhenSilent = useSettingsStore((s) => s.setObsOverlayHideWhenSilent);
  const obsOverlaySquareIcons = useSettingsStore((s) => s.obsOverlaySquareIcons);
  const setObsOverlaySquareIcons = useSettingsStore((s) => s.setObsOverlaySquareIcons);
  const screenShareNativeWhipSimulcastEnabled = useSettingsStore((s) => s.screenShareNativeWhipSimulcastEnabled);
  const setScreenShareNativeWhipSimulcastEnabled = useSettingsStore((s) => s.setScreenShareNativeWhipSimulcastEnabled);
  const clientVersion = useVersionStore((s) => s.clientVersion);
  const gameActivityState = useGameActivityStore((s) => s.detectorState);
  const gameActivityStateRef = useRef(gameActivityState);
  gameActivityStateRef.current = gameActivityState;
  const isGameActivityActive = gameActivityState.status === 'active' && !!gameActivityState.activity;
  const { themes: customThemes, addTheme, removeTheme } = useCustomThemeStore();
  const [importError, setImportError] = useState<string | null>(null);
  const themeFileInputRef = useRef<HTMLInputElement>(null);

  const updateOnlineUser = usePresenceStore((s) => s.updateOnlineUser);
  const fetchChannels = useChannelStore((s) => s.fetchChannels);
  const getProfileApi = () => user?.accountType === 'central' ? createAuthenticatedApi() : createApi();
  const getContentSocialApi = () => (
    user?.accountType === 'central' ? createAuthenticatedApi() : createApi()
  );

  const setStatus = (status: 'online' | 'away' | 'sleeping' | 'invisible') => {
    const api = getProfileApi();
    api.put('/api/profile/me/status', { status })
      .then((res) => {
        updateUser({ status: res.data.status });
        updateOnlineUser(res.data.id, { status: res.data.status });
      })
      .catch(() => {
        // ignore for now
      });

    if (isCentral && connectedToServer) {
      const serverApi = createApi();
      serverApi.put('/api/profile/me/status', { status })
        .then((res) => updateOnlineUser(res.data.id, { status: res.data.status }))
        .catch(() => {});
    }
  };

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [cropTarget, setCropTarget] = useState<{ kind: CropKind; file: File; serverUrl?: string } | null>(null);
  const [bioDraft, setBioDraft] = useState('');
  const [savingBio, setSavingBio] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [activityTypeDraft, setActivityTypeDraft] = useState('');
  const [activityTextDraft, setActivityTextDraft] = useState('');
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [mobilePane, setMobilePane] = useState<'nav' | 'content'>('nav');
  const selectTab = (tab: SettingsTab) => { setActiveTab(tab); setMobilePane('content'); };
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [nativeVoiceBackend] = useState(
    () => typeof window !== 'undefined'
      && typeof window.electron?.getNativeVoiceSupport === 'function'
      && typeof RTCPeerConnection === 'undefined',
  );
  const [loadingAudioInputs, setLoadingAudioInputs] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [recordingTest, setRecordingTest] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [testDurationSec, setTestDurationSec] = useState(5);
  const [testCountdown, setTestCountdown] = useState<number | null>(null);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);
  const ambienceAudioRef = useRef<HTMLAudioElement | null>(null);
  const [testPlaying, setTestPlaying] = useState(false);

  // Server-specific avatar state (central accounts only)
  const [selectedServerUrl, setSelectedServerUrl] = useState<string | null>(null);
  const [serverAvatars, setServerAvatars] = useState<Record<string, string | null>>({});
  const [serverBanners, setServerBanners] = useState<Record<string, string | null>>({});
  const [uploadingServerAvatar, setUploadingServerAvatar] = useState(false);
  const [uploadingServerBanner, setUploadingServerBanner] = useState(false);
  const isCentral = user?.accountType === 'central';
  const connectedToServer = !!serverUrl;
  const isDesktopClient = typeof window !== 'undefined' && Boolean(window.electron?.checkForUpdates);

  // Server version info
  const [serverVersion, setServerVersion] = useState<string>('');
  const [gitHash, setGitHash] = useState<string>('');

  // Content & Social settings
  const [allowNsfw, setAllowNsfw] = useState(false);
  const [nsfwLewds, setNsfwLewds] = useState(false);
  const [nsfwBlood, setNsfwBlood] = useState(false);
  const [nsfwGore, setNsfwGore] = useState(false);
  const [dmFilter, setDmFilter] = useState<'all' | 'non-friends' | 'none'>('non-friends');
  const [allowDms, setAllowDms] = useState(false);
  const [frEveryone, setFrEveryone] = useState(true);
  const startAmbiencePixels = useAmbienceFxStore((s) => s.startSpawning);
  const stopAmbiencePixels = useAmbienceFxStore((s) => s.stopSpawning);

  const stopAmbienceAudio = useCallback(() => {
    const audio = ambienceAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    ambienceAudioRef.current = null;
  }, []);

  useEffect(() => {
    const shouldPlayAmbience =
      activeModal === 'profileSettings' &&
      notificationsEnabled &&
      settings.soundAmbience;
    if (!shouldPlayAmbience) {
      stopAmbienceAudio();
      return;
    }

    const volume = Math.max(0, Math.min(1, (settings.soundVolumes?.soundAmbience ?? 60) / 100));
    const candidates = getSoundCandidates('ambience');
    if (candidates.length === 0) {
      stopAmbienceAudio();
      return;
    }
    let cancelled = false;
    const audio = ambienceAudioRef.current ?? new Audio();
    ambienceAudioRef.current = audio;
    audio.loop = true;
    audio.volume = volume;

    const startFrom = (index: number) => {
      if (cancelled || ambienceAudioRef.current !== audio || index >= candidates.length) return;
      audio.src = candidates[index];
      audio.play().catch(() => {
        if (!cancelled && ambienceAudioRef.current === audio) {
          startFrom(index + 1);
        }
      });
    };
    startFrom(0);

    return () => {
      cancelled = true;
      if (ambienceAudioRef.current === audio) {
        stopAmbienceAudio();
      }
    };
  }, [activeModal, notificationsEnabled, settings.soundAmbience, stopAmbienceAudio]);

  useEffect(() => {
    const audio = ambienceAudioRef.current;
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1, (settings.soundVolumes?.soundAmbience ?? 60) / 100));
  }, [settings.soundVolumes?.soundAmbience]);

  useEffect(() => {
    const shouldSpawn =
      activeModal === 'profileSettings' &&
      notificationsEnabled &&
      settings.soundAmbience;
    if (shouldSpawn) {
      startAmbiencePixels();
      return () => {
        stopAmbiencePixels();
      };
    }
    stopAmbiencePixels();
    return undefined;
  }, [activeModal, notificationsEnabled, settings.soundAmbience, startAmbiencePixels, stopAmbiencePixels]);
  const [frFriendOfFriends, setFrFriendOfFriends] = useState(true);
  const [frServerMembers, setFrServerMembers] = useState(true);
  const [customAllowedDomains, setCustomAllowedDomains] = useState<string[]>([]);
  const [contentSocialLoaded, setContentSocialLoaded] = useState(false);
  const [devPanelVisible, setDevPanelVisible] = useState(false);
  const [consoleCommand, setConsoleCommand] = useState('db-status');
  const [consoleRunning, setConsoleRunning] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const [consoleError, setConsoleError] = useState<string | null>(null);
  const [debugViewAsRole, setDebugViewAsRoleState] = useState(() => isViewAsRoleDebugEnabled());
  const devUnlockCountRef = useRef(0);
  const [emotePreviewPool, setEmotePreviewPool] = useState<EmotePreviewItem[]>([]);
  const [emotePreviewItems, setEmotePreviewItems] = useState<EmotePreviewItem[]>([]);
  const [loadingEmotePreview, setLoadingEmotePreview] = useState(false);
  const [personalSummary, setPersonalSummary] = useState<PersonalExpressionSummary>({
    animatedEmotes: 0,
    animatedStickers: 0,
    emoteLimit: 10,
    stickerLimit: 10,
  });
  const [personalExpressions, setPersonalExpressions] = useState<PersonalExpressionGroups>(EMPTY_PERSONAL_EXPRESSIONS);
  const [personalLoading, setPersonalLoading] = useState(false);
  const [personalError, setPersonalError] = useState<string | null>(null);
  const [uploadingPersonalKind, setUploadingPersonalKind] = useState<'emotes' | 'stickers' | null>(null);
  const [personalRenameDrafts, setPersonalRenameDrafts] = useState<Record<string, string>>({});
  const [savingPersonalId, setSavingPersonalId] = useState<string | null>(null);
  const [deletingPersonalId, setDeletingPersonalId] = useState<string | null>(null);
  const personalEmoteInputRef = useRef<HTMLInputElement | null>(null);
  const personalStickerInputRef = useRef<HTMLInputElement | null>(null);

  const [clientVersionBase, clientVersionPrerelease] = clientVersion.split('-', 2);
  const clientBuildLabel = (() => {
    if (!clientVersionPrerelease) return 'Stable';
    if (clientVersionPrerelease.startsWith('dev.')) {
      const devBuildId = clientVersionPrerelease.slice('dev.'.length);
      return devBuildId ? `DEV#${devBuildId}` : 'DEV';
    }
    return clientVersionPrerelease.toUpperCase();
  })();
  // Distinguish the desktop editions that share this renderer bundle:
  // Tauri/Rust build = "Sushi", Electron build = "Sparky", web = "Neko no Su".
  const clientEditionLabel = (() => {
    if (isTauriDesktop()) return '(Sushi)';
    if (isElectronDesktop()) return '(Sparky)';
    return '(Neko no Su)';
  })();

  useEffect(() => {
    if (activeModal !== 'profileSettings') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeModal, closeModal]);

  // Reset tab and one-time UI state only when the modal is opened or its target tab changes.
  // Intentionally NOT including gameActivityState — activity polling must not reset the active tab.
  useEffect(() => {
    if (activeModal !== 'profileSettings') return;
    setActiveTab(readInitialSettingsTab(modalData));
    // Opened at a specific section (e.g. from the small-screen You tab):
    // on phones, show that section rather than the section list.
    const hasInitialTab = !!modalData && typeof modalData === 'object' && 'initialTab' in modalData;
    setMobilePane(hasInitialTab ? 'content' : 'nav');
    setContentSocialLoaded(false);
    devUnlockCountRef.current = 0;
    setDevPanelVisible(false);
  }, [activeModal, modalData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Settings tab swaps create short-lived Blink/layout trees. Reclaim them once
  // the transition and initial data render have settled, never on the hot path.
  useEffect(() => {
    if (activeModal !== 'profileSettings') return undefined;
    return scheduleRendererMemoryReclaim(1_000);
  }, [activeModal, activeTab, scheduleRendererMemoryReclaim]);

  // Closing the modal is the largest reclaim opportunity because its full
  // viewport layout tree becomes unreachable at once.
  useEffect(() => {
    if (activeModal === 'profileSettings') {
      settingsWasOpenRef.current = true;
      return undefined;
    }
    if (!settingsWasOpenRef.current) return undefined;
    settingsWasOpenRef.current = false;
    return scheduleRendererMemoryReclaim(250);
  }, [activeModal, scheduleRendererMemoryReclaim]);

  useEffect(() => {
    if (activeModal !== 'profileSettings') return;
    setProfileError(null);
    setProfileLoading(true);
    const api = getProfileApi();
    api.get('/api/profile/me')
      .then((res) => {
        setProfile(res.data);
        setBioDraft(res.data.bio ?? '');
        setDisplayNameDraft(readDisplayName(res.data) ?? '');
        const nextCustomStatusText = readCustomStatusText(res.data);
        const nextActivityType = readActivityType(res.data);
        const nextActivityText = readActivityText(res.data);
        const nextActivityStartedAt = readActivityStartedAt(res.data);
        const detectorOwnsProfileActivity = isDetectorManagedActivity({
          activityType: nextActivityType,
          activityText: nextActivityText,
          detectorStatus: gameActivityStateRef.current.status,
          detectorActivity: gameActivityStateRef.current.activity,
        });
        const manualActivity = readManualActivity(res.data.id);
        const draftActivityType = detectorOwnsProfileActivity
          ? (manualActivity?.activityType ?? null)
          : nextActivityType;
        const draftActivityText = detectorOwnsProfileActivity
          ? (manualActivity?.activityText ?? null)
          : nextActivityText;
        setActivityTypeDraft(nextCustomStatusText ? 'Custom' : (draftActivityType ?? ''));
        setActivityTextDraft(nextCustomStatusText ?? draftActivityText ?? '');
        updateUser({
          avatar: res.data.avatar ?? null,
          banner: res.data.banner ?? null,
          bio: res.data.bio ?? '',
          displayName: readDisplayName(res.data),
          customStatusText: nextCustomStatusText,
          activityType: nextActivityType,
          activityText: nextActivityText,
          activityStartedAt: nextActivityStartedAt,
        });
        updateOnlineUser(res.data.id, { avatar: res.data.avatar ?? null });
      })
      .catch((err) => {
        const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to load profile';
        setProfileError(msg || 'Failed to load profile');
      })
      .finally(() => setProfileLoading(false));

    // Fetch server version info
    if (serverUrl || (!isCentral && user)) {
      const serverApi = createApi();
      serverApi.get('/api/server')
        .then((res) => {
          setServerVersion(res.data.version || '1.4.0');
          setGitHash(res.data.gitHash || 'unknown');
        })
        .catch(() => {
          // Fallback to default if fetch fails
          setServerVersion('1.4.0');
          setGitHash('unknown');
        });
    } else {
      setServerVersion('1.4.0');
      setGitHash('unknown');
    }

    // For central accounts, set default selected server and fetch all server avatars
    if (isCentral && servers.length > 0) {
      // Default to currently connected server, or first server
      const defaultServer = serverUrl || servers[0].url;
      setSelectedServerUrl(defaultServer);

      // Fetch avatars for all servers
      servers.forEach((server) => {
        axios.get(`${server.url}/api/profile/me`, {
          headers: { Authorization: `Bearer ${server.token}` },
        })
          .then((res) => {
            setServerAvatars((prev) => ({
              ...prev,
              [server.url]: getServerAvatarOverride(res.data),
            }));
            setServerBanners((prev) => ({
              ...prev,
              [server.url]: res.data.banner ?? null,
            }));
          })
          .catch(() => {
            setServerAvatars((prev) => ({
              ...prev,
              [server.url]: null,
            }));
            setServerBanners((prev) => ({
              ...prev,
              [server.url]: null,
            }));
          });
      });
    }
  }, [activeModal, isCentral, servers.length, serverUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeModal !== 'profileSettings') return;
    if (activeTab !== 'content-social') return;
    if (contentSocialLoaded) return;
    if (!isCentral && !connectedToServer) return;

    const prefsApi = getContentSocialApi();
    prefsApi.get('/api/profile/content-social-preferences')
      .then((res) => {
        setAllowNsfw(res.data.allowNsfw || false);
        setNsfwLewds(res.data.nsfwLewds || false);
        setNsfwBlood(res.data.nsfwBlood || false);
        setNsfwGore(res.data.nsfwGore || false);
        setDmFilter(res.data.dmFilter || 'non-friends');
        setAllowDms(res.data.allowDms || false);
        setFrEveryone(res.data.frEveryone ?? true);
        setFrFriendOfFriends(res.data.frFriendOfFriends ?? true);
        setFrServerMembers(res.data.frServerMembers ?? true);
        setCustomAllowedDomains(Array.isArray(res.data.customAllowedDomains) ? res.data.customAllowedDomains : []);
        setContentSocialPrefs(res.data);
      })
      .catch(() => {
        // Use defaults if fetch fails
      })
      .finally(() => setContentSocialLoaded(true));
  }, [activeModal, activeTab, connectedToServer, contentSocialLoaded, isCentral, setContentSocialPrefs, user?.accountType]);

  const handleDevPanelUnlock = () => {
    if (devPanelVisible) return;
    devUnlockCountRef.current += 1;
    if (devUnlockCountRef.current >= 5) {
      setDevPanelVisible(true);
      setActiveTab('developer-debug');
      devUnlockCountRef.current = 0;
    }
  };

  const refreshAudioInputs = async () => {
    if (nativeVoiceBackend) {
      setLoadingAudioInputs(true);
      setAudioError(null);
      try {
        const result = await window.electron?.nativeVoiceListDevices?.();
        if (!result?.ok) throw new Error(result?.message || result?.reason || 'Audio devices unavailable');
        setAudioInputs(result.inputs as unknown as MediaDeviceInfo[]);
        setAudioOutputs(result.outputs as unknown as MediaDeviceInfo[]);
        if (voiceInputDeviceId) await window.electron?.nativeVoiceSetInputDevice?.(voiceInputDeviceId);
        if (voiceOutputDeviceId) await window.electron?.nativeVoiceSetOutputDevice?.(voiceOutputDeviceId);
      } catch (err) {
        setAudioInputs([]);
        setAudioOutputs([]);
        setAudioError(err instanceof Error ? err.message : 'Audio devices unavailable');
      } finally {
        setLoadingAudioInputs(false);
      }
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return;
    setLoadingAudioInputs(true);
    setAudioError(null);
    let permissionStream: MediaStream | null = null;
    try {
      // Gain permission, then enumerate once to fill in device labels. Chromium
      // probes cameras during enumerateDevices even though we only consume audio.
      permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioInputs(devices.filter((d) => d.kind === 'audioinput'));
      setAudioOutputs(devices.filter((d) => d.kind === 'audiooutput'));
    } catch {
      setAudioError('Microphone access denied');
    } finally {
      // This stream exists only to unlock device labels. Leaving it open kept
      // Chromium's media services and the physical microphone active after the
      // Voice tab finished loading.
      permissionStream?.getTracks().forEach((track) => track.stop());
      setLoadingAudioInputs(false);
    }
  };

  const saveContentSocialPreferences = async (overrides: Partial<ContentSocialPrefsPayload> = {}) => {
    if (!isCentral && !connectedToServer) return;
    try {
      const payload = {
        allowNsfw,
        nsfwLewds,
        nsfwBlood,
        nsfwGore,
        dmFilter,
        allowDms,
        frEveryone,
        frFriendOfFriends,
        frServerMembers,
        customAllowedDomains,
        ...overrides,
      };

      let savedPrefs = payload;
      if (isCentral) {
        // CatRealm auth is the source of truth for the user settings UI.
        const centralRes = await createAuthenticatedApi().put('/api/profile/content-social-preferences', payload);
        savedPrefs = { ...payload, ...(centralRes.data || {}) };
        if (Array.isArray(savedPrefs.customAllowedDomains)) {
          setCustomAllowedDomains(savedPrefs.customAllowedDomains);
        }
        setContentSocialPrefs(savedPrefs);
        // Mirror to the active server when connected so NSFW channel visibility updates there too.
        if (connectedToServer) {
          createApi().put('/api/profile/content-social-preferences', payload).catch((err) => {
            console.warn('Failed to mirror content & social preferences to active server:', err);
          });
        }
      } else {
        const serverRes = await createApi().put('/api/profile/content-social-preferences', payload);
        savedPrefs = { ...payload, ...(serverRes.data || {}) };
        if (Array.isArray(savedPrefs.customAllowedDomains)) {
          setCustomAllowedDomains(savedPrefs.customAllowedDomains);
        }
        setContentSocialPrefs(savedPrefs);
      }

      if (connectedToServer) {
        await fetchChannels();
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('catrealm:content-social-updated'));
      }
    } catch (err) {
      console.error('Failed to save content & social preferences:', err);
    }
  };

  const randomizeEmotePreview = useCallback(() => {
    const fallbackPool: EmotePreviewItem[] = DEFAULT_PREVIEW_EMOJIS.map((emoji, index) => ({
      id: `default-${index}`,
      label: emoji,
      emoji,
    }));
    const sourcePool = emotePreviewPool.length > 0 ? emotePreviewPool : fallbackPool;
    const picks = pickRandomItems(sourcePool, 5);
    const merged = picks.length >= 5
      ? picks
      : [...picks, ...pickRandomItems(fallbackPool, 5 - picks.length)];
    setEmotePreviewItems(merged.slice(0, 5));
  }, [emotePreviewPool]);

  const loadEmotePreviewPool = useCallback(async () => {
    if (isHttpGatewayRealm(activeServerUrl)) {
      const fallbackPool: EmotePreviewItem[] = DEFAULT_PREVIEW_EMOJIS.map((emoji, index) => ({
        id: `default-${index}`,
        label: emoji,
        emoji,
      }));
      setEmotePreviewPool(fallbackPool);
      setEmotePreviewItems(pickRandomItems(fallbackPool, 5));
      return;
    }
    setLoadingEmotePreview(true);
    try {
      const api = createApi();
      const res = await api.get('/api/expressions/manifest');
      const payload = res.data || {};
      const combined = [
        ...(Array.isArray(payload.emotes) ? payload.emotes : []),
        ...(Array.isArray(payload['anim-emotes']) ? payload['anim-emotes'] : []),
      ] as Array<{ id?: string; name?: string; file_url?: string; absolute_url?: string }>;

      const normalized = combined
        .map((entry, index) => {
          const rawName = sanitizeExpressionName(entry.name || `emote-${index}`);
          const label = rawName || `emote-${index}`;
          const src = typeof entry.absolute_url === 'string' && entry.absolute_url
            ? entry.absolute_url
            : (typeof entry.file_url === 'string' && entry.file_url
              ? (/^https?:\/\//i.test(entry.file_url)
                ? entry.file_url
                : (serverUrl ? `${serverUrl}${entry.file_url}` : null))
              : null);
          if (!src) return null;
          return {
            id: entry.id || `custom-${index}`,
            label,
            src,
          } as EmotePreviewItem;
        })
        .filter((entry): entry is EmotePreviewItem => !!entry);

      const fallbackPool: EmotePreviewItem[] = DEFAULT_PREVIEW_EMOJIS.map((emoji, index) => ({
        id: `default-${index}`,
        label: emoji,
        emoji,
      }));
      const pool = normalized.length > 0 ? [...normalized, ...fallbackPool] : fallbackPool;
      setEmotePreviewPool(pool);
      setEmotePreviewItems(pickRandomItems(pool, 5));
    } catch {
      const fallbackPool: EmotePreviewItem[] = DEFAULT_PREVIEW_EMOJIS.map((emoji, index) => ({
        id: `default-${index}`,
        label: emoji,
        emoji,
      }));
      setEmotePreviewPool(fallbackPool);
      setEmotePreviewItems(pickRandomItems(fallbackPool, 5));
    } finally {
      setLoadingEmotePreview(false);
    }
  }, [activeServerUrl, serverUrl]);

  const loadPersonalSummary = useCallback(async () => {
    if (!isCentral) {
      setPersonalSummary({
        animatedEmotes: 0,
        animatedStickers: 0,
        emoteLimit: 10,
        stickerLimit: 10,
      });
      setPersonalExpressions(EMPTY_PERSONAL_EXPRESSIONS);
      setPersonalRenameDrafts({});
      setPersonalError('Personal emotes require a central account.');
      return;
    }

    setPersonalLoading(true);
    setPersonalError(null);
    try {
      const api = createAuthenticatedApi();
      const res = await api.get('/api/profile/personal-expressions');
      const payload = res.data || {};

      const animatedEmoteList = Array.isArray(payload['anim-emotes'])
        ? payload['anim-emotes']
        : (Array.isArray(payload.animEmotes) ? payload.animEmotes : []);
      const animatedStickerList = Array.isArray(payload['anim-stickers'])
        ? payload['anim-stickers']
        : (Array.isArray(payload.animStickers) ? payload.animStickers : []);
      const staticEmoteList = Array.isArray(payload.emotes) ? payload.emotes : [];
      const staticStickerList = Array.isArray(payload.stickers) ? payload.stickers : [];
      const normalizedGroups: PersonalExpressionGroups = {
        emotes: staticEmoteList,
        'anim-emotes': animatedEmoteList,
        stickers: staticStickerList,
        'anim-stickers': animatedStickerList,
      };
      setPersonalExpressions(normalizedGroups);
      setPersonalRenameDrafts((prev) => {
        const next: Record<string, string> = {};
        for (const item of [
          ...normalizedGroups.emotes,
          ...normalizedGroups['anim-emotes'],
          ...normalizedGroups.stickers,
          ...normalizedGroups['anim-stickers'],
        ]) {
          const itemId = String(item?.id || '').trim();
          if (!itemId) continue;
          const currentName = sanitizeExpressionName(item?.name || '');
          next[itemId] = prev[itemId] ?? currentName;
        }
        return next;
      });

      const rawEmoteCount = payload.counts?.emotes
        ?? payload.counts?.animatedEmotes
        ?? payload.animatedEmotes
        ?? (animatedEmoteList.length + staticEmoteList.length);
      const rawStickerCount = payload.counts?.stickers
        ?? payload.counts?.animatedStickers
        ?? payload.animatedStickers
        ?? (animatedStickerList.length + staticStickerList.length);
      const animatedEmotes = Number(rawEmoteCount);
      const animatedStickers = Number(rawStickerCount);
      const emoteLimit = Number(payload.limits?.emotes ?? payload.emoteLimit ?? 10);
      const stickerLimit = Number(payload.limits?.stickers ?? payload.stickerLimit ?? 10);

      setPersonalSummary({
        animatedEmotes: Number.isFinite(animatedEmotes) ? Math.max(0, animatedEmotes) : 0,
        animatedStickers: Number.isFinite(animatedStickers) ? Math.max(0, animatedStickers) : 0,
        emoteLimit: Number.isFinite(emoteLimit) ? Math.max(1, emoteLimit) : 10,
        stickerLimit: Number.isFinite(stickerLimit) ? Math.max(1, stickerLimit) : 10,
      });
    } catch (err) {
      const message = axios.isAxiosError(err) ? err.response?.data?.error : null;
      setPersonalError(message || 'Personal emote API is unavailable on this server build.');
      setPersonalSummary({
        animatedEmotes: 0,
        animatedStickers: 0,
        emoteLimit: 10,
        stickerLimit: 10,
      });
      setPersonalExpressions(EMPTY_PERSONAL_EXPRESSIONS);
      setPersonalRenameDrafts({});
    } finally {
      setPersonalLoading(false);
    }
  }, [isCentral]);

  const uploadPersonalExpression = useCallback(async (kind: 'emotes' | 'stickers', file: File | null) => {
    if (!file) return;
    if (!isCentral) {
      setPersonalError('Personal emote uploads require a central account.');
      return;
    }

    const name = sanitizeExpressionName(file.name.replace(/\.[^.]+$/, '')) || `${kind}-${Date.now()}`;
    setUploadingPersonalKind(kind);
    setPersonalError(null);
    try {
      const api = createAuthenticatedApi();
      const form = new FormData();
      form.append('name', name);
      form.append('file', file);
      await api.post(`/api/profile/personal-expressions/${kind}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await loadPersonalSummary();
    } catch (err) {
      const message = axios.isAxiosError(err) ? err.response?.data?.error : null;
      setPersonalError(message || 'Upload failed. Personal emote API may not be enabled yet.');
    } finally {
      setUploadingPersonalKind(null);
    }
  }, [isCentral, loadPersonalSummary]);

  const renamePersonalExpression = useCallback(async (item: PersonalExpressionItem) => {
    if (!isCentral) return;
    const itemId = String(item.id || '').trim();
    if (!itemId) return;
    const nextName = sanitizeExpressionName(personalRenameDrafts[itemId] ?? item.name);
    if (!nextName) {
      setPersonalError('Expression name is required.');
      return;
    }
    if (nextName === sanitizeExpressionName(item.name)) return;

    setSavingPersonalId(itemId);
    setPersonalError(null);
    try {
      const api = createAuthenticatedApi();
      await api.patch(`/api/profile/personal-expressions/${itemId}`, { name: nextName });
      await loadPersonalSummary();
    } catch (err) {
      const message = axios.isAxiosError(err) ? err.response?.data?.error : null;
      setPersonalError(message || 'Failed to rename personal expression.');
    } finally {
      setSavingPersonalId(null);
    }
  }, [isCentral, personalRenameDrafts, loadPersonalSummary]);

  const deletePersonalExpression = useCallback(async (item: PersonalExpressionItem) => {
    if (!isCentral) return;
    const itemId = String(item.id || '').trim();
    if (!itemId) return;
    setDeletingPersonalId(itemId);
    setPersonalError(null);
    try {
      const api = createAuthenticatedApi();
      await api.delete(`/api/profile/personal-expressions/${itemId}`);
      await loadPersonalSummary();
    } catch (err) {
      const message = axios.isAxiosError(err) ? err.response?.data?.error : null;
      setPersonalError(message || 'Failed to delete personal expression.');
    } finally {
      setDeletingPersonalId(null);
    }
  }, [isCentral, loadPersonalSummary]);

  useEffect(() => {
    if (activeModal !== 'profileSettings') return;
    if (activeTab !== 'emotes-settings') return;
    void loadEmotePreviewPool();
    void loadPersonalSummary();
  }, [activeModal, activeTab, loadEmotePreviewPool, loadPersonalSummary]);

  useEffect(() => {
    if (activeModal !== 'profileSettings') return;
    if (activeTab !== 'emotes-settings') return;
    randomizeEmotePreview();
  }, [activeModal, activeTab, emoteSizePx, emotePreviewPool, randomizeEmotePreview]);

  const runServerConsoleCommand = async (command: string) => {
    if (!connectedToServer) {
      setConsoleError('Connect to a server first.');
      return;
    }
    const trimmed = command.trim();
    if (!trimmed) {
      setConsoleError('Command is required.');
      return;
    }
    setConsoleRunning(true);
    setConsoleError(null);
    try {
      const serverApi = createApi();
      const res = await serverApi.post('/api/admin/console-command', { command: trimmed });
      const lines = Array.isArray(res.data?.lines)
        ? res.data.lines.map((line: unknown) => String(line))
        : [];
      setConsoleOutput(lines);
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.error || 'Failed to run command'
        : 'Failed to run command';
      setConsoleError(msg);
      setConsoleOutput([]);
    } finally {
      setConsoleRunning(false);
    }
  };

  const runMicTest = async () => {
    if (recordingTest) return;
    if (nativeVoiceBackend) {
      setRecordingTest(true);
      setAudioError(null);
      const duration = Math.max(1, Math.min(testDurationSec, 30));
      setTestCountdown(duration);
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      setRecordedUrl(null);
      const countdown = window.setInterval(() => {
        setTestCountdown((value) => value === null ? null : Math.max(0, value - 1));
      }, 1000);
      try {
        const result = await window.electron?.nativeVoiceMicrophoneTest?.({
          durationMs: duration * 1000,
          rnnoise: rnnoiseEnabled,
          gate: noiseGateEnabled,
          gateThresholdDb: noiseGateThreshold,
        });
        if (!result?.ok || !result.audioBase64) throw new Error(result?.message || result?.reason || 'Microphone test failed');
        const binary = atob(result.audioBase64);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        setRecordedUrl(URL.createObjectURL(new Blob([bytes], { type: result.mimeType || 'audio/wav' })));
      } catch (err) {
        setAudioError(err instanceof Error ? err.message : 'Microphone test failed');
      } finally {
        window.clearInterval(countdown);
        setRecordingTest(false);
        setTestCountdown(null);
      }
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return;
    setRecordingTest(true);
    setAudioError(null);
    const duration = Math.max(1, Math.min(testDurationSec, 30));
    setTestCountdown(duration);
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
      setRecordedUrl(null);
    }
    try {
      const deviceId = voiceInputDeviceId;
      const audioConstraint = deviceId ? { deviceId: { exact: deviceId } } : true;
      const rawStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint, video: false });
      const pipeline = await buildAudioPipeline(rawStream, {
        noiseGateEnabled,
        noiseGateThreshold,
        rnnoiseEnabled,
      });
      const recordStream = pipeline ? pipeline.processedStream : rawStream;
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(recordStream);
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        pipeline?.destroy();
        rawStream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setRecordedUrl(url);
        setRecordingTest(false);
        setTestCountdown(null);
      };
      recorder.start();
      const interval = setInterval(() => {
        setTestCountdown((prev) => {
          if (prev === null) return prev;
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, duration * 1000);
    } catch {
      setAudioError('Microphone access denied');
      setRecordingTest(false);
      setTestCountdown(null);
    }
  };

  useEffect(() => {
    const el = testAudioRef.current as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> } | null;
    if (!el) return;
    if (!voiceOutputDeviceId || !el.setSinkId) return;
    el.setSinkId(voiceOutputDeviceId).catch(() => {});
  }, [recordedUrl, voiceOutputDeviceId]);

  useEffect(() => {
    const el = testAudioRef.current;
    if (!el) return;
    const onEnded = () => setTestPlaying(false);
    el.addEventListener('ended', onEnded);
    return () => {
      el.removeEventListener('ended', onEnded);
    };
  }, [recordedUrl]);

  const toggleTestPlayback = () => {
    const el = testAudioRef.current;
    if (!el) return;
    if (testPlaying) {
      el.pause();
      setTestPlaying(false);
      return;
    }
    el.currentTime = 0;
    el.play().then(() => setTestPlaying(true)).catch(() => {});
  };

  const audioLabelsLoadedRef = useRef(false);
  useEffect(() => {
    if (activeModal !== 'profileSettings') return;
    if (activeTab !== 'voice') return;
    if (audioLabelsLoadedRef.current) return;
    audioLabelsLoadedRef.current = true;
    // On voice tab activation, request permission and load labels.
    void refreshAudioInputs();
  }, [activeModal, activeTab]);

  useEffect(() => {
    if (activeModal !== 'profileSettings') {
      audioLabelsLoadedRef.current = false;
    }
  }, [activeModal]);

  const REQUIRED_COLORS = [
    'bg-deepest', 'bg-sidebar', 'bg-chat', 'bg-hover', 'bg-input',
    'bg-elevated', 'text-primary', 'text-secondary', 'text-muted',
    'accent', 'accent-hover', 'border',
  ];

  const handleDownloadTemplate = useCallback(async () => {
    const TEMPLATE = {
      themeName: 'DarkCat',
      author: 'CatRealm',
      version: '1.0',
      source: 'https://github.com/CatRealm/themes',
      colors: {
        'bg-deepest':     '#1e1133',
        'bg-sidebar':     '#302154',
        'bg-chat':        '#3a2864',
        'bg-hover':       '#44306e',
        'bg-input':       '#1e1133',
        'bg-elevated':    '#271748',
        'text-primary':   '#f2f3f5',
        'text-secondary': '#c8b5e0',
        'text-muted':     '#7a6890',
        'accent':         '#9b77ff',
        'accent-hover':   '#8866ee',
        'border':         '#4a3578',
      },
    };

    const README = `# CatRealm Custom Theme Template

This package contains everything you need to create custom color themes for CatRealm.

## Quick Start

1. **Edit the template** - Open \`catrealm-theme-template.json\` and customize the colors
2. **Import your theme** - Go to Profile Settings > Appearance > Import Theme
3. **Select your file** - Choose your edited JSON file to apply your custom theme

## Template Structure

The \`catrealm-theme-template.json\` file contains:

\`\`\`json
{
  "themeName": "Your Theme Name",
  "author": "Your Name",
  "version": "1.0",
  "source": "https://your-website.com",
  "colors": { ... }
}
\`\`\`

### Required Fields

- **themeName** - A unique name for your theme (required, non-empty string)
- **colors** - Object containing all 12 color properties (required)

### Optional Fields

- **author** - Your name or username
- **version** - Theme version (e.g., "1.0", "1.1", "2.0")
- **source** - URL to your theme repository or website

## Color Properties Guide

All 12 color properties are required. Each must be a valid hex color (#RRGGBB or #RGB).

### Background Colors

| Property | Usage |
|----------|-------|
| **bg-deepest** | Deepest background layer - Main window background and darkest elements. This is your theme's foundation. |
| **bg-sidebar** | Sidebar background - Left navigation panel. Should contrast with bg-deepest for visual separation. |
| **bg-chat** | Chat area background - Main conversation/content area where messages appear. |
| **bg-hover** | Hover state background - Applied when hovering over buttons, menu items, and interactive elements. |
| **bg-input** | Input field background - Text inputs, search boxes, and form fields. |
| **bg-elevated** | Elevated/modal background - Modals, dropdowns, popovers, and panels that appear above other content. |

### Text Colors

| Property | Usage |
|----------|-------|
| **text-primary** | Primary text - Main readable text throughout the app. Must have high contrast with backgrounds. |
| **text-secondary** | Secondary text - Metadata, timestamps, subtitles, and labels. Less prominent than primary. |
| **text-muted** | Muted text - Disabled text, placeholders, and help text. Lowest contrast of the text colors. |

### Accent Colors

| Property | Usage |
|----------|-------|
| **accent** | Primary accent - Buttons, links, highlights, and active states. Your theme's signature color. |
| **accent-hover** | Accent hover - Hover state for accent-colored elements. Usually a lighter/darker variant. |

### Border Colors

| Property | Usage |
|----------|-------|
| **border** | Borders and dividers - Used for separators and outlines throughout the UI. Should be subtle but visible. |

## Color Format Requirements

Valid formats:
- 6-digit hex: \`#ff0000\` (red)
- 3-digit hex: \`#f00\` (red)
- Lowercase or uppercase: \`#FF0000\` or \`#ff0000\`

Invalid formats:
- RGB: \`rgb(255, 0, 0)\`
- Color names: \`red\`
- Without hash: \`ff0000\`

## Support

If you encounter issues or have questions:
- Check the CatRealm documentation
- Ask in the CatRealm community
- Report bugs at the CatRealm repository
`;

    // Create zip file
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    zip.file('catrealm-theme-template.json', JSON.stringify(TEMPLATE, null, 2));
    zip.file('README.md', README);

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'catrealm-theme-template.zip';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImportTheme = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (!parsed.themeName || typeof parsed.themeName !== 'string' || !parsed.themeName.trim()) {
          setImportError('Invalid theme: "themeName" must be a non-empty string.');
          return;
        }
        if (!parsed.colors || typeof parsed.colors !== 'object') {
          setImportError('Invalid theme: missing "colors" object.');
          return;
        }
        const hexRe = /^#[0-9a-fA-F]{3,8}$/;
        for (const key of REQUIRED_COLORS) {
          if (!(key in parsed.colors)) {
            setImportError(`Invalid theme: missing required color key "${key}".`);
            return;
          }
          if (!hexRe.test(parsed.colors[key])) {
            setImportError(`Invalid theme: color "${key}" must be a hex value (e.g. #ff0000).`);
            return;
          }
        }
        const id = addTheme({
          themeName: parsed.themeName.trim(),
          author: typeof parsed.author === 'string' ? parsed.author : '',
          version: typeof parsed.version === 'string' ? parsed.version : '1.0',
          source: typeof parsed.source === 'string' ? parsed.source : '',
          colors: parsed.colors,
        });
        setTheme(id);
        setImportError(null);
        if (themeFileInputRef.current) themeFileInputRef.current.value = '';
      } catch {
        setImportError('Failed to parse JSON. Please check the file format.');
      }
    };
    reader.readAsText(file);
  }, [addTheme, setTheme]);

  const handleSaveBio = () => {
    const api = getProfileApi();
    setSavingBio(true);
    setProfileError(null);
    api.put('/api/profile/me', { bio: bioDraft })
      .then((res) => {
        setProfile(res.data);
        setBioDraft(res.data.bio ?? '');
      })
      .catch((err) => {
        const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to save bio';
        setProfileError(msg || 'Failed to save bio');
      })
      .finally(() => setSavingBio(false));
  };

  const handleSaveDisplayName = () => {
    const api = getProfileApi();
    setProfileError(null);
    if (!displayNameDraft.trim()) {
      api.delete('/api/profile/me/display-name')
        .then((res) => {
          setProfile(res.data);
          const nextDisplayName = readDisplayName(res.data);
          setDisplayNameDraft(nextDisplayName ?? '');
          updateUser({ displayName: nextDisplayName });
          updateOnlineUser(res.data.id, { displayName: nextDisplayName });
        })
        .catch((err) => {
          const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to clear display name';
          setProfileError(msg || 'Failed to clear display name');
        });
    } else {
      api.put('/api/profile/me/display-name', { displayName: displayNameDraft.trim() })
        .then((res) => {
          setProfile(res.data);
          const nextDisplayName = readDisplayName(res.data);
          setDisplayNameDraft(nextDisplayName ?? '');
          updateUser({ displayName: nextDisplayName });
          updateOnlineUser(res.data.id, { displayName: nextDisplayName });
        })
        .catch((err) => {
          const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to save display name';
          setProfileError(msg || 'Failed to save display name');
        });
    }
  };

  const handleSaveActivity = () => {
    const api = getProfileApi();
    setProfileError(null);
    if (isGameActivityActive && activityTypeDraft !== 'Custom') {
      const manualActivityUserId = user?.id ?? profile?.id ?? null;
      if (!manualActivityUserId) return;
      if (!activityTypeDraft || !activityTextDraft.trim()) {
        clearManualActivity(manualActivityUserId);
        setActivityTypeDraft('');
        setActivityTextDraft('');
        return;
      }

      const nextManualActivity = {
        activityType: activityTypeDraft,
        activityText: activityTextDraft.trim(),
        activityStartedAt: Math.floor(Date.now() / 1000),
        source: 'explicit' as const,
      };
      writeManualActivity(manualActivityUserId, nextManualActivity);
      setActivityTypeDraft(nextManualActivity.activityType);
      setActivityTextDraft(nextManualActivity.activityText);
      return;
    }
    if (!activityTypeDraft || !activityTextDraft.trim()) {
      Promise.allSettled([
        api.delete('/api/profile/me/activity'),
        api.delete('/api/profile/me/custom-status'),
      ])
        .then(async ([activityResult, customStatusResult]) => {
          const activityRes = activityResult.status === 'fulfilled' ? activityResult.value : null;
          const customStatusRes = customStatusResult.status === 'fulfilled' ? customStatusResult.value : null;
          const res = customStatusRes ?? activityRes;
          if (!res) throw new Error('Failed to clear activity');

          setProfile(res.data);
          setActivityTypeDraft('');
          setActivityTextDraft('');
          updateUser({ customStatusText: null, activityType: null, activityText: null, activityStartedAt: null });
          updateOnlineUser(res.data.id, { customStatusText: null, activityType: null, activityText: null, activityStartedAt: null });
          clearManualActivity(res.data.id ?? user?.id);

          if (isCentral) {
            clearCentralPresenceActivityCache(res.data.id ?? user?.id);
          }

          if (isCentral && connectedToServer) {
            const serverApi = createApi();
            const [serverActivityResult, serverCustomStatusResult] = await Promise.allSettled([
              serverApi.delete('/api/profile/me/activity'),
              serverApi.delete('/api/profile/me/custom-status'),
            ]);
            const serverActivityRes = serverActivityResult.status === 'fulfilled' ? serverActivityResult.value : null;
            const serverCustomStatusRes = serverCustomStatusResult.status === 'fulfilled' ? serverCustomStatusResult.value : null;
            const serverRes = serverCustomStatusRes ?? serverActivityRes;
            if (serverRes) {
              updateOnlineUser(serverRes.data.id, { customStatusText: null, activityType: null, activityText: null, activityStartedAt: null });
            }
          }
        })
        .catch(() => {});
    } else if (activityTypeDraft === 'Custom') {
      api.put('/api/profile/me/custom-status', { customStatusText: activityTextDraft.trim() })
        .then((res) => {
          const nextCustomStatusText = readCustomStatusText(res.data);
          const nextActivityType = readActivityType(res.data);
          const nextActivityText = readActivityText(res.data);
          const nextActivityStartedAt = readActivityStartedAt(res.data);
          setProfile(res.data);
          setActivityTypeDraft(nextCustomStatusText ? 'Custom' : '');
          setActivityTextDraft(nextCustomStatusText ?? '');
          updateUser({
            customStatusText: nextCustomStatusText,
            activityType: nextActivityType,
            activityText: nextActivityText,
            activityStartedAt: nextActivityStartedAt,
          });
          updateOnlineUser(res.data.id, {
            customStatusText: nextCustomStatusText,
            activityType: nextActivityType,
            activityText: nextActivityText,
            activityStartedAt: nextActivityStartedAt,
          });
          if (isCentral) {
            writeCentralPresenceCache(res.data.id ?? user?.id, {
              customStatusText: nextCustomStatusText,
              activityType: nextActivityType,
              activityText: nextActivityText,
              activityStartedAt: nextActivityStartedAt,
            });
          }

          if (isCentral && connectedToServer) {
            const serverApi = createApi();
            serverApi.put('/api/profile/me/custom-status', { customStatusText: nextCustomStatusText })
              .then((serverRes) => {
                updateOnlineUser(serverRes.data.id, {
                  customStatusText: readCustomStatusText(serverRes.data),
                  activityType: readActivityType(serverRes.data),
                  activityText: readActivityText(serverRes.data),
                  activityStartedAt: readActivityStartedAt(serverRes.data),
                });
              })
              .catch(() => {});
          }
        })
        .catch((err) => {
          const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to save custom status';
          setProfileError(msg || 'Failed to save custom status');
        });
    } else {
      const requestedActivityStartedAt = Math.floor(Date.now() / 1000);
      api.put('/api/profile/me/activity', {
        activityType: activityTypeDraft,
        activityText: activityTextDraft.trim(),
        activityStartedAt: requestedActivityStartedAt,
      })
        .then((res) => {
          setProfile(res.data);
          const nextCustomStatusText = readCustomStatusText(res.data);
          const nextActivityType = readActivityType(res.data);
          const nextActivityText = readActivityText(res.data);
          const nextActivityStartedAt = readActivityStartedAt(res.data) ?? requestedActivityStartedAt;
          setActivityTypeDraft(nextActivityType ?? '');
          setActivityTextDraft(nextActivityText ?? '');
          updateUser({
            customStatusText: nextCustomStatusText,
            activityType: nextActivityType,
            activityText: nextActivityText,
            activityStartedAt: nextActivityStartedAt,
          });
          updateOnlineUser(res.data.id, {
            customStatusText: nextCustomStatusText,
            activityType: nextActivityType,
            activityText: nextActivityText,
            activityStartedAt: nextActivityStartedAt,
          });
          writeManualActivity(res.data.id ?? user?.id, {
            activityType: nextActivityType,
            activityText: nextActivityText,
            activityStartedAt: nextActivityStartedAt,
            source: 'explicit',
          });
          if (isCentral) {
            writeCentralPresenceCache(res.data.id ?? user?.id, {
              customStatusText: nextCustomStatusText,
              activityType: nextActivityType,
              activityText: nextActivityText,
              activityStartedAt: nextActivityStartedAt,
            });
          }
          if (isCentral && connectedToServer) {
            const serverApi = createApi();
            serverApi.put('/api/profile/me/activity', {
              activityType: nextActivityType,
              activityText: nextActivityText,
              activityStartedAt: nextActivityStartedAt,
            })
              .then((serverRes) => {
                const serverActivityType = readActivityType(serverRes.data);
                const serverActivityText = readActivityText(serverRes.data);
                const serverActivityStartedAt = readActivityStartedAt(serverRes.data) ?? nextActivityStartedAt;
                updateOnlineUser(serverRes.data.id, {
                  customStatusText: readCustomStatusText(serverRes.data),
                  activityType: serverActivityType,
                  activityText: serverActivityText,
                  activityStartedAt: serverActivityStartedAt,
                });
              })
              .catch(() => {});
          }
        })
        .catch((err) => {
          const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to save activity';
          setProfileError(msg || 'Failed to save activity');
        });
    }
  };

  const handleAvatarChange = (file: File | null) => {
    if (!file) return;
    const api = getProfileApi();
    const form = new FormData();
    form.append('avatar', file);
    setUploadingAvatar(true);
    setProfileError(null);
    api.post('/api/profile/me/avatar', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
      .then((res) => {
        setProfile(res.data);
        updateUser({ avatar: res.data.avatar ?? null });
        updateOnlineUser(res.data.id, { avatar: res.data.avatar ?? null });
        if (isCentral) void syncCentralProfileToJoinedServers();
      })
      .catch((err) => {
        const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to upload avatar';
        setProfileError(msg || 'Failed to upload avatar');
      })
      .finally(() => setUploadingAvatar(false));
  };

  const handleRemoveAvatar = () => {
    const api = getProfileApi();
    setUploadingAvatar(true);
    setProfileError(null);
    api.delete('/api/profile/me/avatar')
      .then((res) => {
        setProfile(res.data);
        updateUser({ avatar: res.data.avatar ?? null });
        updateOnlineUser(res.data.id, { avatar: res.data.avatar ?? null });
        if (isCentral) void syncCentralProfileToJoinedServers();
      })
      .catch((err) => {
        const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to remove avatar';
        setProfileError(msg || 'Failed to remove avatar');
      })
      .finally(() => setUploadingAvatar(false));
  };

  const handleBannerChange = (file: File | null) => {
    if (!file) return;
    const api = getProfileApi();
    const form = new FormData();
    form.append('banner', file);
    setUploadingBanner(true);
    setProfileError(null);
    api.post('/api/profile/me/banner', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
      .then((res) => {
        setProfile(res.data);
        updateUser({ banner: res.data.banner ?? null });
      })
      .catch((err) => {
        const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to upload banner';
        setProfileError(msg || 'Failed to upload banner');
      })
      .finally(() => setUploadingBanner(false));
  };

  const handleRemoveBanner = () => {
    const api = getProfileApi();
    setUploadingBanner(true);
    setProfileError(null);
    api.delete('/api/profile/me/banner')
      .then((res) => {
        setProfile(res.data);
        updateUser({ banner: res.data.banner ?? null });
      })
      .catch((err) => {
        const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to remove banner';
        setProfileError(msg || 'Failed to remove banner');
      })
      .finally(() => setUploadingBanner(false));
  };

  // Server avatar handlers (central accounts only)
  const handleServerAvatarChange = (file: File | null, targetServerUrl?: string) => {
    const effectiveServerUrl = targetServerUrl ?? selectedServerUrl;
    if (!file || !effectiveServerUrl) return;
    const selectedServer = servers.find((s) => s.url === effectiveServerUrl);
    if (!selectedServer) return;

    const form = new FormData();
    form.append('avatar', file);
    setUploadingServerAvatar(true);
    setProfileError(null);
    axios.post(`${selectedServer.url}/api/profile/me/avatar`, form, {
      headers: {
        'Content-Type': 'multipart/form-data',
        Authorization: `Bearer ${selectedServer.token}`,
      },
    })
      .then((res) => {
        setServerAvatars((prev) => ({
          ...prev,
          [effectiveServerUrl]: res.data.avatar ?? null,
        }));
        // Update online user if this is the currently connected server
        if (serverUrl === effectiveServerUrl) {
          updateOnlineUser(res.data.id, { avatar: res.data.avatar ?? null });
        }
      })
      .catch((err) => {
        const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to upload server avatar';
        setProfileError(msg || 'Failed to upload server avatar');
      })
      .finally(() => setUploadingServerAvatar(false));
  };

  const handleRemoveServerAvatar = () => {
    if (!selectedServerUrl) return;
    const selectedServer = servers.find((s) => s.url === selectedServerUrl);
    if (!selectedServer) return;

    setUploadingServerAvatar(true);
    setProfileError(null);
    axios.delete(`${selectedServer.url}/api/profile/me/avatar`, {
      headers: { Authorization: `Bearer ${selectedServer.token}` },
    })
      .then((res) => {
        setServerAvatars((prev) => ({
          ...prev,
          [selectedServerUrl]: res.data.avatar ?? null,
        }));
        // Update online user if this is the currently connected server
        if (serverUrl === selectedServerUrl) {
          updateOnlineUser(res.data.id, { avatar: res.data.avatar ?? null });
        }
        if (isCentral) void syncCentralProfileToServer(selectedServer.url, selectedServer.token);
      })
      .catch((err) => {
        const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to remove server avatar';
        setProfileError(msg || 'Failed to remove server avatar');
      })
      .finally(() => setUploadingServerAvatar(false));
  };

  const handleServerBannerChange = (file: File | null, targetServerUrl?: string) => {
    const effectiveServerUrl = targetServerUrl ?? selectedServerUrl;
    if (!file || !effectiveServerUrl) return;
    const selectedServer = servers.find((s) => s.url === effectiveServerUrl);
    if (!selectedServer) return;

    const form = new FormData();
    form.append('banner', file);
    setUploadingServerBanner(true);
    setProfileError(null);
    axios.post(`${selectedServer.url}/api/profile/me/banner`, form, {
      headers: {
        'Content-Type': 'multipart/form-data',
        Authorization: `Bearer ${selectedServer.token}`,
      },
    })
      .then((res) => {
        setServerBanners((prev) => ({
          ...prev,
          [effectiveServerUrl]: res.data.banner ?? null,
        }));
      })
      .catch((err) => {
        const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to upload server banner';
        setProfileError(msg || 'Failed to upload server banner');
      })
      .finally(() => setUploadingServerBanner(false));
  };

  const handleRemoveServerBanner = () => {
    if (!selectedServerUrl) return;
    const selectedServer = servers.find((s) => s.url === selectedServerUrl);
    if (!selectedServer) return;

    setUploadingServerBanner(true);
    setProfileError(null);
    axios.delete(`${selectedServer.url}/api/profile/me/banner`, {
      headers: { Authorization: `Bearer ${selectedServer.token}` },
    })
      .then((res) => {
        setServerBanners((prev) => ({
          ...prev,
          [selectedServerUrl]: res.data.banner ?? null,
        }));
      })
      .catch((err) => {
        const msg = axios.isAxiosError(err) ? err.response?.data?.error : 'Failed to remove server banner';
        setProfileError(msg || 'Failed to remove server banner');
      })
      .finally(() => setUploadingServerBanner(false));
  };

  const handleCroppedUpload = (file: File) => {
    if (!cropTarget) return;
    const target = cropTarget;
    setCropTarget(null);

    if (target.kind === 'profile-avatar') {
      handleAvatarChange(file);
      return;
    }
    if (target.kind === 'profile-banner') {
      handleBannerChange(file);
      return;
    }
    if (target.kind === 'server-avatar') {
      handleServerAvatarChange(file, target.serverUrl);
      return;
    }
    handleServerBannerChange(file, target.serverUrl);
  };

  const cropAspectRatio = cropTarget?.kind?.includes('banner') ? 8 / 3 : 1;
  const cropOutputWidth = cropTarget?.kind?.includes('banner') ? 1600 : 512;
  const cropOutputHeight = cropTarget?.kind?.includes('banner') ? 600 : 512;
  const cropShape = cropTarget?.kind?.includes('banner') ? 'rect' : 'circle';
  const cropBusy =
    cropTarget?.kind === 'profile-avatar' ? uploadingAvatar
    : cropTarget?.kind === 'profile-banner' ? uploadingBanner
    : cropTarget?.kind === 'server-avatar' ? uploadingServerAvatar
    : cropTarget?.kind === 'server-banner' ? uploadingServerBanner
    : false;
  const emoteSizeIndex = Math.max(0, EMOTE_SIZE_OPTIONS.indexOf(emoteSizePx));
  const personalTokenSuffix = user?.id || profile?.centralId || 'user-id';
  const personalEmoteItems = [
    ...personalExpressions['anim-emotes'],
    ...personalExpressions.emotes,
  ];
  const personalStickerItems = [
    ...personalExpressions['anim-stickers'],
    ...personalExpressions.stickers,
  ];
  const resolvePersonalTokenAlias = (item: PersonalExpressionItem) =>
    item.token_alias || `:${sanitizeExpressionName(item.name)}:${item.owner_id || personalTokenSuffix}:`;

  if (activeModal !== 'profileSettings') return null;

  const TAB_LABELS: Record<SettingsTab, string> = {
    profile: t('settings.navProfile'),
    'server-profiles': t('settings.navServerProfiles'),
    voice: t('settings.navVoice'),
    notifications: t('settings.navNotifications'),
    appearance: t('settings.navAppearance'),
    'emotes-settings': t('settings.navEmotesSettings'),
    windows: /\bWindows\b/.test(navigator.userAgent) ? t('settings.navWindows') : t('settings.navDesktop'),
    updates: t('settings.navUpdates'),
    'time-format': t('settings.navTimeFormat'),
    language: t('settings.navLanguage'),
    'streamer-mode': t('settings.navStreamerMode'),
    'content-social': t('settings.navContentSocial'),
    'cat-lab': t('settings.navCatLab'),
    'developer-debug': t('settings.navDeveloperDebug'),
    'central-staff': t('settings.navCentralStaff'),
    'account-security': t('settings.navAccountSecurity'),
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex md:items-center md:justify-center bg-black/60"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeModal();
        }
      }}
      variants={motionProfile.backdropVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div
        className="bg-bg-chat md:rounded-lg shadow-xl w-full h-full md:w-[95vw] md:h-[90vh] md:max-w-6xl flex flex-col md:flex-row overflow-hidden"
        variants={motionProfile.panelVariants}
        initial="initial"
        animate="animate"
        exit="exit"
      >
        {/* Sidebar */}
        <div className={`w-full md:w-56 bg-bg-sidebar md:border-r border-border flex-col ${mobilePane === 'nav' ? 'flex' : 'hidden'} md:flex`}>
          <div className="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
            <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wide">{t('settings.userSettings')}</h2>
            {/* Close button on mobile nav */}
            <button
              onClick={closeModal}
              className="md:hidden p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
              aria-label={t('common.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {([
              { id: 'profile' },
            ] as { id: SettingsTab }[])
              .concat(isCentral && servers.length > 0 ? [{ id: 'server-profiles' as SettingsTab }] : [])
              .concat(isCentral ? [{ id: 'account-security' as SettingsTab }] : [])
              .concat([
                { id: 'voice' as SettingsTab },
                { id: 'notifications' as SettingsTab },
                { id: 'appearance' as SettingsTab },
                { id: 'emotes-settings' as SettingsTab },
                { id: 'windows' as SettingsTab },
                { id: 'updates' as SettingsTab },
                { id: 'time-format' as SettingsTab },
                { id: 'language' as SettingsTab },
                { id: 'streamer-mode' as SettingsTab },
                { id: 'content-social' as SettingsTab },
                { id: 'cat-lab' as SettingsTab },
              ])
              .concat(devPanelVisible && user?.id === CATREALM_ADMIN_ID ? [{ id: 'central-staff' as SettingsTab }] : [])
              .concat(devPanelVisible ? [{ id: 'developer-debug' as SettingsTab }] : [])
              .map((item) => (
                <button
                  key={item.id}
                  data-tour={`settings-tab-${item.id}`}
                  onClick={() => selectTab(item.id)}
                  className={`w-full flex items-center gap-1 text-left px-3 py-3 md:py-2 rounded text-sm transition-colors ${
                    activeTab === item.id
                      ? 'bg-bg-hover text-text-primary font-medium'
                      : 'text-text-muted hover:text-text-primary hover:bg-bg-hover/50'
                  }`}
                >
                  <span className="flex-1">{TAB_LABELS[item.id]}</span>
                  <ChevronRight className="w-4 h-4 opacity-40 md:hidden shrink-0" />
                </button>
              ))}
          </div>
          <div className="p-4 border-t border-border space-y-1">
            <button
              type="button"
              onClick={handleDevPanelUnlock}
              className="text-xs text-text-muted"
            >
              CatRealm v{clientVersionBase} · {clientBuildLabel}
              {clientEditionLabel ? ` ${clientEditionLabel}` : ''}
            </button>
            {connectedToServer && serverVersion && (
              <p className="text-xs text-text-muted">
                ServerBuild v{serverVersion}
                {gitHash && gitHash !== 'unknown' && (
                  <span className="ml-1 opacity-70">({gitHash})</span>
                )}
              </p>
            )}
          </div>
          <div className="px-2 pt-2 hidden md:block space-y-1">
            <button
              type="button"
              onClick={() => openModal('confirmLogout')}
              className="logout-shiny-button w-full px-3 py-2 rounded text-sm font-semibold bg-danger text-white hover:bg-danger/85 transition-colors"
            >
              Log Out
            </button>
          </div>
          {/* Close button desktop only */}
          <div className="p-2 hidden md:block">
            <button
              onClick={closeModal}
              className="w-full px-3 py-2 rounded text-sm text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              {t('common.close')}
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className={`flex-col flex-1 overflow-hidden ${mobilePane === 'content' ? 'flex' : 'hidden'} md:flex`}>
          {/* Content header */}
          <div className="h-14 flex items-center gap-2 px-4 border-b border-border shrink-0">
            {/* Back button on mobile */}
            <button
              onClick={() => setMobilePane('nav')}
              className="md:hidden p-1.5 -ml-1 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors shrink-0"
              aria-label={t('common.back')}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h3 className="text-base font-bold text-text-primary flex-1 truncate">{TAB_LABELS[activeTab]}</h3>
            {/* Close button on desktop (content header) */}
            <button
              onClick={closeModal}
              className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors shrink-0"
              aria-label={t('common.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeTab}
              className="flex-1 overflow-y-auto p-4 md:p-8"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={motionProfile.tabSwap}
            >
            {activeTab === 'profile' && (
              <ProfileTab
                profile={profile}
                profileLoading={profileLoading}
                profileError={profileError}
                user={user}
                isCentral={isCentral}
                serverUrl={serverUrl}
                uploadingAvatar={uploadingAvatar}
                uploadingBanner={uploadingBanner}
                bioDraft={bioDraft}
                setBioDraft={setBioDraft}
                savingBio={savingBio}
                displayNameDraft={displayNameDraft}
                setDisplayNameDraft={setDisplayNameDraft}
                activityTypeDraft={activityTypeDraft}
                setActivityTypeDraft={setActivityTypeDraft}
                activityTextDraft={activityTextDraft}
                setActivityTextDraft={setActivityTextDraft}
                gameActivityState={gameActivityState}
                setCropTarget={setCropTarget}
                handleRemoveAvatar={handleRemoveAvatar}
                handleRemoveBanner={handleRemoveBanner}
                handleSaveBio={handleSaveBio}
                handleSaveDisplayName={handleSaveDisplayName}
                handleSaveActivity={handleSaveActivity}
                setStatus={setStatus}
              />
            )}
            {activeTab === 'server-profiles' && (
              <ServerProfilesTab
                profile={profile}
                user={user}
                servers={servers}
                selectedServerUrl={selectedServerUrl}
                setSelectedServerUrl={setSelectedServerUrl}
                serverAvatars={serverAvatars}
                serverBanners={serverBanners}
                uploadingServerAvatar={uploadingServerAvatar}
                uploadingServerBanner={uploadingServerBanner}
                setCropTarget={setCropTarget}
                handleRemoveServerAvatar={handleRemoveServerAvatar}
                handleRemoveServerBanner={handleRemoveServerBanner}
              />
            )}
            {activeTab === 'voice' && (
              <VoiceTab
                nativeVoiceBackend={nativeVoiceBackend}
                audioInputs={audioInputs}
                audioOutputs={audioOutputs}
                loadingAudioInputs={loadingAudioInputs}
                audioError={audioError}
                voiceInputDeviceId={voiceInputDeviceId}
                voiceOutputDeviceId={voiceOutputDeviceId}
                setVoiceOutputDeviceId={setVoiceOutputDeviceId}
                recordingTest={recordingTest}
                testCountdown={testCountdown}
                testDurationSec={testDurationSec}
                setTestDurationSec={setTestDurationSec}
                recordedUrl={recordedUrl}
                testPlaying={testPlaying}
                testAudioRef={testAudioRef}
                rnnoiseEnabled={rnnoiseEnabled}
                setRnnoiseEnabled={setRnnoiseEnabled}
                noiseGateEnabled={noiseGateEnabled}
                setNoiseGateEnabled={setNoiseGateEnabled}
                noiseGateThreshold={noiseGateThreshold}
                setNoiseGateThreshold={setNoiseGateThreshold}
                refreshAudioInputs={refreshAudioInputs}
                runMicTest={runMicTest}
                toggleTestPlayback={toggleTestPlayback}
              />
            )}
            {activeTab === 'notifications' && (
              <NotificationsTab
                notificationsEnabled={notificationsEnabled}
                setNotificationsEnabled={setNotificationsEnabled}
                settings={settings}
                setSoundSetting={setSoundSetting}
                setSoundVolume={setSoundVolume}
                isCentral={isCentral}
              />
            )}
            {activeTab === 'appearance' && (
              <AppearanceTab
                theme={theme}
                setTheme={setTheme}
                motionIntensity={motionIntensity}
                setMotionIntensity={setMotionIntensity}
                heavyAnimationsEnabled={heavyAnimationsEnabled}
                setHeavyAnimationsEnabled={setHeavyAnimationsEnabled}
                customThemes={customThemes}
                removeTheme={removeTheme}
                playGifAvatars={playGifAvatars}
                setPlayGifAvatars={setPlayGifAvatars}
                showAvatarBackground={showAvatarBackground}
                setShowAvatarBackground={setShowAvatarBackground}
                enableImageThumbnailing={enableImageThumbnailing}
                setEnableImageThumbnailing={setEnableImageThumbnailing}
                disableEmbedAutoplay={disableEmbedAutoplay}
                setDisableEmbedAutoplay={setDisableEmbedAutoplay}
                importError={importError}
                themeFileInputRef={themeFileInputRef}
                handleDownloadTemplate={handleDownloadTemplate}
                handleImportTheme={handleImportTheme}
              />
            )}
            {activeTab === 'emotes-settings' && (
              <EmotesTab
                emoteSizePx={emoteSizePx}
                setEmoteSizePx={setEmoteSizePx}
                emoteSizeIndex={emoteSizeIndex}
                emotePreviewItems={emotePreviewItems}
                loadingEmotePreview={loadingEmotePreview}
                randomizeEmotePreview={randomizeEmotePreview}
                personalSummary={personalSummary}
                personalExpressions={personalExpressions}
                personalEmoteItems={personalEmoteItems}
                personalStickerItems={personalStickerItems}
                personalLoading={personalLoading}
                personalError={personalError}
                uploadingPersonalKind={uploadingPersonalKind}
                personalRenameDrafts={personalRenameDrafts}
                setPersonalRenameDrafts={setPersonalRenameDrafts}
                savingPersonalId={savingPersonalId}
                deletingPersonalId={deletingPersonalId}
                personalEmoteInputRef={personalEmoteInputRef}
                personalStickerInputRef={personalStickerInputRef}
                isCentral={isCentral}
                personalTokenSuffix={personalTokenSuffix}
                uploadPersonalExpression={uploadPersonalExpression}
                renamePersonalExpression={renamePersonalExpression}
                deletePersonalExpression={deletePersonalExpression}
                resolvePersonalTokenAlias={resolvePersonalTokenAlias}
              />
            )}
            {activeTab === 'windows' && (
              <WindowsTab
                openOnStartup={openOnStartup}
                setOpenOnStartup={setOpenOnStartup}
                minimizeToTray={minimizeToTray}
                setMinimizeToTray={setMinimizeToTray}
                openLinksInApp={openLinksInApp}
                setOpenLinksInApp={setOpenLinksInApp}
              />
            )}
            {activeTab === 'updates' && (
              <UpdatesTab
                clientVersion={clientVersion}
                devBuilds={devBuilds}
                setDevBuilds={setDevBuilds}
                updateChannel={updateChannel}
                setUpdateChannel={setUpdateChannel}
                voiceDebugConsoleEnabled={voiceDebugConsoleEnabled}
                setVoiceDebugConsoleEnabled={setVoiceDebugConsoleEnabled}
                isDesktopClient={isDesktopClient}
              />
            )}
            {activeTab === 'time-format' && (
              <TimeFormatTab
                timeFormat={timeFormat}
                setTimeFormat={setTimeFormat}
              />
            )}
            {activeTab === 'language' && (
              <LanguageTab
                language={language}
                setLanguage={setLanguage}
              />
            )}
            {activeTab === 'streamer-mode' && (
              <StreamerModeTab
                streamerMode={streamerMode}
                setStreamerMode={setStreamerMode}
                streamerModeAutoDetect={streamerModeAutoDetect}
                setStreamerModeAutoDetect={setStreamerModeAutoDetect}
                streamerModeHidePI={streamerModeHidePI}
                setStreamerModeHidePI={setStreamerModeHidePI}
                streamerModeDisableSounds={streamerModeDisableSounds}
                setStreamerModeDisableSounds={setStreamerModeDisableSounds}
              />
            )}
            {activeTab === 'content-social' && (
              <ContentSocialTab
                allowNsfw={allowNsfw}
                setAllowNsfw={setAllowNsfw}
                nsfwLewds={nsfwLewds}
                setNsfwLewds={setNsfwLewds}
                nsfwBlood={nsfwBlood}
                setNsfwBlood={setNsfwBlood}
                nsfwGore={nsfwGore}
                setNsfwGore={setNsfwGore}
                dmFilter={dmFilter}
                setDmFilter={setDmFilter}
                allowDms={allowDms}
                setAllowDms={setAllowDms}
                frEveryone={frEveryone}
                setFrEveryone={setFrEveryone}
                frFriendOfFriends={frFriendOfFriends}
                setFrFriendOfFriends={setFrFriendOfFriends}
                frServerMembers={frServerMembers}
                setFrServerMembers={setFrServerMembers}
                customAllowedDomains={customAllowedDomains}
                setCustomAllowedDomains={setCustomAllowedDomains}
                saveContentSocialPreferences={saveContentSocialPreferences}
              />
            )}
            {activeTab === 'cat-lab' && (
              <CatLabTab
                gameActivityEnabled={gameActivityEnabled}
                setGameActivityEnabled={setGameActivityEnabled}
                gameActivityState={gameActivityState}
                obsOverlayEnabled={obsOverlayEnabled}
                setObsOverlayEnabled={setObsOverlayEnabled}
                obsOverlayPort={obsOverlayPort}
                setObsOverlayPort={setObsOverlayPort}
                obsOverlayShowNames={obsOverlayShowNames}
                setObsOverlayShowNames={setObsOverlayShowNames}
                obsOverlayAvatarSize={obsOverlayAvatarSize}
                setObsOverlayAvatarSize={setObsOverlayAvatarSize}
                obsOverlayGrayscaleWhenSilent={obsOverlayGrayscaleWhenSilent}
                setObsOverlayGrayscaleWhenSilent={setObsOverlayGrayscaleWhenSilent}
                obsOverlayHideWhenSilent={obsOverlayHideWhenSilent}
                setObsOverlayHideWhenSilent={setObsOverlayHideWhenSilent}
                obsOverlaySquareIcons={obsOverlaySquareIcons}
                setObsOverlaySquareIcons={setObsOverlaySquareIcons}
                screenShareNativeWhipSimulcastEnabled={screenShareNativeWhipSimulcastEnabled}
                setScreenShareNativeWhipSimulcastEnabled={setScreenShareNativeWhipSimulcastEnabled}
              />
            )}
            {activeTab === 'account-security' && isCentral && (
              <AccountSecuritySection />
            )}
            {activeTab === 'central-staff' && user?.id === CATREALM_ADMIN_ID && (
              <CentralStaffTab />
            )}
            {activeTab === 'developer-debug' && (
              <DeveloperTab
                debugServerStates={debugServerStates}
                setDebugServerStates={setDebugServerStates}
                debugCallingStates={debugCallingStates}
                setDebugCallingStates={setDebugCallingStates}
                debugTheaterStates={debugTheaterStates}
                setDebugTheaterStates={setDebugTheaterStates}
                debugUIHoverInspector={debugUIHoverInspector}
                setDebugUIHoverInspector={setDebugUIHoverInspector}
                debugFpsOverlay={debugFpsOverlay}
                setDebugFpsOverlay={setDebugFpsOverlay}
                debugGameActivity={debugGameActivity}
                setDebugGameActivity={setDebugGameActivity}
                voiceDebugConsoleEnabled={voiceDebugConsoleEnabled}
                setVoiceDebugConsoleEnabled={setVoiceDebugConsoleEnabled}
                isDesktopClient={isDesktopClient}
                debugViewAsRole={debugViewAsRole}
                setDebugViewAsRole={(value) => {
                  setDebugViewAsRoleState(value);
                  setViewAsRoleDebugEnabled(value);
                }}
                forceMobileViewOnDesktop={forceMobileViewOnDesktop}
                setForceMobileViewOnDesktop={setForceMobileViewOnDesktop}
                consoleCommand={consoleCommand}
                setConsoleCommand={setConsoleCommand}
                consoleRunning={consoleRunning}
                consoleOutput={consoleOutput}
                consoleError={consoleError}
                connectedToServer={connectedToServer}
                runServerConsoleCommand={runServerConsoleCommand}
              />
            )}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
      <ImageCropModal
        isOpen={!!cropTarget}
        file={cropTarget?.file ?? null}
        title={
          cropTarget?.kind === 'profile-avatar' ? 'Crop Avatar'
          : cropTarget?.kind === 'profile-banner' ? 'Crop Banner'
          : cropTarget?.kind === 'server-avatar' ? 'Crop Server Avatar'
          : 'Crop Server Banner'
        }
        aspectRatio={cropAspectRatio}
        outputWidth={cropOutputWidth}
        outputHeight={cropOutputHeight}
        shape={cropShape}
        busy={cropBusy}
        onCancel={() => setCropTarget(null)}
        onConfirm={handleCroppedUpload}
      />
    </motion.div>
  );
}
