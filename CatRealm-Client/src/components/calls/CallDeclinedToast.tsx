import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { PhoneMissed, X } from 'lucide-react';
import { useCallStore } from '../../stores/callStore';

const AUTO_DISMISS_MS = 5000;

/**
 * Non-blocking "X declined the call" notice. This replaced a native alert():
 * in Electron on Windows a native dialog leaves the page's text inputs unable
 * to take keyboard focus after it closes, which froze the chat box.
 */
export function CallDeclinedToast() {
  const notice = useCallStore((s) => s.declinedNotice);
  const dismiss = useCallStore((s) => s.dismissDeclinedNotice);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [notice, dismiss]);

  if (!notice) return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] flex items-center gap-3 rounded-lg border border-border bg-bg-elevated px-4 py-2.5 shadow-xl"
    >
      <PhoneMissed className="w-4 h-4 text-danger shrink-0" aria-hidden="true" />
      <span className="text-sm text-text-primary">{notice.name} declined the call</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>,
    document.body,
  );
}
