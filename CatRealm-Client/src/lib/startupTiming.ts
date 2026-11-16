// Startup timing marks for the Sushi (Tauri) client. Each mark is sent to the
// `startup_mark` command, which logs it to client-debug.log as milliseconds
// since the OS created the process, alongside the Rust-side marks. Elsewhere
// (web, Sparky) this is a no-op.

type TauriWindow = Window & {
  __TAURI__?: { core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } };
};

const sent = new Set<string>();

function invoke(): ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null {
  if (typeof window === 'undefined') return null;
  return (window as TauriWindow).__TAURI__?.core?.invoke ?? null;
}

/** Record a startup mark once per page load. */
export function markStartup(name: string, detail?: Record<string, unknown>) {
  const call = invoke();
  if (!call || sent.has(name)) return;
  sent.add(name);
  const at = performance.timeOrigin + performance.now();
  void call('startup_mark', { name, at, detail: detail ?? null }).catch(() => {});
}

function navigationDetail(): Record<string, number> | undefined {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (!nav) return undefined;
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    responseEndMs: round(nav.responseEnd),
    domInteractiveMs: round(nav.domInteractive),
    domContentLoadedMs: round(nav.domContentLoadedEventEnd),
  };
}

/** Mark when the browser actually painted the first React frame. */
export function markFirstPaintAfterRender() {
  if (!invoke()) return;
  // rAF runs before the next paint; the second one runs after it.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => markStartup('renderer_first_paint', navigationDetail()));
  });
}
