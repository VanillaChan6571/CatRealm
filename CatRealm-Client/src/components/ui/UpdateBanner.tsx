import { useVersionStore } from '../../stores/versionStore';
import { useState } from 'react';

export function UpdateBanner() {
  const showUpdateBanner = useVersionStore((s) => s.showUpdateBanner);
  const serverVersion = useVersionStore((s) => s.serverVersion);
  const clientVersion = useVersionStore((s) => s.clientVersion);
  const dismissBanner = useVersionStore((s) => s.dismissBanner);
  const forceReload = useVersionStore((s) => s.forceReload);
  const [desktopActionBusy, setDesktopActionBusy] = useState(false);
  const [desktopActionMessage, setDesktopActionMessage] = useState<string | null>(null);
  const isDesktopClient = typeof window !== 'undefined' && Boolean(window.electron?.queueNextUpdateInstall);

  if (!showUpdateBanner) return null;

  async function handleForceNextDesktopUpdate() {
    if (!window.electron?.queueNextUpdateInstall) return;
    setDesktopActionBusy(true);
    setDesktopActionMessage(null);
    try {
      const result = await window.electron.queueNextUpdateInstall();
      if (!result.ok) {
        setDesktopActionMessage(result.message ?? 'Failed to queue the next desktop update.');
      } else {
        setDesktopActionMessage('The next desktop update will install automatically when it finishes downloading.');
      }
    } catch {
      setDesktopActionMessage('Failed to queue the next desktop update.');
    } finally {
      setDesktopActionBusy(false);
    }
  }

  return (
    <div className="relative z-40 shrink-0 bg-gradient-to-r from-accent to-blue-600 text-white shadow-lg">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center shrink-0">
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-sm">
              Auth Server has Updated the Recommend Version to {serverVersion} build. You&apos;re still running {clientVersion} build.
            </p>
            <p className="text-xs opacity-90">
              Update &amp; Reload to get the latest features.
            </p>
            {desktopActionMessage && (
              <p className="mt-1 text-xs text-white/90">
                {desktopActionMessage}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isDesktopClient && (
            <button
              onClick={() => void handleForceNextDesktopUpdate()}
              disabled={desktopActionBusy}
              className="px-3 py-1.5 text-xs font-medium text-white/80 hover:text-white transition-colors disabled:opacity-60"
            >
              {desktopActionBusy ? 'Queuing...' : 'Force Next Desktop Update'}
            </button>
          )}
          <button
            onClick={dismissBanner}
            className="px-3 py-1.5 text-xs font-medium text-white/80 hover:text-white transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={() => void forceReload()}
            className="px-4 py-1.5 bg-white text-accent rounded font-medium text-sm hover:bg-white/90 transition-colors shadow-md"
          >
            Update &amp; Reload
          </button>
        </div>
      </div>
    </div>
  );
}
