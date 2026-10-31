import React from 'react';
import { PRESERVED_CACHE_NAMES } from '../../lib/radioCache';

type DynamicImportBoundaryProps = {
  children: React.ReactNode;
  ignorable?: boolean;
  contextLabel?: string;
  onIgnore?: () => void;
};

type DynamicImportBoundaryState = {
  error: Error | null;
  updateStatus: AppUpdateStatus | null;
  updateBusy: boolean;
  updateMessage: string | null;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

export function isDynamicImportFailure(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('dynamically imported module') ||
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('loading module was blocked') ||
    message.includes('chunkloaderror') ||
    message.includes('loading chunk') ||
    message.includes('disallowed mime type')
  );
}

export class DynamicImportBoundary extends React.Component<DynamicImportBoundaryProps, DynamicImportBoundaryState> {
  state: DynamicImportBoundaryState = {
    error: null,
    updateStatus: null,
    updateBusy: false,
    updateMessage: null,
  };

  private unsubscribeUpdateStatus: (() => void) | null = null;

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[dynamic-import-boundary]', error);
  }

  componentDidMount() {
    const electron = window.electron;
    if (!electron?.getUpdateStatus) return;

    electron.getUpdateStatus()
      .then((updateStatus) => this.setState({ updateStatus }))
      .catch(() => {});

    this.unsubscribeUpdateStatus = electron.onUpdateStatus?.((updateStatus) => {
      this.setState({ updateStatus, updateMessage: null });
    }) ?? null;
  }

  componentWillUnmount() {
    this.unsubscribeUpdateStatus?.();
  }

  private handleIgnore = () => {
    this.props.onIgnore?.();
    this.setState({ error: null });
  };

  private handleHardRefresh = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.filter((name) => !PRESERVED_CACHE_NAMES.has(name)).map((name) => caches.delete(name)));
      }
    } catch {
      // Reload anyway; this screen is already a recovery path.
    }
    window.location.href = `${window.location.origin}${window.location.pathname}?_v=${Date.now()}`;
  };

  private handleCheckForUpdates = async () => {
    const electron = window.electron;
    if (!electron?.checkForUpdates) return;

    this.setState({ updateBusy: true, updateMessage: null });
    try {
      const result = await electron.checkForUpdates();
      if (!result.ok) {
        this.setState({ updateMessage: result.message ?? 'Failed to check for updates.' });
      }
    } catch {
      this.setState({ updateMessage: 'Failed to check for updates.' });
    } finally {
      this.setState({ updateBusy: false });
    }
  };

  private handleForceNextUpdate = async () => {
    const electron = window.electron;
    if (!electron?.queueNextUpdateInstall) return;

    this.setState({ updateBusy: true, updateMessage: null });
    try {
      const result = await electron.queueNextUpdateInstall();
      this.setState({
        updateMessage: result.ok
          ? 'The next desktop update will install automatically when it is ready.'
          : result.message ?? 'Failed to queue the next desktop update.',
      });
    } catch {
      this.setState({ updateMessage: 'Failed to queue the next desktop update.' });
    } finally {
      this.setState({ updateBusy: false });
    }
  };

  private handleInstallUpdate = async () => {
    const electron = window.electron;
    if (!electron?.installUpdate) return;

    this.setState({ updateBusy: true, updateMessage: null });
    try {
      const result = await electron.installUpdate();
      if (!result.ok) {
        this.setState({ updateMessage: result.message ?? 'Update is not ready yet.', updateBusy: false });
      }
    } catch {
      this.setState({ updateMessage: 'Failed to restart into the update.', updateBusy: false });
    }
  };

  render() {
    const { error, updateBusy, updateMessage, updateStatus } = this.state;
    if (!error) {
      return this.props.children;
    }

    const message = getErrorMessage(error);
    const ignorable = !!this.props.ignorable && isDynamicImportFailure(error);
    const contextLabel = this.props.contextLabel ? ` while loading ${this.props.contextLabel}` : '';
    const desktopUpdatesAvailable = Boolean(window.electron?.checkForUpdates);
    const updateReady = updateStatus?.state === 'downloaded';
    const updateStatusText = updateStatus
      ? updateStatus.state === 'downloaded'
        ? `Desktop update${updateStatus.version ? ` ${updateStatus.version}` : ''} is ready to install.`
        : updateStatus.state === 'downloading'
          ? `Downloading desktop update${updateStatus.version ? ` ${updateStatus.version}` : ''}${typeof updateStatus.percent === 'number' ? ` (${updateStatus.percent}%)` : ''}.`
          : updateStatus.state === 'checking'
            ? 'Checking for desktop updates...'
            : updateStatus.state === 'queued'
              ? updateStatus.message ?? 'The next desktop update is queued.'
              : updateStatus.state === 'error'
                ? updateStatus.message ?? 'Desktop update check failed.'
                : updateStatus.state === 'not-available' && updateStatus.queuedAction
                  ? updateStatus.message ?? 'Waiting for the next desktop update to become available.'
                  : null
      : null;

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-2xl rounded-2xl border border-amber-300/20 bg-bg-elevated shadow-2xl overflow-hidden">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-2xl font-bold text-text-primary">Cats caught a problem{contextLabel}.</h2>
            <p className="mt-2 text-sm text-text-muted">
              A client module failed to load. This usually means the app updated but your browser still has older HTML or asset references cached.
            </p>
          </div>
          <div className="space-y-4 px-6 py-5">
            <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-danger/80">Error</div>
              <pre className="mt-2 whitespace-pre-wrap break-words text-sm text-text-primary">{message}</pre>
            </div>
            {desktopUpdatesAvailable && (
              <div className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-accent/90">Desktop Updates</div>
                <p className="mt-2 text-sm text-text-primary">
                  {updateMessage || updateStatusText || 'Check for a desktop update before reloading if this keeps crashing.'}
                </p>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              {ignorable && (
                <button
                  type="button"
                  onClick={this.handleIgnore}
                  className="rounded-lg bg-bg-hover px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-bg-input"
                >
                  Ignore
                </button>
              )}
              {desktopUpdatesAvailable && !updateReady && (
                <>
                  <button
                    type="button"
                    onClick={this.handleCheckForUpdates}
                    disabled={updateBusy}
                    className="rounded-lg bg-bg-hover px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-bg-input disabled:opacity-60"
                  >
                    {updateBusy ? 'Checking...' : 'Check Updates'}
                  </button>
                  <button
                    type="button"
                    onClick={this.handleForceNextUpdate}
                    disabled={updateBusy}
                    className="rounded-lg bg-bg-hover px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-bg-input disabled:opacity-60"
                  >
                    {updateBusy ? 'Queuing...' : 'Force Next Update'}
                  </button>
                </>
              )}
              {desktopUpdatesAvailable && updateReady && (
                <button
                  type="button"
                  onClick={this.handleInstallUpdate}
                  disabled={updateBusy}
                  className="rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-success/90 disabled:opacity-60"
                >
                  {updateBusy ? 'Restarting...' : 'Restart to Update'}
                </button>
              )}
              <button
                type="button"
                onClick={this.handleHardRefresh}
                className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-amber-300"
              >
                Clear Cache &amp; Reload
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default DynamicImportBoundary;
