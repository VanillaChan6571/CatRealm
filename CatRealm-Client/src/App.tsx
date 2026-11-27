import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { useAuthStore } from './stores/authStore';
import { useServerStore } from './stores/serverStore';
import { useSettingsStore } from './stores/settingsStore';
import { useCustomThemeStore } from './stores/customThemeStore';
import { useVersionStore } from './stores/versionStore';
import { useCallStore } from './stores/callStore';
import { useVoiceStore } from './stores/voiceStore';
import { useTheaterStore } from './stores/theaterStore';
import { useMediaStore } from './stores/mediaStore';
import { ConnectScreen } from './components/auth/ConnectScreen';
import { AuthScreen } from './components/auth/AuthScreen';
import { CentralConsentGate } from './components/auth/CentralConsentGate';
import { AppLayout } from './components/layout/AppLayout';
import { UpdateBanner } from './components/ui/UpdateBanner';
import { SplashOverlay } from './components/ui/SplashOverlay';
import { markStartup } from './lib/startupTiming';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { DynamicImportBoundary } from './components/ui/DynamicImportBoundary';
import { DebugHoverInspector } from './components/ui/DebugHoverInspector';
import { FpsOverlay } from './components/ui/FpsOverlay';
import { useVersionCheck } from './hooks/useVersionCheck';
import { useUIStore } from './stores/uiStore';
import { subscribeDesktopLinkRequests } from './utils/externalLinks';
import { persistRealtimeReconnectTarget } from './lib/realtimeReconnect';
import { initDmPinSync, hydrateDmPinsFromCentral } from './lib/dmPinSync';
import { setVoiceDebugLoggingEnabled } from './lib/voiceDebugConsole';
import { getSocket } from './lib/socket';
import { warmVoiceRegionPreference, getPreferredVoiceRegion } from './lib/voiceRegions';
const InvitePage = lazy(() => import('./pages/InvitePage').then(m => ({ default: m.InvitePage })));
const WebAuthnLoginPage = lazy(() => import('./pages/WebAuthnLoginPage').then(m => ({ default: m.WebAuthnLoginPage })));
const WebAuthnRegisterPage = lazy(() => import('./pages/WebAuthnRegisterPage').then(m => ({ default: m.WebAuthnRegisterPage })));
const WebAuthnDeviceApprovalPage = lazy(() => import('./pages/WebAuthnDeviceApprovalPage').then(m => ({ default: m.WebAuthnDeviceApprovalPage })));
import { OBSOverlayBridge } from './components/layout/OBSOverlayBridge';
import { ScreenshareWizardApp } from './components/layout/ScreenshareWizardModal';
import { useDesktopGameActivity } from './hooks/useDesktopGameActivity';
import { useDeviceRegistration } from './hooks/useDeviceRegistration';
import { useNicknameSync } from './hooks/useNicknameSync';
import { DeviceApprovalPrompt } from './components/security/DeviceApprovalPrompt';
import { DMVaultNotice } from './components/security/DMVaultNotice';

const SOFT_RELOAD_SPLASH_BYPASS_KEY = 'catrealm.softReloadBypassSplash';
const SOFT_RELOAD_OVERLAY_KEY = 'catrealm.softReloadOverlay';

function MainApp() {
  const { serverUrl, serverInfo, isAuthenticated, user } = useAuthStore();
  useDeviceRegistration();
  useNicknameSync();

  // Central account: authenticated → go straight to AppLayout (with HomeView as default)
  if (isAuthenticated && user?.accountType === 'central') {
    return (
      <div className="h-full min-h-0 flex flex-col">
        <UpdateBanner />
        {!window.electron && (
          <div role="status" className="bg-amber-500 text-black text-center text-sm font-semibold px-3 py-2">
            Browser-stored DM keys may be erased when private browsing ends or site data is cleared. Keep another trusted device for recovery.
          </div>
        )}
        <DMVaultNotice />
        <div className="flex-1 min-h-0">
          <CentralConsentGate><AppLayout /></CentralConsentGate>
        </div>
      </div>
    );
  }

  // Decentralized path: not connected to a server yet
  if (!isAuthenticated && !serverUrl && !serverInfo) {
    return <ConnectScreen />;
  }

  // Decentralized path: connected but need to login/register on that server
  if (!isAuthenticated && serverUrl && serverInfo) {
    return <AuthScreen />;
  }

  // Decentralized path: need server URL
  if (!serverUrl || !serverInfo) {
    return <ConnectScreen />;
  }

  // Not authenticated yet
  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  // Decentralized account: authenticated + connected - show chat (no ServerListBar)
  return <AppLayout />;
}

function FullApp() {
  const location = useLocation();
  const { restoreSession, user, isAuthenticated } = useAuthStore();
  const loadPersistedServers = useServerStore((s) => s.loadPersistedServers);
  const showAvatarBackground = useSettingsStore((s) => s.showAvatarBackground);
  const heavyAnimationsEnabled = useSettingsStore((s) => s.heavyAnimationsEnabled);
  const updateChannel = useSettingsStore((s) => s.updateChannel);
  const openOnStartup = useSettingsStore((s) => s.openOnStartup);
  const minimizeToTray = useSettingsStore((s) => s.minimizeToTray);
  const openLinksInApp = useSettingsStore((s) => s.openLinksInApp);
  const voiceDebugConsoleEnabled = useSettingsStore((s) => s.voiceDebugConsoleEnabled);
  const reconnectToRealtimeChannels = useSettingsStore((s) => s.reconnectToRealtimeChannels);
  const theme = useSettingsStore((s) => s.theme);
  const customThemes = useCustomThemeStore((s) => s.themes);
  const setClientVersion = useVersionStore((s) => s.setClientVersion);
  const activeDMCall = useCallStore((s) => s.activeDMCall);
  const activeGroupCall = useCallStore((s) => s.activeGroupCall);
  const activeVoiceChannelId = useVoiceStore((s) => s.activeChannelId);
  const pendingVoiceChannelId = useVoiceStore((s) => s.pendingChannelId);
  const activeTheaterChannelId = useTheaterStore((s) => s.activeChannelId);
  const hasActiveCall = !!(
    (activeDMCall && activeDMCall.status === 'active')
    || (activeGroupCall && activeGroupCall.status === 'active')
  );
  const hasLiveVoiceSession = !!activeVoiceChannelId || hasActiveCall;
  const hasBackgroundMedia = !!(
    activeVoiceChannelId
    || pendingVoiceChannelId
    || activeDMCall
    || activeGroupCall
    || activeTheaterChannelId
  );

  const bypassStartupSplash = typeof window !== 'undefined'
    && window.sessionStorage.getItem(SOFT_RELOAD_SPLASH_BYPASS_KEY) === '1';
  const restoreSoftReloadOverlay = typeof window !== 'undefined'
    && window.sessionStorage.getItem(SOFT_RELOAD_OVERLAY_KEY) === '1';

  // Startup splash screen
  const [splashShown, setSplashShown] = useState(() => !bypassStartupSplash);
  const [splashOpaque, setSplashOpaque] = useState(() => !bypassStartupSplash);
  const [softReloadVisible, setSoftReloadVisible] = useState(() => restoreSoftReloadOverlay);
  const [closeVoiceWarningOpen, setCloseVoiceWarningOpen] = useState(false);
  const isInviteRoute = location.pathname.startsWith('/invite/') || location.pathname.startsWith('/app/invite/');
  const isHostedAuthRoute = location.pathname.startsWith('/webauthn/');
  const allowWindowCloseRef = useRef(false);
  const allowReloadRef = useRef(false);

  // Check for version updates
  useVersionCheck();
  useDesktopGameActivity();

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    warmVoiceRegionPreference();
    const refresh = () => { void getPreferredVoiceRegion({ refresh: true }); };
    window.addEventListener('online', refresh);
    return () => window.removeEventListener('online', refresh);
  }, []);

  useEffect(() => {
    if (user) markStartup('renderer_user_known');
  }, [user]);

  useEffect(() => {
    if (!splashOpaque) markStartup('renderer_app_revealed', { bypassed: bypassStartupSplash });
  }, [splashOpaque, bypassStartupSplash]);

  useEffect(() => {
    void window.electron?.setBackgroundMediaActive?.(hasBackgroundMedia).catch(() => {});
  }, [hasBackgroundMedia]);

  useEffect(() => {
    if (bypassStartupSplash) {
      window.sessionStorage.removeItem(SOFT_RELOAD_SPLASH_BYPASS_KEY);
      return;
    }
    // Runs after the restoreSession effect above (effects run in order), whose
    // store update re-renders synchronously. Reveal the app once that frame has
    // painted, so the signed-out screen never flashes behind the splash.
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        setSplashOpaque(false);
        // Matches SplashOverlay's 400ms opacity transition.
        fadeTimer = setTimeout(() => setSplashShown(false), 450);
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      if (fadeTimer) clearTimeout(fadeTimer);
    };
  }, [bypassStartupSplash]);

  useEffect(() => {
    if (!restoreSoftReloadOverlay) return;
    const fadeTimer = window.setTimeout(() => {
      setSoftReloadVisible(false);
      window.sessionStorage.removeItem(SOFT_RELOAD_OVERLAY_KEY);
    }, 550);
    return () => {
      window.clearTimeout(fadeTimer);
    };
  }, [restoreSoftReloadOverlay]);

  useEffect(() => {
    let reloadTimer: number | null = null;
    let softReloadInProgress = false;
    const handleSoftReload = () => {
      if (softReloadInProgress) return;
      softReloadInProgress = true;
      setSoftReloadVisible(true);
      reloadTimer = window.setTimeout(async () => {
        reloadTimer = null;
        await Promise.race([
          Promise.allSettled([
            useMediaStore.getState().stopScreenShare(),
            window.electron?.stopNativeWhipPublisher?.() ?? Promise.resolve(),
          ]),
          new Promise<void>((resolve) => window.setTimeout(resolve, 2500)),
        ]);
        allowReloadRef.current = true;
        window.sessionStorage.setItem(SOFT_RELOAD_SPLASH_BYPASS_KEY, '1');
        window.sessionStorage.setItem(SOFT_RELOAD_OVERLAY_KEY, '1');
        window.location.reload();
      }, 150);
    };

    window.addEventListener('catrealm:soft-reload', handleSoftReload);
    return () => {
      window.removeEventListener('catrealm:soft-reload', handleSoftReload);
      if (reloadTimer !== null) {
        window.clearTimeout(reloadTimer);
        allowReloadRef.current = false;
      }
      softReloadInProgress = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const voiceState = useVoiceStore.getState();
      const queuedVoiceChannelId = voiceState.activeChannelId ?? voiceState.pendingChannelId;
      // Best-effort: tell the server we left before the page closes so other users
      // don't see us stuck in voice during the socket disconnect grace period.
      // Socket.io/WebSocket typically flushes this before the connection closes on reload.
      if (queuedVoiceChannelId && voiceState.voiceServerUrl) {
        const sock = getSocket(voiceState.voiceServerUrl);
        if (sock?.connected) {
          sock.emit('voice:leave', { channelId: queuedVoiceChannelId });
        }
      }
      if (reconnectToRealtimeChannels) {
        const currentUserId = useAuthStore.getState().user?.id ?? null;
        if (queuedVoiceChannelId && voiceState.voiceServerUrl) {
          persistRealtimeReconnectTarget({
            kind: 'voice',
            serverUrl: voiceState.voiceServerUrl,
            channelId: queuedVoiceChannelId,
            channelName: voiceState.voiceChannelName ?? null,
            userId: currentUserId,
          });
        } else {
          const theaterStateSnapshot = useTheaterStore.getState();
          const theaterServerUrl = theaterStateSnapshot.theaterServerUrl;
          if (theaterStateSnapshot.activeChannelId && theaterServerUrl) {
            persistRealtimeReconnectTarget({
              kind: 'theater',
              serverUrl: theaterServerUrl,
              channelId: theaterStateSnapshot.activeChannelId,
              channelName: theaterStateSnapshot.theaterChannelName ?? null,
              userId: currentUserId,
            });
          }
        }
      }
      if (!window.electron) return;
      if (allowWindowCloseRef.current || allowReloadRef.current) return;
      if (minimizeToTray || !hasLiveVoiceSession) return;
      event.preventDefault();
      event.returnValue = '';
      setCloseVoiceWarningOpen(true);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasLiveVoiceSession, minimizeToTray, reconnectToRealtimeChannels]);

  const handleConfirmAppClose = () => {
    allowWindowCloseRef.current = true;
    window.electron?.quitApp().catch(() => {
      window.close();
    });
  };

  useEffect(() => {
    const BUILT_INS = ['retro-discord', 'dark-cat', 'angel-cat', 'midnight-cat'];
    const KNOWN_VARS = [
      'bg-deepest', 'bg-sidebar', 'bg-chat', 'bg-hover', 'bg-input',
      'bg-elevated', 'text-primary', 'text-secondary', 'text-muted',
      'accent', 'accent-hover', 'border',
    ];
    if (BUILT_INS.includes(theme)) {
      KNOWN_VARS.forEach((k) => document.documentElement.style.removeProperty(`--color-${k}`));
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      const custom = customThemes.find((t) => t.id === theme);
      document.documentElement.setAttribute('data-theme', 'custom');
      if (custom) {
        Object.entries(custom.colors).forEach(([k, v]) =>
          document.documentElement.style.setProperty(`--color-${k}`, v)
        );
      }
    }
  }, [theme, customThemes]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('avatar-bg-disabled', !showAvatarBackground);
  }, [showAvatarBackground]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('heavy-fx', heavyAnimationsEnabled);
  }, [heavyAnimationsEnabled]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    let cancelled = false;

    const applyCompositorClass = (mode: 'browser' | 'd3d11' | 'vulkan' | 'software') => {
      document.body.classList.toggle('compositor-browser', mode === 'browser');
      document.body.classList.toggle('compositor-d3d11', mode === 'd3d11');
      document.body.classList.toggle('compositor-vulkan', mode === 'vulkan');
      document.body.classList.toggle('compositor-software', mode === 'software');
    };

    const detectCompositor = async () => {
      if (!window.electron?.getScreenShareVideoEncoding) {
        if (!cancelled) applyCompositorClass('browser');
        return;
      }

      const config = await window.electron.getScreenShareVideoEncoding().catch(() => null);
      if (cancelled) return;

      const backend = config?.applied?.encoderBackend ?? config?.encoderBackend;
      const gpuCompositing = config?.diagnostics?.chromiumGpuCompositing;

      if (gpuCompositing !== 'enabled') {
        applyCompositorClass('software');
      } else if (backend === 'd3d11') {
        applyCompositorClass('d3d11');
      } else if (backend === 'vulkan') {
        applyCompositorClass('vulkan');
      } else {
        applyCompositorClass('software');
      }
    };

    void detectCompositor();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!window.electron?.setUpdateChannel) return;
    window.electron.setUpdateChannel(updateChannel).catch(() => {});
  }, [updateChannel]);

  useEffect(() => {
    setVoiceDebugLoggingEnabled(voiceDebugConsoleEnabled);
    if (!window.electron?.setVoiceDebugConsoleEnabled) return;
    window.electron.setVoiceDebugConsoleEnabled(voiceDebugConsoleEnabled).catch(() => {});
  }, [voiceDebugConsoleEnabled]);

  useEffect(() => {
    if (!window.electron?.setOpenOnStartup) return;
    window.electron.setOpenOnStartup(openOnStartup).catch(() => {});
  }, [openOnStartup]);

  useEffect(() => {
    if (!window.electron?.setMinimizeToTray) return;
    window.electron.setMinimizeToTray(minimizeToTray).catch(() => {});
  }, [minimizeToTray]);

  useEffect(() => {
    if (!window.electron?.setOpenLinksInApp) return;
    window.electron.setOpenLinksInApp(openLinksInApp).catch(() => {});
  }, [openLinksInApp]);

  useEffect(() => {
    if (!window.electron?.getAppVersion) return;
    window.electron
      .getAppVersion()
      .then((result) => {
        if (result?.version) {
          setClientVersion(result.version);
        }
      })
      .catch(() => {});
  }, [setClientVersion]);

  // Load persisted servers after central auth is restored
  useEffect(() => {
    if (isAuthenticated && user?.accountType === 'central') {
      loadPersistedServers();
      initDmPinSync();
      void hydrateDmPinsFromCentral();
    }
  }, [isAuthenticated, user?.accountType, loadPersistedServers]);

  return (
    <>
      <OBSOverlayBridge />
      <DebugHoverInspector />
      <FpsOverlay />
      <Routes>
        <Route
          path="/invite/:code"
          element={(
            <DynamicImportBoundary contextLabel="the invite page">
              <Suspense fallback={null}>
                <InvitePage />
              </Suspense>
            </DynamicImportBoundary>
          )}
        />
        <Route path="/webauthn/login/:flowId" element={
          <DynamicImportBoundary contextLabel="the passkey sign-in page">
            <Suspense fallback={<div>Loading…</div>}><WebAuthnLoginPage /></Suspense>
          </DynamicImportBoundary>
        } />
        <Route
          path="/webauthn/register/:flowId"
          element={(
            <DynamicImportBoundary contextLabel="the passkey registration page">
              <Suspense fallback={null}>
                <WebAuthnRegisterPage />
              </Suspense>
            </DynamicImportBoundary>
          )}
        />
        <Route
          path="/webauthn/device-approval/:flowId"
          element={(
            <DynamicImportBoundary contextLabel="the device approval page">
              <Suspense fallback={null}>
                <WebAuthnDeviceApprovalPage />
              </Suspense>
            </DynamicImportBoundary>
          )}
        />
        <Route
          path="/webauthn/device-protection/:flowId"
          element={(
            <DynamicImportBoundary contextLabel="the device protection page">
              <Suspense fallback={null}>
                <WebAuthnDeviceApprovalPage />
              </Suspense>
            </DynamicImportBoundary>
          )}
        />
        <Route
          path="*"
          element={(
            <DynamicImportBoundary contextLabel="the app">
              <MainApp />
            </DynamicImportBoundary>
          )}
        />
      </Routes>
      <DeviceApprovalPrompt />
      {splashShown && !isInviteRoute && !isHostedAuthRoute && <SplashOverlay visible={splashOpaque} />}
      {softReloadVisible && (
        <SplashOverlay
          visible
          message="Refreshing CatRealm..."
          backgroundColor="transparent"
        />
      )}
      <ConfirmDialog
        open={closeVoiceWarningOpen}
        onClose={() => setCloseVoiceWarningOpen(false)}
        onConfirm={handleConfirmAppClose}
        title="Close CatRealm While In Call?"
        message="You are still connected to a voice session. Closing CatRealm will disconnect you from voice or calls. Enable Close Button Minimizes to Tray if you want CatRealm to stay connected in the background."
        confirmText="Close App"
        cancelText="Stay Open"
        variant="danger"
      />
    </>
  );
}

function App() {
  const location = useLocation();
  const openModal = useUIStore((s) => s.openModal);
  useEffect(() => subscribeDesktopLinkRequests(openModal), [openModal]);
  // The desktop shell may open a dedicated window (e.g. the screenshare wizard)
  // whose URL query can be lost to a reload/redirect. It also sets a durable
  // window marker, so fall back to that when the query is absent.
  const standalone =
    new URLSearchParams(location.search).get('standalone') ||
    (window as Window & { __CATREALM_STANDALONE__?: string }).__CATREALM_STANDALONE__;
  // reducedMotion="user" makes Framer auto-suppress transform/scale (keeping
  // opacity) whenever the OS requests reduced motion — independent of the
  // user's intensity setting.
  return (
    <MotionConfig reducedMotion="user">
      {standalone === 'screenshare-wizard' ? <ScreenshareWizardApp /> : <FullApp />}
    </MotionConfig>
  );
}

export default App;
