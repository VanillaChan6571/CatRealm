type DeveloperTabProps = {
  debugServerStates: boolean;
  setDebugServerStates: (v: boolean) => void;
  debugCallingStates: boolean;
  setDebugCallingStates: (v: boolean) => void;
  debugTheaterStates: boolean;
  setDebugTheaterStates: (v: boolean) => void;
  debugUIHoverInspector: boolean;
  setDebugUIHoverInspector: (v: boolean) => void;
  debugFpsOverlay: boolean;
  setDebugFpsOverlay: (v: boolean) => void;
  debugGameActivity: boolean;
  setDebugGameActivity: (v: boolean) => void;
  voiceDebugConsoleEnabled: boolean;
  setVoiceDebugConsoleEnabled: (v: boolean) => void;
  isDesktopClient: boolean;
  debugViewAsRole: boolean;
  setDebugViewAsRole: (v: boolean) => void;
  forceMobileViewOnDesktop: boolean;
  setForceMobileViewOnDesktop: (v: boolean) => void;
  consoleCommand: string;
  setConsoleCommand: (v: string) => void;
  consoleRunning: boolean;
  consoleOutput: string[];
  consoleError: string | null;
  connectedToServer: boolean;
  runServerConsoleCommand: (command: string) => void;
};

export function DeveloperTab(props: DeveloperTabProps) {
  const {
    debugServerStates,
    setDebugServerStates,
    debugCallingStates,
    setDebugCallingStates,
    debugTheaterStates,
    setDebugTheaterStates,
    debugUIHoverInspector,
    setDebugUIHoverInspector,
    debugFpsOverlay,
    setDebugFpsOverlay,
    debugGameActivity,
    setDebugGameActivity,
    voiceDebugConsoleEnabled,
    setVoiceDebugConsoleEnabled,
    isDesktopClient,
    debugViewAsRole,
    setDebugViewAsRole,
    forceMobileViewOnDesktop,
    setForceMobileViewOnDesktop,
    consoleCommand,
    setConsoleCommand,
    consoleRunning,
    consoleOutput,
    consoleError,
    connectedToServer,
    runServerConsoleCommand,
  } = props;

  return (
    <div className="space-y-6 max-w-2xl">
      <h3 className="text-xl font-bold text-text-primary">Developer & Debug Panel</h3>
      <p className="text-sm text-text-muted">
        Experimental and diagnostic toggles for troubleshooting.
      </p>

      <div className="rounded border border-border bg-bg-hover/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">Debug Calling States</p>
            <p className="text-xs text-text-muted">Show DM/Group call debug overlay and WebRTC diagnostics.</p>
          </div>
          <button
            type="button"
            onClick={() => setDebugCallingStates(!debugCallingStates)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              debugCallingStates ? 'bg-accent' : 'bg-bg-hover'
            }`}
            aria-label="Toggle debug calling states"
            aria-pressed={debugCallingStates}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                debugCallingStates ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="rounded border border-border bg-bg-hover/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">Debug Server States</p>
            <p className="text-xs text-text-muted">Show live server status badges in the server list bar.</p>
          </div>
          <button
            type="button"
            onClick={() => setDebugServerStates(!debugServerStates)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              debugServerStates ? 'bg-accent' : 'bg-bg-hover'
            }`}
            aria-label="Toggle debug server states"
            aria-pressed={debugServerStates}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                debugServerStates ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="rounded border border-border bg-bg-hover/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">Debug Theater States</p>
            <p className="text-xs text-text-muted">Show Theater iframe sync overlay, player event log, and copyable playback diagnostics.</p>
          </div>
          <button
            type="button"
            onClick={() => setDebugTheaterStates(!debugTheaterStates)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              debugTheaterStates ? 'bg-accent' : 'bg-bg-hover'
            }`}
            aria-label="Toggle debug theater states"
            aria-pressed={debugTheaterStates}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                debugTheaterStates ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="rounded border border-border bg-bg-hover/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">UI Hover Inspector</p>
            <p className="text-xs text-text-muted">Show tagged component and file labels when hovering the app.</p>
          </div>
          <button
            type="button"
            onClick={() => setDebugUIHoverInspector(!debugUIHoverInspector)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              debugUIHoverInspector ? 'bg-accent' : 'bg-bg-hover'
            }`}
            aria-label="Toggle UI hover inspector"
            aria-pressed={debugUIHoverInspector}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                debugUIHoverInspector ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="rounded border border-border bg-bg-hover/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">FPS Overlay</p>
            <p className="text-xs text-text-muted">Show a live framerate / 1% low / worst-frame meter in the top-right corner.</p>
          </div>
          <button
            type="button"
            onClick={() => setDebugFpsOverlay(!debugFpsOverlay)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              debugFpsOverlay ? 'bg-accent' : 'bg-bg-hover'
            }`}
            aria-label="Toggle FPS overlay"
            aria-pressed={debugFpsOverlay}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                debugFpsOverlay ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="rounded border border-border bg-bg-hover/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">Debug Game Activity</p>
            <p className="text-xs text-text-muted">Log desktop detector, central reconcile, and server-sync activity decisions in the client console.</p>
          </div>
          <button
            type="button"
            onClick={() => setDebugGameActivity(!debugGameActivity)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              debugGameActivity ? 'bg-accent' : 'bg-bg-hover'
            }`}
            aria-label="Toggle game activity debug logs"
            aria-pressed={debugGameActivity}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                debugGameActivity ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="rounded border border-border bg-bg-hover/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">Voice Debug Console</p>
            <p className="text-xs text-text-muted">Enable LiveKit voice and screen-share diagnostics in the desktop debug log.</p>
          </div>
          <button
            type="button"
            onClick={() => setVoiceDebugConsoleEnabled(!voiceDebugConsoleEnabled)}
            disabled={!isDesktopClient}
            className={`relative w-12 h-6 rounded-full transition-colors disabled:opacity-50 ${
              voiceDebugConsoleEnabled ? 'bg-accent' : 'bg-bg-hover'
            }`}
            aria-label="Toggle voice debug console"
            aria-pressed={voiceDebugConsoleEnabled}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                voiceDebugConsoleEnabled ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="rounded border border-border bg-bg-hover/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">Debug View As Role</p>
            <p className="text-xs text-text-muted">Log view-as auth refreshes, socket permission updates, and visible channel reloads.</p>
          </div>
          <button
            type="button"
            onClick={() => setDebugViewAsRole(!debugViewAsRole)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              debugViewAsRole ? 'bg-accent' : 'bg-bg-hover'
            }`}
            aria-label="Toggle view as role debug logs"
            aria-pressed={debugViewAsRole}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                debugViewAsRole ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="rounded border border-border bg-bg-hover/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">Force Mobile View on Desktop</p>
            <p className="text-xs text-text-muted">Temporarily render the mobile layout even when the desktop window is wide.</p>
          </div>
          <button
            type="button"
            onClick={() => setForceMobileViewOnDesktop(!forceMobileViewOnDesktop)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              forceMobileViewOnDesktop ? 'bg-accent' : 'bg-bg-hover'
            }`}
            aria-label="Toggle mobile view on desktop"
            aria-pressed={forceMobileViewOnDesktop}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                forceMobileViewOnDesktop ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="rounded border border-border bg-bg-hover/30 p-4 space-y-3">
        <div>
          <p className="text-sm font-medium text-text-primary">Server Console Commands</p>
          <p className="text-xs text-text-muted">
            Run diagnostic commands through server admin API when panel console stdin is unavailable.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {['help', 'secure-status', 'db-status', 'db-latest 10', 'db-checkpoint'].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setConsoleCommand(preset)}
              className="px-2 py-1 rounded border border-border text-xs text-text-muted hover:text-text-primary hover:bg-bg-input"
            >
              {preset}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={consoleCommand}
            onChange={(e) => setConsoleCommand(e.target.value)}
            className="flex-1 bg-bg-input border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
            placeholder="db-status"
          />
          <button
            type="button"
            onClick={() => void runServerConsoleCommand(consoleCommand)}
            disabled={consoleRunning || !connectedToServer}
            className="px-3 py-2 rounded bg-accent text-white text-sm disabled:opacity-60"
          >
            {consoleRunning ? 'Running...' : 'Run'}
          </button>
        </div>

        {!connectedToServer && (
          <p className="text-xs text-danger">Not connected to a self-hosted server.</p>
        )}
        {consoleError && <p className="text-xs text-danger">{consoleError}</p>}
        <div className="rounded border border-border bg-bg-primary/60 p-3 min-h-20">
          {consoleOutput.length === 0 ? (
            <p className="text-xs text-text-muted">No output yet.</p>
          ) : (
            <pre className="text-xs text-text-primary whitespace-pre-wrap break-words">
              {consoleOutput.join('\n')}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
