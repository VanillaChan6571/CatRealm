import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SplashOverlay } from './SplashOverlay';

type BannerState =
  | { visible: false }
  | { visible: true; tone: 'info' | 'success' | 'danger'; text: string; showRestart: boolean };

type BannerContent = { tone: 'info' | 'success' | 'danger'; text: string; showRestart: boolean };

export function DesktopUpdateBanner() {
  const isDesktopClient = typeof window !== 'undefined' && Boolean(window.electron?.checkForUpdates);
  const [status, setStatus] = useState<AppUpdateStatus>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Update splash state
  const [updateSplashShown, setUpdateSplashShown] = useState(false);
  const [updateSplashOpaque, setUpdateSplashOpaque] = useState(false);
  const splashRaf1 = useRef<number | null>(null);
  const splashRaf2 = useRef<number | null>(null);

  // Banner animation state
  const [bannerMounted, setBannerMounted] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(false);
  const [bannerContent, setBannerContent] = useState<BannerContent | null>(null);
  const bannerRaf = useRef<number | null>(null);
  const bannerHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isDesktopClient || !window.electron) return;
    let mounted = true;

    window.electron.getUpdateStatus()
      .then((next) => {
        if (mounted) setStatus(next);
      })
      .catch(() => {});

    const unsubscribe = window.electron.onUpdateStatus((next) => {
      setStatus(next);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [isDesktopClient]);

  const bannerState = useMemo<BannerState>(() => {
    if (!isDesktopClient) return { visible: false };
    if (actionError) {
      return { visible: true, tone: 'danger', text: actionError, showRestart: false };
    }
    switch (status.state) {
      case 'checking':
        return { visible: true, tone: 'info', text: 'Checking for desktop updates...', showRestart: false };
      case 'queued':
        return {
          visible: true,
          tone: 'info',
          text: status.message ?? 'The next desktop update will install automatically.',
          showRestart: false,
        };
      case 'downloading': {
        const percent = typeof status.percent === 'number' ? ` (${status.percent}%)` : '';
        const version = status.version ? ` ${status.version}` : '';
        const queuedSuffix = status.queuedAction ? ' It will install automatically when ready.' : '';
        return {
          visible: true,
          tone: 'info',
          text: `Downloading update${version}${percent}.${queuedSuffix}`,
          showRestart: false,
        };
      }
      case 'downloaded': {
        const version = status.version ? ` ${status.version}` : '';
        return {
          visible: true,
          tone: 'success',
          text: `Update${version} is ready to install.`,
          showRestart: true,
        };
      }
      case 'not-available':
        if (status.queuedAction) {
          return {
            visible: true,
            tone: 'info',
            text: status.message ?? 'Waiting for the next desktop update to become available.',
            showRestart: false,
          };
        }
        return { visible: false };
      case 'error':
        return {
          visible: true,
          tone: 'danger',
          text: status.message ?? 'Desktop update check failed.',
          showRestart: false,
        };
      default:
        return { visible: false };
    }
  }, [actionError, isDesktopClient, status]);

  // Drive banner mount/visibility with smooth transitions
  useEffect(() => {
    if (bannerRaf.current !== null) cancelAnimationFrame(bannerRaf.current);
    if (bannerHideTimer.current !== null) clearTimeout(bannerHideTimer.current);

    if (bannerState.visible) {
      const { tone, text, showRestart } = bannerState;
      setBannerContent({ tone, text, showRestart });
      setBannerMounted(true);
      bannerRaf.current = requestAnimationFrame(() => {
        bannerRaf.current = requestAnimationFrame(() => {
          setBannerVisible(true);
        });
      });
    } else {
      setBannerVisible(false);
      bannerHideTimer.current = setTimeout(() => setBannerMounted(false), 350);
    }

    return () => {
      if (bannerRaf.current !== null) cancelAnimationFrame(bannerRaf.current);
      if (bannerHideTimer.current !== null) clearTimeout(bannerHideTimer.current);
    };
  }, [bannerState.visible, bannerState.visible && (bannerState as BannerContent).text]);

  const onCheckNow = useCallback(async () => {
    if (!window.electron) return;
    setActionError(null);
    setBusy(true);
    const result = await window.electron.checkForUpdates();
    if (!result.ok) {
      setActionError(result.message ?? 'Failed to check for updates.');
    }
    setBusy(false);
  }, []);

  const onForceNextUpdate = useCallback(async () => {
    if (!window.electron?.queueNextUpdateInstall) return;
    setActionError(null);
    setBusy(true);
    const result = await window.electron.queueNextUpdateInstall();
    if (!result.ok) {
      setActionError(result.message ?? 'Failed to queue the next update.');
    }
    setBusy(false);
  }, []);

  const onClearAndRetry = useCallback(async () => {
    if (!window.electron?.clearAndRetryUpdate) return;
    setActionError(null);
    setBusy(true);
    try {
      const result = await window.electron.clearAndRetryUpdate();
      if (!result.ok) {
        setActionError(result.message ?? 'Failed to retry the update.');
      }
    } catch {
      setActionError('Failed to retry the update.');
    } finally {
      setBusy(false);
    }
  }, []);

  const onRestartNow = useCallback(async () => {
    if (!window.electron) return;
    setActionError(null);
    setBusy(true);

    setUpdateSplashShown(true);
    splashRaf1.current = requestAnimationFrame(() => {
      splashRaf2.current = requestAnimationFrame(() => {
        setUpdateSplashOpaque(true);
      });
    });

    const result = await window.electron.installUpdate();
    if (!result.ok) {
      setUpdateSplashOpaque(false);
      setTimeout(() => setUpdateSplashShown(false), 450);
      setActionError(result.message ?? 'Update is not ready yet.');
      setBusy(false);
      return;
    }
    // On success the app will quit & restart; keep splash visible
  }, []);

  if (!bannerMounted && !updateSplashShown) return null;

  const dotClasses = bannerContent?.tone === 'success'
    ? 'bg-success shadow-[0_0_10px_rgba(34,197,94,0.8)]'
    : bannerContent?.tone === 'danger'
      ? 'bg-danger shadow-[0_0_10px_rgba(239,68,68,0.8)]'
      : 'bg-accent shadow-[0_0_10px_rgba(217,70,239,0.8)]';
  const actionButtonClass = 'h-6 shrink-0 whitespace-nowrap rounded bg-bg-hover px-1.5 text-[10px] font-semibold text-text-primary transition-colors hover:bg-bg-input disabled:opacity-60';
  const downloading = status.state === 'downloading';
  const downloadPercent = downloading && typeof status.percent === 'number'
    ? Math.max(0, Math.min(100, Math.round(status.percent)))
    : null;
  const isStalled = status.state === 'error' && status.stalled === true;
  const compactText = (() => {
    const text = bannerContent?.text ?? '';
    if (!bannerContent) return '';
    if (bannerContent.showRestart) return 'Update ready';
    if (bannerContent.tone === 'danger') return isStalled ? 'Download stalled' : 'Update failed';
    if (text.toLowerCase().includes('checking')) return 'Checking updates...';
    if (text.toLowerCase().includes('downloading')) {
      return downloadPercent === null ? 'Downloading update' : `Downloading ${downloadPercent}%`;
    }
    if (text.toLowerCase().includes('waiting')) return 'Waiting for update';
    if (text.toLowerCase().includes('no update')) return 'No update available';
    if (text.toLowerCase().includes('ready')) return 'Updater ready';
    return 'Updater ready';
  })();

  return (
    <>
      {updateSplashShown && (
        <SplashOverlay visible={updateSplashOpaque} message="Restarting to update..." />
      )}
      <style>
        {`
          /* The gradient pans by sliding an oversized ::after layer with transform
             (compositor-only). Panning background-position and pulsing box-shadow
             repainted the banner every display frame for as long as it was up. */
          @keyframes desktopUpdateAmbiencePan {
            0%, 100% { transform: translateX(0); }
            45% { transform: translateX(-61.5%); }
            72% { transform: translateX(-27.7%); }
          }

          @keyframes desktopUpdateShimmerSweep {
            0%, 88% {
              transform: translateX(-120%);
              opacity: 0;
            }
            91% {
              opacity: 0.72;
            }
            96%, 100% {
              transform: translateX(120%);
              opacity: 0;
            }
          }

          @keyframes desktopUpdateProgressIndeterminate {
            0% {
              transform: translateX(-110%);
              width: 32%;
            }
            55% {
              width: 58%;
            }
            100% {
              transform: translateX(330%);
              width: 32%;
            }
          }

          .desktop-update-ambience {
            position: relative;
            overflow: hidden;
            isolation: isolate;
            box-shadow: 0 0 22px rgba(216, 180, 254, 0.38);
          }

          .desktop-update-ambience::after {
            content: "";
            position: absolute;
            top: 0;
            bottom: 0;
            left: 0;
            width: 260%;
            z-index: -1;
            pointer-events: none;
            background: linear-gradient(100deg, rgba(249, 168, 255, 0.42), rgba(216, 180, 254, 0.28), rgba(34, 211, 238, 0.36), rgba(255, 255, 255, 0.14));
            animation: desktopUpdateAmbiencePan 5.8s ease-in-out infinite;
          }

          @keyframes desktopUpdateDangerPan {
            0%, 100% { transform: translateX(0); }
            50% { transform: translateX(-61.5%); }
          }

          .desktop-update-ambience--danger {
            box-shadow: 0 0 22px rgba(239, 68, 68, 0.52);
          }

          .desktop-update-ambience--danger::after {
            background: linear-gradient(100deg, rgba(239, 68, 68, 0.52), rgba(220, 38, 38, 0.34), rgba(248, 113, 113, 0.44), rgba(255, 255, 255, 0.12));
            animation: desktopUpdateDangerPan 4.4s ease-in-out infinite;
          }

          .desktop-update-ambience::before {
            content: "";
            position: absolute;
            inset: 0;
            pointer-events: none;
            background: linear-gradient(105deg, transparent 0 34%, rgba(255, 255, 255, 0.34) 48%, transparent 62% 100%);
            mix-blend-mode: screen;
            opacity: 0;
            transform: translateX(-120%);
            animation: desktopUpdateShimmerSweep 10s ease-in-out infinite;
          }

          .desktop-update-ambience > * {
            position: relative;
            z-index: 1;
          }

          .desktop-update-progress {
            position: absolute;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 2;
            height: 2px;
            overflow: hidden;
            background: rgba(255, 255, 255, 0.16);
          }

          .desktop-update-progress__bar {
            display: block;
            height: 100%;
            background: linear-gradient(90deg, rgba(34, 211, 238, 0.95), rgba(249, 168, 255, 0.95), rgba(255, 255, 255, 0.9));
            box-shadow: 0 0 10px rgba(34, 211, 238, 0.55);
            transition: width 220ms ease-out;
          }

          .desktop-update-progress__bar--indeterminate {
            animation: desktopUpdateProgressIndeterminate 1.45s cubic-bezier(.45, 0, .25, 1) infinite;
          }

          @media (prefers-reduced-motion: reduce) {
            .desktop-update-ambience::after,
            .desktop-update-ambience::before,
            .desktop-update-progress__bar--indeterminate {
              animation: none;
            }
          }
        `}
      </style>
      {bannerMounted && bannerContent && (
        <div
          className="w-full overflow-hidden"
          style={{
            transition: 'opacity 300ms ease, max-height 300ms ease, margin 300ms ease',
            opacity: bannerVisible ? 1 : 0,
            maxHeight: bannerVisible ? '48px' : '0px',
          }}
        >
          <div className={`desktop-update-ambience${bannerContent.tone === 'danger' ? ' desktop-update-ambience--danger' : ''} w-full px-2.5 py-1.5 text-[11px] text-text-primary`}>
            <div className="flex min-w-0 items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${dotClasses}`} />
              <div className="min-w-0 flex-1" title={bannerContent.text}>
                <div className="truncate text-[10px] font-semibold uppercase leading-3 text-text-secondary">Update</div>
                <div className="truncate leading-4 text-text-primary">{compactText}</div>
              </div>
              <div className="flex max-w-[112px] shrink-0 items-center justify-end gap-1">
              {!bannerContent.showRestart && bannerContent.tone === 'danger' && (
                <>
                  <button
                    onClick={onCheckNow}
                    disabled={busy}
                    className={actionButtonClass}
                  >
                    {busy ? '...' : 'Check'}
                  </button>
                  <button
                    onClick={onClearAndRetry}
                    disabled={busy}
                    title="Clear the partial download and retry"
                    className={actionButtonClass}
                  >
                    {busy ? '...' : 'Retry'}
                  </button>
                </>
              )}
              {!bannerContent.showRestart && bannerContent.tone !== 'danger' && (
                <>
                  <button
                    onClick={onCheckNow}
                    disabled={busy}
                    className={actionButtonClass}
                  >
                    {busy ? '...' : 'Check'}
                  </button>
                  <button
                    onClick={onForceNextUpdate}
                    disabled={busy}
                    className={actionButtonClass}
                  >
                    {busy ? '...' : 'Force'}
                  </button>
                </>
              )}
              {bannerContent.showRestart && (
                <>
                  <button
                    onClick={onCheckNow}
                    disabled={busy}
                    className={actionButtonClass}
                  >
                    {busy ? '...' : 'Check'}
                  </button>
                  <button
                    onClick={onRestartNow}
                    disabled={busy}
                    className={actionButtonClass}
                  >
                    Restart
                  </button>
                </>
              )}
              </div>
            </div>
            {downloading && (
              <div
                className="desktop-update-progress"
                role="progressbar"
                aria-label="Downloading desktop update"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={downloadPercent ?? undefined}
              >
                <span
                  className={`desktop-update-progress__bar ${
                    downloadPercent === null ? 'desktop-update-progress__bar--indeterminate' : ''
                  }`}
                  style={{ width: downloadPercent === null ? undefined : `${downloadPercent}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
