import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, X } from 'lucide-react';
import { writeClipboardText } from '../../../lib/clipboard';
import { useMediaStore } from '../../../stores/mediaStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { ReactiveAvatarsPanel } from './ReactiveAvatarsPanel';
import { TranslationPacksPanel } from './TranslationPacksPanel';
import { clearTranslationCache, shutdownEngine } from '../../../lib/translation';

type CatLabTabProps = {
  gameActivityEnabled: boolean;
  setGameActivityEnabled: (v: boolean) => void;
  gameActivityState: DesktopGameActivityState;
  obsOverlayEnabled: boolean;
  setObsOverlayEnabled: (v: boolean) => void;
  obsOverlayPort: number;
  setObsOverlayPort: (v: number) => void;
  obsOverlayShowNames: boolean;
  setObsOverlayShowNames: (v: boolean) => void;
  obsOverlayAvatarSize: 32 | 48 | 64 | 96 | 128 | 256 | 512;
  setObsOverlayAvatarSize: (v: 32 | 48 | 64 | 96 | 128 | 256 | 512) => void;
  obsOverlayGrayscaleWhenSilent: boolean;
  setObsOverlayGrayscaleWhenSilent: (v: boolean) => void;
  obsOverlayHideWhenSilent: boolean;
  setObsOverlayHideWhenSilent: (v: boolean) => void;
  obsOverlaySquareIcons: boolean;
  setObsOverlaySquareIcons: (v: boolean) => void;
  screenShareNativeWhipSimulcastEnabled: boolean;
  setScreenShareNativeWhipSimulcastEnabled: (v: boolean) => void;
};

const AVATAR_SIZES = [32, 48, 64, 96, 128, 256, 512] as const;

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center cursor-pointer shrink-0">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        className={`w-12 h-6 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-bg-hover'} relative`}
      >
        <span
          className={`absolute top-1 ${checked ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`}
        />
      </span>
    </label>
  );
}

type Platform = 'youtube' | 'x';
type LoginStatus = 'checking' | 'loggedIn' | 'loggedOut';

const PLATFORM_CARDS = [
  {
    id: 'youtube' as Platform,
    label: 'YouTube',
    descriptionKey: 'youtubeLoginDesc',
  },
  {
    id: 'x' as Platform,
    label: 'X (Twitter)',
    descriptionKey: 'xLoginDesc',
  },
] as const;

export function CatLabTab(props: CatLabTabProps) {
  const { t } = useTranslation();
  const {
    gameActivityEnabled,
    setGameActivityEnabled,
    gameActivityState,
    obsOverlayEnabled,
    setObsOverlayEnabled,
    obsOverlayPort,
    setObsOverlayPort,
    obsOverlayShowNames,
    setObsOverlayShowNames,
    obsOverlayAvatarSize,
    setObsOverlayAvatarSize,
    obsOverlayGrayscaleWhenSilent,
    setObsOverlayGrayscaleWhenSilent,
    obsOverlayHideWhenSilent,
    setObsOverlayHideWhenSilent,
    obsOverlaySquareIcons,
    setObsOverlaySquareIcons,
    screenShareNativeWhipSimulcastEnabled,
    setScreenShareNativeWhipSimulcastEnabled,
  } = props;

  const catLabTextPreview = useSettingsStore((s) => s.catLabTextPreview);
  const setCatLabTextPreview = useSettingsStore((s) => s.setCatLabTextPreview);
  const catLabFullProfileButton = useSettingsStore((s) => s.catLabFullProfileButton);
  const setCatLabFullProfileButton = useSettingsStore((s) => s.setCatLabFullProfileButton);
  const catLabAudioTracks = useSettingsStore((s) => s.catLabAudioTracks);
  const setCatLabAudioTracks = useSettingsStore((s) => s.setCatLabAudioTracks);
  const catLabAutoTranslate = useSettingsStore((s) => s.catLabAutoTranslate);
  const obsOverlayReactiveAvatars = useSettingsStore((s) => s.obsOverlayReactiveAvatars);
  const setObsOverlayReactiveAvatars = useSettingsStore((s) => s.setObsOverlayReactiveAvatars);
  const setCatLabAutoTranslate = useSettingsStore((s) => s.setCatLabAutoTranslate);
  const handleAutoTranslateChange = useCallback((value: boolean) => {
    setCatLabAutoTranslate(value);
    if (!value) {
      shutdownEngine();
      clearTranslationCache();
    }
  }, [setCatLabAutoTranslate]);
  const activeMediaServerUrl = useMediaStore((s) => s.activeSession?.serverUrl ?? null);
  const mediaCapabilityByServer = useMediaStore((s) => s.capabilityByServer);
  const nativeWhipSimulcastCapability = activeMediaServerUrl
    ? mediaCapabilityByServer[activeMediaServerUrl]?.ingress?.simulcastExperiment
    : undefined;
  const [portDraft, setPortDraft] = useState<string>(String(obsOverlayPort));
  const [copied, setCopied] = useState(false);

  // ── Process Identifier ──────────────────────────────────────────────────
  type WindowSource = { id: string; name: string; appIcon: string | null };
  type IdentifiedGame = { processName: string; title: string; steamAppId: number | null };

  const [windowSources, setWindowSources] = useState<WindowSource[]>([]);
  const [windowSourcesLoading, setWindowSourcesLoading] = useState(false);
  const [processNameInput, setProcessNameInput] = useState('');
  const [gameTitleInput, setGameTitleInput] = useState('');
  const [steamAppIdInput, setSteamAppIdInput] = useState('');
  const [identifiedGames, setIdentifiedGames] = useState<IdentifiedGame[]>(() => {
    try { return JSON.parse(localStorage.getItem('catrealm:process-identifier') ?? '[]'); } catch { return []; }
  });
  const windowSelectRef = useRef<HTMLSelectElement>(null);

  const refreshWindowSources = useCallback(async () => {
    if (!window.electron) return;
    setWindowSourcesLoading(true);
    try {
      const sources = await window.electron.getDesktopSources({
        types: ['window'],
        thumbnailSize: { width: 1, height: 1 },
      });
      setWindowSources(sources.filter((s) => s.name?.trim()));
    } catch {
      // ignore
    } finally {
      setWindowSourcesLoading(false);
    }
  }, []);

  const [appMetrics, setAppMetrics] = useState<{ totalMB: number; privateTotalMB?: number; rows: Array<{ pid: number; type: string; name: string | null; memMB: number; privateMB?: number; cpu: number }> } | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const refreshAppMetrics = useCallback(async () => {
    const getMetrics = window.electron?.getAppMetrics;
    if (!getMetrics) return;
    setMetricsLoading(true);
    try {
      setAppMetrics(await getMetrics());
    } catch {
      // ignore
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  const handleWindowSelect = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const name = e.target.value;
    if (name) setGameTitleInput(name);
  }, []);

  const handleAddToList = useCallback(() => {
    const processName = processNameInput.trim();
    const title = gameTitleInput.trim();
    if (!processName || !title) return;
    const steamId = steamAppIdInput.trim() ? (parseInt(steamAppIdInput.trim(), 10) || null) : null;
    const next = [
      ...identifiedGames.filter((g) => g.processName.toLowerCase() !== processName.toLowerCase()),
      { processName, title, steamAppId: steamId },
    ];
    setIdentifiedGames(next);
    localStorage.setItem('catrealm:process-identifier', JSON.stringify(next));
    setProcessNameInput('');
    setGameTitleInput('');
    setSteamAppIdInput('');
    if (windowSelectRef.current) windowSelectRef.current.value = '';
  }, [processNameInput, gameTitleInput, steamAppIdInput, identifiedGames]);

  const handleRemoveGame = useCallback((processName: string) => {
    const next = identifiedGames.filter((g) => g.processName !== processName);
    setIdentifiedGames(next);
    localStorage.setItem('catrealm:process-identifier', JSON.stringify(next));
  }, [identifiedGames]);

  const handleExportJson = useCallback(() => {
    const payload = identifiedGames.map((g) => ({
      title: g.title,
      processNames: [g.processName],
      steamAppId: g.steamAppId ?? null,
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'catrealm-game-processes.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [identifiedGames]);

  const [loginStatuses, setLoginStatuses] = useState<Record<Platform, LoginStatus>>({
    youtube: 'checking',
    x: 'checking',
  });
  const [loginBusy, setLoginBusy] = useState<Record<Platform, boolean>>({
    youtube: false,
    x: false,
  });

  useEffect(() => {
    if (!window.electron) return;
    for (const { id } of PLATFORM_CARDS) {
      window.electron.embedLoginStatus(id).then((result) => {
        setLoginStatuses((prev) => ({ ...prev, [id]: result.loggedIn ? 'loggedIn' : 'loggedOut' }));
      }).catch(() => {
        setLoginStatuses((prev) => ({ ...prev, [id]: 'loggedOut' }));
      });
    }
  }, []);

  const handleLogin = useCallback((platform: Platform) => {
    if (!window.electron) return;
    setLoginBusy((prev) => ({ ...prev, [platform]: true }));
    setLoginStatuses((prev) => ({ ...prev, [platform]: 'checking' }));
    window.electron.embedLoginOpen(platform).catch(() => {});

    const startTime = Date.now();
    const maxDuration = 5 * 60 * 1000;
    const interval = setInterval(() => {
      if (Date.now() - startTime > maxDuration) {
        clearInterval(interval);
        setLoginBusy((prev) => ({ ...prev, [platform]: false }));
        window.electron!.embedLoginStatus(platform).then((result) => {
          setLoginStatuses((prev) => ({ ...prev, [platform]: result.loggedIn ? 'loggedIn' : 'loggedOut' }));
        }).catch(() => {});
        return;
      }
      window.electron!.embedLoginStatus(platform).then((result) => {
        if (result.loggedIn) {
          clearInterval(interval);
          setLoginStatuses((prev) => ({ ...prev, [platform]: 'loggedIn' }));
          setLoginBusy((prev) => ({ ...prev, [platform]: false }));
        }
      }).catch(() => {});
    }, 2000);
  }, []);

  const handleLogout = useCallback(async (platform: Platform) => {
    if (!window.electron) return;
    setLoginBusy((prev) => ({ ...prev, [platform]: true }));
    setLoginStatuses((prev) => ({ ...prev, [platform]: 'checking' }));
    try {
      await window.electron.embedLoginLogout(platform);
      const result = await window.electron.embedLoginStatus(platform);
      setLoginStatuses((prev) => ({ ...prev, [platform]: result.loggedIn ? 'loggedIn' : 'loggedOut' }));
    } catch {
      setLoginStatuses((prev) => ({ ...prev, [platform]: 'loggedOut' }));
    } finally {
      setLoginBusy((prev) => ({ ...prev, [platform]: false }));
    }
  }, []);

  const overlayUrl = `http://localhost:${obsOverlayPort}`;

  const handlePortBlur = useCallback(() => {
    const parsed = parseInt(portDraft, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 65535) {
      setObsOverlayPort(parsed);
    } else {
      setPortDraft(String(obsOverlayPort));
    }
  }, [portDraft, obsOverlayPort, setObsOverlayPort]);

  const handleCopy = useCallback(() => {
    void writeClipboardText(overlayUrl).then((copied) => {
      if (!copied) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [overlayUrl]);

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h3 className="text-xl font-bold text-text-primary">{t('settings.navCatLab')}</h3>
        <p className="text-sm text-text-muted mt-1">{t('settingsContent.catLabDesc')}</p>
      </div>

      {/* Composer — live self-view text preview */}
      <div className="space-y-3">
        <div className="border-b border-border pb-2">
          <h4 className="text-base font-semibold text-text-primary">{t('settingsContent.composerTextPreviewTitle')}</h4>
          <p className="text-xs text-text-muted mt-0.5">{t('settingsContent.composerTextPreviewSectionDesc')}</p>
        </div>
        <div className="flex items-center justify-between gap-4 bg-bg-hover/30 p-4 rounded-lg">
          <div>
            <p className="text-sm font-medium text-text-primary">{t('settingsContent.composerTextPreviewToggle')}</p>
            <p className="text-xs text-text-muted mt-1">{t('settingsContent.composerTextPreviewToggleDesc')}</p>
          </div>
          <Toggle checked={catLabTextPreview} onChange={setCatLabTextPreview} />
        </div>
      </div>

      <div className="space-y-3">
        <div className="border-b border-border pb-2">
          <h4 className="text-base font-semibold text-text-primary">Profile experiments</h4>
          <p className="text-xs text-text-muted mt-0.5">Opt into profile surfaces that are still being tested.</p>
        </div>
        <div className="flex items-center justify-between gap-4 bg-bg-hover/30 p-4 rounded-lg">
          <div>
            <p className="text-sm font-medium text-text-primary">View Full Profile button</p>
            <p className="text-xs text-text-muted mt-1">
              Shows a Cat Lab action on server profiles that opens the Central full profile.
            </p>
          </div>
          <Toggle checked={catLabFullProfileButton} onChange={setCatLabFullProfileButton} />
        </div>
      </div>

      {/* Voice — per-person audio tracks */}
      <div className="space-y-3">
        <div className="border-b border-border pb-2">
          <h4 className="text-base font-semibold text-text-primary">{t('settingsContent.catLabAudioTracksTitle')}</h4>
          <p className="text-xs text-text-muted mt-0.5">{t('settingsContent.catLabAudioTracksSectionDesc')}</p>
        </div>
        <div className="flex items-center justify-between gap-4 bg-bg-hover/30 p-4 rounded-lg">
          <div>
            <p className="text-sm font-medium text-text-primary">{t('settingsContent.catLabAudioTracksToggle')}</p>
            <p className="text-xs text-text-muted mt-1">{t('settingsContent.catLabAudioTracksToggleDesc')}</p>
          </div>
          <Toggle checked={catLabAudioTracks} onChange={setCatLabAudioTracks} />
        </div>
      </div>

      {/* Chat — on-device auto-translation with per-language model packs */}
      <div className="space-y-3">
        <div className="border-b border-border pb-2">
          <h4 className="text-base font-semibold text-text-primary">{t('settingsContent.catLabAutoTranslateTitle')}</h4>
          <p className="text-xs text-text-muted mt-0.5">{t('settingsContent.catLabAutoTranslateSectionDesc')}</p>
        </div>
        <div className="flex items-center justify-between gap-4 bg-bg-hover/30 p-4 rounded-lg">
          <div>
            <p className="text-sm font-medium text-text-primary">{t('settingsContent.catLabAutoTranslateToggle')}</p>
            <p className="text-xs text-text-muted mt-1">{t('settingsContent.catLabAutoTranslateToggleDesc')}</p>
          </div>
          <Toggle checked={catLabAutoTranslate} onChange={handleAutoTranslateChange} />
        </div>
        <TranslationPacksPanel />
        <p className="text-[11px] text-text-muted">{t('settingsContent.catLabAutoTranslateCredit')}</p>
      </div>

      {typeof window !== 'undefined' && window.electron && (
        <div className="space-y-3">
          <div className="border-b border-border pb-2">
            <h4 className="text-base font-semibold text-text-primary">{t('settingsContent.catRealmEncodingExperiments')}</h4>
            <p className="text-xs text-text-muted mt-0.5">{t('settingsContent.catRealmEncodingExperimentsDesc')}</p>
          </div>
          <div className="flex items-center justify-between gap-4 bg-bg-hover/30 p-4 rounded-lg">
            <div>
              <p className="text-sm font-medium text-text-primary">{t('settingsContent.catRealmEncodingSimulcast')}</p>
              <p className="text-xs text-text-muted mt-1">{t('settingsContent.catRealmEncodingSimulcastDesc')}</p>
              <p className="text-xs text-text-muted mt-1">
                {nativeWhipSimulcastCapability === true
                  ? t('settingsContent.catRealmEncodingSimulcastHostReady')
                  : nativeWhipSimulcastCapability === false
                    ? t('settingsContent.catRealmEncodingSimulcastHostUnavailable')
                    : t('settingsContent.catRealmEncodingSimulcastHostUnknown')}
              </p>
            </div>
            <Toggle
              checked={screenShareNativeWhipSimulcastEnabled}
              onChange={setScreenShareNativeWhipSimulcastEnabled}
            />
          </div>
        </div>
      )}

      {/* Embedding Login */}
      {typeof window !== 'undefined' && window.electron && (
        <div className="space-y-4">
          {window.electron.getAppMetrics && (
            <div className="space-y-3">
              <div className="border-b border-border pb-2 flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-base font-semibold text-text-primary">Memory usage</h4>
                  <p className="text-xs text-text-muted mt-0.5">Per-process working set; shared browser pages may appear in more than one process.</p>
                </div>
                <button
                  onClick={refreshAppMetrics}
                  disabled={metricsLoading}
                  className="text-xs text-accent hover:text-accent/80 disabled:opacity-50 transition-colors shrink-0"
                >
                  {metricsLoading ? 'Loading…' : appMetrics ? 'Refresh' : 'Measure'}
                </button>
              </div>
              {appMetrics && (
                <div className="bg-bg-hover/30 p-4 rounded-lg space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-text-primary">Total · {appMetrics.rows.length} processes</span>
                    <span className="font-mono text-text-primary">{appMetrics.totalMB.toFixed(1)} MB</span>
                  </div>
                  {typeof appMetrics.privateTotalMB === 'number' && (
                    <div className="flex items-center justify-between text-xs text-text-muted">
                      <span>Private committed memory</span>
                      <span className="font-mono">{appMetrics.privateTotalMB.toFixed(1)} MB</span>
                    </div>
                  )}
                  <table className="w-full text-xs mt-1">
                    <thead>
                      <tr className="text-text-muted text-left">
                        <th className="font-medium py-1">Process</th>
                        <th className="font-medium py-1 text-right">RAM</th>
                        <th className="font-medium py-1 text-right">CPU</th>
                      </tr>
                    </thead>
                    <tbody>
                      {appMetrics.rows.map((r) => (
                        <tr key={r.pid} className="border-t border-border/50">
                          <td className="py-1 text-text-secondary">
                            {r.type}{r.name ? ` · ${r.name}` : ''} <span className="text-text-muted">#{r.pid}</span>
                          </td>
                          <td className="py-1 text-right font-mono text-text-primary">{r.memMB.toFixed(1)} MB</td>
                          <td className="py-1 text-right font-mono text-text-muted">{r.cpu.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <div className="border-b border-border pb-2">
            <h4 className="text-base font-semibold text-text-primary">{t('settingsContent.gameActivity')}</h4>
            <p className="text-xs text-text-muted mt-0.5">
              {t('settingsContent.gameActivityDesc')}
            </p>
          </div>
          <div className="bg-bg-hover/30 p-4 rounded-lg space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-text-primary">{t('settingsContent.enableDesktopGameActivity')}</p>
                <p className="text-xs text-text-muted mt-1">
                  {t('settingsContent.enableDesktopGameActivityDesc')}
                </p>
              </div>
              <Toggle checked={gameActivityEnabled} onChange={setGameActivityEnabled} />
            </div>
            <p className="text-xs text-text-muted">
              {t('settingsContent.statusLabel')}{' '}
              {gameActivityState.status === 'active' && gameActivityState.activity
                ? t('settingsContent.playingActivity', { activity: gameActivityState.activity.activityText })
                : gameActivityState.status === 'unsupported'
                  ? t('settingsContent.unsupportedPlatform')
                  : gameActivityState.status}
            </p>
            {gameActivityState.lastError ? (
              <p className="text-xs text-danger">{gameActivityState.lastError}</p>
            ) : null}
          </div>

          {/* Process Identifier */}
          <div className="border-b border-border pb-2">
            <h4 className="text-base font-semibold text-text-primary">{t('settingsContent.processIdentifier')}</h4>
            <p className="text-xs text-text-muted mt-0.5">
              {t('settingsContent.processIdentifierDesc')}
            </p>
          </div>
          <div className="bg-bg-hover/30 p-4 rounded-lg space-y-3">

            {/* Running windows dropdown */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-text-secondary">{t('settingsContent.runningWindows')}</label>
                <button
                  type="button"
                  onClick={refreshWindowSources}
                  disabled={windowSourcesLoading}
                  className="text-xs text-accent hover:text-accent/80 disabled:opacity-50 transition-colors"
                >
                  {windowSourcesLoading ? t('common.refreshing') : `↺ ${t('common.refresh')}`}
                </button>
              </div>
              <select
                ref={windowSelectRef}
                defaultValue=""
                onChange={handleWindowSelect}
                className="w-full bg-bg-input border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="" disabled>
                  {windowSources.length > 0 ? t('settingsContent.selectWindow') : 'Click Refresh to list windows'}
                </option>
                {windowSources.map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* Process name */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-text-secondary">{t('settingsContent.processName')}</label>
                {gameActivityState.status === 'active' && gameActivityState.activity?.processName && (
                  <button
                    type="button"
                    onClick={() => setProcessNameInput(gameActivityState.activity!.processName!)}
                    className="text-xs text-accent hover:text-accent/80 transition-colors"
                  >
                    {t('settingsContent.useDetected', { processName: gameActivityState.activity.processName })}
                  </button>
                )}
              </div>
              <input
                type="text"
                value={processNameInput}
                onChange={(e) => setProcessNameInput(e.target.value)}
                placeholder={t('settingsContent.processNamePlaceholder')}
                className="w-full bg-bg-input border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
              />
            </div>

            {/* Game title */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-secondary">{t('settingsContent.gameTitle')}</label>
              <input
                type="text"
                value={gameTitleInput}
                onChange={(e) => setGameTitleInput(e.target.value)}
                placeholder={t('settingsContent.gameTitlePlaceholder')}
                className="w-full bg-bg-input border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
              />
            </div>

            {/* Steam App ID */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-secondary">
                {t('settingsContent.steamAppId')} <span className="text-text-muted">{t('settingsContent.optional')}</span>
              </label>
              <input
                type="number"
                value={steamAppIdInput}
                onChange={(e) => setSteamAppIdInput(e.target.value)}
                placeholder={t('settingsContent.steamAppIdPlaceholder')}
                className="w-full bg-bg-input border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
              />
            </div>

            <button
              type="button"
              onClick={handleAddToList}
              disabled={!processNameInput.trim() || !gameTitleInput.trim()}
              className="px-4 py-2 rounded text-sm bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {t('settingsContent.addToList')}
            </button>
          </div>

          {/* Identified games list + export */}
          {identifiedGames.length > 0 && (
            <div className="space-y-2">
              {identifiedGames.map((g) => (
                <div key={g.processName} className="flex items-center gap-2 bg-bg-hover/20 px-3 py-2 rounded-lg text-sm">
                  <span className="font-mono text-xs text-text-muted shrink-0">{g.processName}</span>
                  <span className="text-text-muted shrink-0">→</span>
                  <span className="text-text-primary truncate flex-1">{g.title}</span>
                  {g.steamAppId != null && (
                    <span className="text-xs text-text-muted shrink-0">#{g.steamAppId}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemoveGame(g.processName)}
                    title={t('common.remove')}
                    className="text-text-muted hover:text-danger shrink-0 transition-colors leading-none"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={handleExportJson}
                className="w-full py-2 rounded text-sm border border-accent/50 text-accent hover:bg-accent/10 transition-colors"
              >
                {t('settingsContent.exportGameLibraryJson')}
              </button>
            </div>
          )}

          <div className="border-b border-border pb-2">
            <h4 className="text-base font-semibold text-text-primary">{t('settingsContent.embeddingLogin')}</h4>
            <p className="text-xs text-text-muted mt-0.5">
              {t('settingsContent.embeddingLoginDesc')}
            </p>
          </div>
          {PLATFORM_CARDS.map(({ id, label, descriptionKey }) => {
            const status = loginStatuses[id];
            const busy = loginBusy[id];
            return (
              <div key={id} className="bg-bg-hover/30 p-4 rounded-lg space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        status === 'checking'
                          ? 'bg-yellow-400 animate-pulse'
                          : status === 'loggedIn'
                            ? 'bg-green-400'
                            : 'bg-text-muted'
                      }`}
                    />
                    <p className="text-sm font-medium text-text-primary">{label}</p>
                    <span className="text-xs text-text-muted">
                      {status === 'checking' ? t('settingsContent.checking') : status === 'loggedIn' ? t('settingsContent.loggedIn') : t('settingsContent.notLoggedIn')}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busy || status === 'checking'}
                    onClick={() => status === 'loggedIn' ? handleLogout(id) : handleLogin(id)}
                    className="text-xs px-3 py-1.5 rounded bg-bg-hover hover:bg-bg-hover/80 text-text-primary border border-border disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                  >
                    {status === 'loggedIn' ? t('settingsContent.logOut') : t('settingsContent.logIn')}
                  </button>
                </div>
                <p className="text-xs text-text-muted pl-4">{t(`settingsContent.${descriptionKey}`)}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* OBS Voice Overlay */}
      <div className="space-y-4">
        <h4 className="text-base font-semibold text-text-primary border-b border-border pb-2">{t('settingsContent.obsVoiceOverlay')}</h4>
        <p className="text-xs text-text-muted">
          {t('settingsContent.obsVoiceOverlayDesc')}
        </p>

        {/* Master toggle */}
        <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
          <div>
            <p className="text-sm font-medium text-text-primary">{t('settingsContent.obsVoiceOverlay')}</p>
            <p className="text-xs text-text-muted">{t('settingsContent.obsVoiceOverlayToggleDesc')}</p>
          </div>
          <Toggle checked={obsOverlayEnabled} onChange={setObsOverlayEnabled} />
        </div>

        {/* Options shown only when enabled */}
        {obsOverlayEnabled && (
          <div className="space-y-3 pl-2 border-l-2 border-accent/30">

            {/* Port + URL */}
            <div className="bg-bg-hover/30 p-4 rounded-lg space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="text-sm font-medium text-text-primary block mb-1">{t('settingsContent.port')}</label>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={portDraft}
                    onChange={(e) => setPortDraft(e.target.value)}
                    onBlur={handlePortBlur}
                    className="w-32 bg-bg-input border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
              </div>
              <p className="text-xs text-text-muted">
                {t('settingsContent.overlayPortDesc', { port: obsOverlayPort })}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-bg-input border border-border rounded px-3 py-1.5 text-accent truncate">
                  {overlayUrl}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  title={t('settingsContent.copyUrl')}
                  className="shrink-0 p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Show Names */}
            <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
              <div>
                <p className="text-sm font-medium text-text-primary">{t('settingsContent.showNames')}</p>
                <p className="text-xs text-text-muted">{t('settingsContent.showNamesDesc')}</p>
              </div>
              <Toggle checked={obsOverlayShowNames} onChange={setObsOverlayShowNames} />
            </div>

            {/* Avatar Size */}
            <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
              <div>
                <p className="text-sm font-medium text-text-primary">{t('settingsContent.avatarIconSize')}</p>
                <p className="text-xs text-text-muted">{t('settingsContent.avatarIconSizeDesc')}</p>
              </div>
              <select
                value={obsOverlayAvatarSize}
                onChange={(e) => setObsOverlayAvatarSize(Number(e.target.value) as 32 | 48 | 64 | 96 | 128 | 256 | 512)}
                className="bg-bg-input border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
              >
                {AVATAR_SIZES.map((sz) => (
                  <option key={sz} value={sz}>{sz}×{sz}</option>
                ))}
              </select>
            </div>

            {/* Grayscale when silent */}
            <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
              <div>
                <p className="text-sm font-medium text-text-primary">{t('settingsContent.grayscaleSilent')}</p>
                <p className="text-xs text-text-muted">{t('settingsContent.grayscaleSilentDesc')}</p>
              </div>
              <Toggle checked={obsOverlayGrayscaleWhenSilent} onChange={setObsOverlayGrayscaleWhenSilent} />
            </div>

            {/* Hide Users Instead (indented sub-option) */}
            <div className="flex items-center justify-between bg-bg-hover/20 p-4 rounded-lg ml-6 border-l border-border">
              <div>
                <p className="text-sm font-medium text-text-primary">{t('settingsContent.hideUsersInstead')}</p>
                <p className="text-xs text-text-muted">{t('settingsContent.hideUsersInsteadDesc')}</p>
              </div>
              <Toggle checked={obsOverlayHideWhenSilent} onChange={setObsOverlayHideWhenSilent} />
            </div>

            {/* Square vs Circle */}
            <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
              <div>
                <p className="text-sm font-medium text-text-primary">{t('settingsContent.squareIcons')}</p>
                <p className="text-xs text-text-muted">{t('settingsContent.squareIconsDesc')}</p>
              </div>
              <Toggle checked={obsOverlaySquareIcons} onChange={setObsOverlaySquareIcons} />
            </div>

            {/* Reactive avatars */}
            <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
              <div>
                <p className="text-sm font-medium text-text-primary">{t('settingsContent.reactiveAvatars')}</p>
                <p className="text-xs text-text-muted">{t('settingsContent.reactiveAvatarsDesc')}</p>
              </div>
              <Toggle checked={obsOverlayReactiveAvatars} onChange={setObsOverlayReactiveAvatars} />
            </div>
            {obsOverlayReactiveAvatars && (
              <div className="ml-6 pl-3 border-l border-border">
                <ReactiveAvatarsPanel />
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
