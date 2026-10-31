const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame) contextBridge.exposeInMainWorld('electron', {
  showDesktopNotification: (notification) => ipcRenderer.invoke('desktop-notification-show', notification),
  dismissDesktopNotifications: (target) => ipcRenderer.invoke('desktop-notification-dismiss', target),
  onDesktopNotificationClick: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, target) => callback(target);
    ipcRenderer.on('desktop-notification-click', handler);
    return () => ipcRenderer.removeListener('desktop-notification-click', handler);
  },
  getDesktopSources: (opts) => ipcRenderer.invoke('desktop-sources', opts),
  getDesktopAudioCaptureSupport: () => ipcRenderer.invoke('desktop-audio-capture-support'),
  startAppAudioCapture: (opts) => ipcRenderer.invoke('app-audio-capture-start', opts),
  stopAppAudioCapture: (captureId) => ipcRenderer.invoke('app-audio-capture-stop', captureId),
  getNativeWhipPublisherSupport: (opts) => ipcRenderer.invoke('native-whip-publisher-support', opts),
  listScreenShareGpus: () => ipcRenderer.invoke('list-screenshare-gpus'),
  startNativeWhipPublisher: (opts) => ipcRenderer.invoke('native-whip-publisher-start', opts),
  stopNativeWhipPublisher: (publisherId) => ipcRenderer.invoke('native-whip-publisher-stop', publisherId),
  onAppAudioCaptureData: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('app-audio-capture-data', handler);
    return () => ipcRenderer.removeListener('app-audio-capture-data', handler);
  },
  onAppAudioCaptureStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('app-audio-capture-status', handler);
    return () => ipcRenderer.removeListener('app-audio-capture-status', handler);
  },
  onAppAudioCaptureStopped: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('app-audio-capture-stopped', handler);
    return () => ipcRenderer.removeListener('app-audio-capture-stopped', handler);
  },
  onNativeWhipPublisherStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('native-whip-publisher-status', handler);
    return () => ipcRenderer.removeListener('native-whip-publisher-status', handler);
  },
  onNativeWhipPublisherStopped: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('native-whip-publisher-stopped', handler);
    return () => ipcRenderer.removeListener('native-whip-publisher-stopped', handler);
  },
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openScreenshareWizard: () => ipcRenderer.invoke('open-screenshare-wizard'),
  relaunchApp: () => ipcRenderer.invoke('app-relaunch'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  queueNextUpdateInstall: () => ipcRenderer.invoke('queue-next-update-install'),
  downgradeClient: () => ipcRenderer.invoke('downgrade-client'),
  clearAndRetryUpdate: () => ipcRenderer.invoke('clear-and-retry-update'),
  setUpdateChannel: (channel) => ipcRenderer.invoke('set-update-channel', channel),
  getUpdateChannel: () => ipcRenderer.invoke('get-update-channel'),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  getNextUpdateCheckAt: () => ipcRenderer.invoke('get-next-update-check-at'),
  setVoiceDebugConsoleEnabled: (enabled) => ipcRenderer.invoke('set-voice-debug-console-enabled', enabled),
  voiceDebugLog: (entry) => ipcRenderer.invoke('voice-debug-log', entry),
  clientDebugLog: (entry) => ipcRenderer.invoke('client-debug-log', entry),
  captureTestDebugEnabled: () => process.env.CATREALM_CAPTURE_TEST_DEBUG === '1',
  getDebugLogPaths: () => ipcRenderer.invoke('get-debug-log-paths'),
  getAppMetrics: () => ipcRenderer.invoke('get-app-metrics'),
  setBackgroundMediaActive: (active) => ipcRenderer.invoke('set-background-media-active', !!active),
  getOpenOnStartup: () => ipcRenderer.invoke('get-open-on-startup'),
  setOpenOnStartup: (enabled) => ipcRenderer.invoke('set-open-on-startup', enabled),
  getMinimizeToTray: () => ipcRenderer.invoke('get-minimize-to-tray'),
  setMinimizeToTray: (enabled) => ipcRenderer.invoke('set-minimize-to-tray', enabled),
  fixScreenshareFirewallRule: () => ipcRenderer.invoke('fix-screenshare-firewall-rule'),
  onScreenshareFirewallRuleStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('screenshare-firewall-rule-status', handler);
    return () => ipcRenderer.removeListener('screenshare-firewall-rule-status', handler);
  },
  getOpenLinksInApp: () => ipcRenderer.invoke('get-open-links-in-app'),
  setOpenLinksInApp: (enabled) => ipcRenderer.invoke('set-open-links-in-app', enabled),
  getScreenShareVideoEncoding: () => ipcRenderer.invoke('get-screen-share-video-encoding'),
  setScreenShareVideoEncoding: (config) => ipcRenderer.invoke('set-screen-share-video-encoding', config),
  getGameActivityState: () => ipcRenderer.invoke('get-game-activity-state'),
  setGameActivityEnabled: (enabled) => ipcRenderer.invoke('set-game-activity-enabled', enabled),
  invalidateGameActivityCatalog: () => ipcRenderer.invoke('invalidate-game-activity-catalog'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  openExternal: (url) => ipcRenderer.invoke('open-external-url', url),
  openProtectedLink: (url) => ipcRenderer.invoke('open-protected-link', url),
  onProtectedLinkRequest: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, url) => callback(url);
    ipcRenderer.on('protected-link-request', handler);
    return () => ipcRenderer.removeListener('protected-link-request', handler);
  },
  setAdFrameMounted: (mounted) => ipcRenderer.invoke('ad-frame-mounted', mounted === true),
  openPasskeyWindow: (url) => ipcRenderer.invoke('open-passkey-window', url),
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('app-update-status', handler);
    return () => ipcRenderer.removeListener('app-update-status', handler);
  },
  obsOverlaySetEnabled: (enabled, port) => ipcRenderer.invoke('obs-overlay-set-enabled', { enabled, port }),
  obsOverlayUpdateState: (state) => ipcRenderer.invoke('obs-overlay-update-state', state),
  reactiveAvatarSaveImage: (bytes, options) => ipcRenderer.invoke('reactive-avatar-save-image', bytes, options),
  reactiveAvatarReadImage: (id) => ipcRenderer.invoke('reactive-avatar-read-image', id),
  reactiveAvatarPrune: (keepIds) => ipcRenderer.invoke('reactive-avatar-prune', keepIds),
  embedLoginOpen: (platform) => ipcRenderer.invoke('embed-login-open', platform),
  embedLoginStatus: (platform) => ipcRenderer.invoke('embed-login-status', platform),
  embedLoginLogout: (platform) => ipcRenderer.invoke('embed-login-logout', platform),
  theaterYouTubeCookieOpen: () => ipcRenderer.invoke('theater-youtube-cookie-open'),
  theaterYouTubeCookieStatus: () => ipcRenderer.invoke('theater-youtube-cookie-status'),
  theaterYouTubeCookieExport: () => ipcRenderer.invoke('theater-youtube-cookie-export'),
  theaterYouTubeCookieClear: () => ipcRenderer.invoke('theater-youtube-cookie-clear'),
  onGameActivityState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('game-activity-state', handler);
    return () => ipcRenderer.removeListener('game-activity-state', handler);
  },
  setWindowFullscreen: (fullscreen) => ipcRenderer.invoke('set-window-fullscreen', fullscreen),
  getWindowFullscreen: () => ipcRenderer.invoke('get-window-fullscreen'),
  onWindowFullscreenChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, fullscreen) => callback(fullscreen);
    ipcRenderer.on('window-fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('window-fullscreen-changed', handler);
  },
});
