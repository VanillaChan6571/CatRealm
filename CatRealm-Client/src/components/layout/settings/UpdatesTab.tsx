import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchDesktopUpdateChannelCatalog } from '../../../lib/updateChannelApi';
import {
  FALLBACK_UPDATE_CHANNEL_CATALOG,
  getAvailableUpdateChannels,
  getDefaultAvailableUpdateChannel,
  isUpdateChannelAvailable,
} from '../../../lib/updateChannels';
import type { DesktopUpdateChannelCatalog } from '../../../lib/updateChannels';

type UpdatesTabProps = {
  clientVersion: string;
  devBuilds: boolean;
  setDevBuilds: (v: boolean) => void;
  updateChannel: AppUpdateChannel;
  setUpdateChannel: (v: AppUpdateChannel) => void;
  voiceDebugConsoleEnabled: boolean;
  setVoiceDebugConsoleEnabled: (v: boolean) => void;
  isDesktopClient: boolean;
};

function formatUpdateStatus(status: AppUpdateStatus, t: (key: string, options?: Record<string, unknown>) => string): string {
  switch (status.state) {
    case 'queued':
      return status.message ?? t('settingsContent.updateQueued');
    case 'checking':
      return t('settingsContent.checkingUpdates');
    case 'downloading':
      return typeof status.percent === 'number'
        ? t('settingsContent.downloadingUpdatePercent', { percent: Math.round(status.percent) })
        : t('settingsContent.downloadingUpdate');
    case 'downloaded':
      return status.version ? t('settingsContent.updateVersionReady', { version: status.version }) : t('settingsContent.updateReady');
    case 'not-available':
      return t('settingsContent.noUpdates');
    case 'error':
      return status.message ?? t('settingsContent.updateFailed');
    case 'unsupported':
      return t('settingsContent.updaterUnavailable');
    default:
      return t('settingsContent.idle');
  }
}

export function UpdatesTab(props: UpdatesTabProps) {
  const { t } = useTranslation();
  const {
    clientVersion,
    devBuilds,
    setDevBuilds,
    updateChannel,
    setUpdateChannel,
    voiceDebugConsoleEnabled,
    setVoiceDebugConsoleEnabled,
    isDesktopClient,
  } = props;
  const [status, setStatus] = useState<AppUpdateStatus>({ state: 'idle' });
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [forceUpdateBusy, setForceUpdateBusy] = useState(false);
  const [downgradeBusy, setDowngradeBusy] = useState(false);
  const [nextCheckAt, setNextCheckAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [channelCatalog, setChannelCatalog] = useState<DesktopUpdateChannelCatalog>(FALLBACK_UPDATE_CHANNEL_CATALOG);
  const [channelCatalogState, setChannelCatalogState] = useState<'loading' | 'ready' | 'fallback'>(
    isDesktopClient ? 'loading' : 'fallback'
  );
  const [channelResetNotice, setChannelResetNotice] = useState<string | null>(null);

  const [stableVersion, devVersion] = useMemo(() => {
    const [base, prerelease] = clientVersion.split('-', 2);
    return [base || clientVersion, prerelease || null];
  }, [clientVersion]);
  const canRequestStableDowngrade = isDesktopClient && (devBuilds || !!devVersion);
  const availableUpdateChannels = useMemo(() => {
    const available = getAvailableUpdateChannels(channelCatalog);
    return available.length > 0 ? available : FALLBACK_UPDATE_CHANNEL_CATALOG.channels;
  }, [channelCatalog]);
  const selectedUpdateChannel = useMemo(
    () => availableUpdateChannels.find((channel) => channel.id === updateChannel) ?? null,
    [availableUpdateChannels, updateChannel]
  );

  useEffect(() => {
    if (!isDesktopClient || !window.electron) return;
    let mounted = true;

    window.electron.getNextUpdateCheckAt()
      .then((result) => {
        if (mounted) setNextCheckAt(result?.nextCheckAt ?? null);
      })
      .catch(() => {});

    window.electron.getUpdateStatus()
      .then((next) => {
        if (mounted) setStatus(next);
      })
      .catch(() => {});

    const unsubscribe = window.electron.onUpdateStatus((next) => {
      if (mounted) setStatus(next);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [isDesktopClient]);

  useEffect(() => {
    if (!isDesktopClient) {
      setChannelCatalog(FALLBACK_UPDATE_CHANNEL_CATALOG);
      setChannelCatalogState('fallback');
      return;
    }

    const controller = new AbortController();
    setChannelCatalogState('loading');
    fetchDesktopUpdateChannelCatalog(controller.signal)
      .then((catalog) => {
        if (controller.signal.aborted) return;
        setChannelCatalog(catalog);
        setChannelCatalogState('ready');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setChannelCatalog(FALLBACK_UPDATE_CHANNEL_CATALOG);
        setChannelCatalogState('fallback');
      });

    return () => controller.abort();
  }, [isDesktopClient]);

  useEffect(() => {
    if (channelCatalogState !== 'ready') return;
    if (isUpdateChannelAvailable(channelCatalog, updateChannel)) {
      setChannelResetNotice(null);
      return;
    }
    const fallbackChannel = getDefaultAvailableUpdateChannel(channelCatalog);
    if (fallbackChannel !== updateChannel) {
      setUpdateChannel(fallbackChannel);
      setChannelResetNotice(t('settingsContent.updateChannelUnavailableReset'));
    }
  }, [channelCatalog, channelCatalogState, setUpdateChannel, t, updateChannel]);

  useEffect(() => {
    if (!isDesktopClient || nextCheckAt === null) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isDesktopClient, nextCheckAt]);

  const nextCheckLabel = useMemo(() => {
    if (!isDesktopClient || nextCheckAt === null) return null;
    const deltaMs = Math.max(0, nextCheckAt - now);
    const totalSeconds = Math.ceil(deltaMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const relative = hours > 0
      ? `${hours}h ${minutes}m ${seconds}s`
      : minutes > 0
        ? `${minutes}m ${seconds}s`
        : `${seconds}s`;
    const absolute = new Date(nextCheckAt).toLocaleString();
    return { absolute, relative };
  }, [isDesktopClient, nextCheckAt, now]);

  const syncNow = async () => {
    if (!window.electron?.checkForUpdates) return;
    setSyncError(null);
    setSyncing(true);
    try {
      const result = await window.electron.checkForUpdates();
      const nextCheckResult = await window.electron.getNextUpdateCheckAt().catch(() => ({ nextCheckAt: null }));
      setNextCheckAt(nextCheckResult?.nextCheckAt ?? null);
      setNow(Date.now());
      if (!result.ok) {
        setSyncError(result.message ?? t('settingsContent.failedSyncUpdates'));
      }
    } catch {
      setSyncError(t('settingsContent.failedSyncUpdates'));
    } finally {
      setSyncing(false);
    }
  };

  const forceNextUpdate = async () => {
    if (!window.electron?.queueNextUpdateInstall) return;
    setSyncError(null);
    setForceUpdateBusy(true);
    try {
      const result = await window.electron.queueNextUpdateInstall();
      const nextCheckResult = await window.electron.getNextUpdateCheckAt().catch(() => ({ nextCheckAt: null }));
      setNextCheckAt(nextCheckResult?.nextCheckAt ?? null);
      setNow(Date.now());
      if (!result.ok) {
        setSyncError(result.message ?? t('settingsContent.failedQueueUpdate'));
      }
    } catch {
      setSyncError(t('settingsContent.failedQueueUpdate'));
    } finally {
      setForceUpdateBusy(false);
    }
  };

  const downgradeClient = async () => {
    if (!window.electron?.downgradeClient) return;
    setSyncError(null);
    setDowngradeBusy(true);
    try {
      const result = await window.electron.downgradeClient();
      if (result.ok) {
        setDevBuilds(false);
      } else {
        setSyncError(result.message ?? t('settingsContent.failedStableDowngrade'));
      }
      const nextCheckResult = await window.electron.getNextUpdateCheckAt().catch(() => ({ nextCheckAt: null }));
      setNextCheckAt(nextCheckResult?.nextCheckAt ?? null);
      setNow(Date.now());
    } catch {
      setSyncError(t('settingsContent.failedStableDowngrade'));
    } finally {
      setDowngradeBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h3 className="text-xl font-bold text-text-primary">{t('settings.navUpdates')}</h3>

      <div className="rounded border border-border bg-bg-hover/30 p-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-text-primary">{t('settingsContent.stableVersion')}</p>
            <p className="text-xs text-text-muted">{t('settingsContent.stableVersionDesc')}</p>
          </div>
          <span className="rounded border border-border bg-bg-input px-2.5 py-1 text-sm text-text-primary">
            {stableVersion}
          </span>
        </div>

        {devBuilds && (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-text-primary">{t('settingsContent.devBuildVersion')}</p>
              <p className="text-xs text-text-muted">{t('settingsContent.devBuildVersionDesc')}</p>
            </div>
            <span className="rounded border border-border bg-bg-input px-2.5 py-1 text-sm text-text-primary">
              {devVersion ? devVersion.toUpperCase() : t('settingsContent.notDevBuild')}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-text-primary">{t('settingsContent.syncUpdates')}</p>
            <p className="text-xs text-text-muted">
              {t('settingsContent.syncUpdatesDesc')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={!isDesktopClient || syncing}
            className="rounded bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
          >
            {syncing ? t('settingsContent.syncing') : t('settingsContent.sync')}
          </button>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-text-primary">{t('settingsContent.forceNextUpdate')}</p>
            <p className="text-xs text-text-muted">
              {t('settingsContent.forceNextUpdateDesc')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void forceNextUpdate()}
            disabled={!isDesktopClient || forceUpdateBusy}
            className="rounded bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
          >
            {forceUpdateBusy ? t('settingsContent.queuing') : t('settingsContent.forceNextUpdate')}
          </button>
        </div>

        {canRequestStableDowngrade && (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-text-primary">{t('settingsContent.downgradeStable')}</p>
              <p className="text-xs text-text-muted">
                {t('settingsContent.downgradeStableDesc')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void downgradeClient()}
              disabled={!isDesktopClient || downgradeBusy}
              className="rounded border border-border bg-bg-input px-3 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-bg-hover disabled:opacity-50"
            >
              {downgradeBusy ? t('settingsContent.queuing') : t('settingsContent.downgradeClient')}
            </button>
          </div>
        )}

        <div className="rounded border border-border bg-bg-primary/40 px-3 py-2">
          <p className="text-xs font-medium text-text-primary">{t('settingsContent.updaterStatus')}</p>
          <p className="mt-1 text-xs text-text-muted">
            {syncError ?? formatUpdateStatus(status, t)}
          </p>
          {nextCheckLabel && (
            <p className="mt-2 text-xs text-text-muted">
              {t('settingsContent.nextAutomaticCheck', nextCheckLabel)}
            </p>
          )}
        </div>
      </div>

      <p className="text-sm text-text-muted">
        {t('settingsContent.updateBuildsDesc')}
      </p>

      <div className="bg-bg-hover/30 p-4 rounded-lg space-y-3">
        <div>
          <p className="text-sm font-medium text-text-primary">{t('settingsContent.updateChannel')}</p>
          <p className="text-xs text-text-muted">
            {selectedUpdateChannel?.description || t('settingsContent.updateChannelDesc')}
          </p>
        </div>
        <select
          value={updateChannel}
          onChange={(e) => {
            const channel = e.target.value as AppUpdateChannel;
            if (channel === 'latest') setDevBuilds(false);
            setUpdateChannel(channel);
          }}
          disabled={!isDesktopClient}
          className="w-full rounded border border-border bg-bg-input px-3 py-2 text-sm font-medium text-text-primary outline-none transition-colors focus:border-accent disabled:opacity-50"
        >
          {availableUpdateChannels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.label}
            </option>
          ))}
        </select>
        {channelCatalogState === 'loading' && (
          <p className="text-xs text-text-muted">{t('settingsContent.updateChannelLoading')}</p>
        )}
        {channelCatalogState === 'fallback' && isDesktopClient && (
          <p className="text-xs text-text-muted">{t('settingsContent.updateChannelCatalogFallback')}</p>
        )}
        {channelResetNotice && (
          <p className="text-xs text-yellow-300">{channelResetNotice}</p>
        )}
        <div className="flex items-center justify-between gap-4 rounded border border-border bg-bg-primary/40 px-3 py-3">
          <div>
            <p className="text-sm font-medium text-text-primary">{t('settingsContent.debugConsole')}</p>
            <p className="text-xs text-text-muted">
              {t('settingsContent.debugConsoleDesc')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setVoiceDebugConsoleEnabled(!voiceDebugConsoleEnabled)}
            disabled={!isDesktopClient}
            className={`relative h-6 w-12 rounded-full transition-colors disabled:opacity-50 ${
              voiceDebugConsoleEnabled ? 'bg-accent' : 'bg-bg-hover'
            }`}
            aria-label={t('settingsContent.toggleVoiceDebugConsole')}
            aria-pressed={voiceDebugConsoleEnabled}
          >
            <span
              className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${
                voiceDebugConsoleEnabled ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>
      </div>

      {!isDesktopClient && (
        <div className="rounded border border-border bg-bg-hover/30 p-4">
          <p className="text-sm text-text-muted">
            {t('settingsContent.desktopUpdaterOnly')}
          </p>
        </div>
      )}
    </div>
  );
}
