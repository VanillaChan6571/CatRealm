import { useEffect, useState } from 'react';
import { Phone, X } from 'lucide-react';
import { useCallStore } from '../../stores/callStore';
import { useDMStore } from '../../stores/dmStore';

const REJOIN_TTL_MS = 3 * 60_000; // matches the server's DM alone timer (3 min)

export function DMCallRejoinBanner() {
  const lastEndedDMCall = useCallStore((s) => s.lastEndedDMCall);
  const rejoinCall = useCallStore((s) => s.rejoinCall);
  const clearLastEndedCall = useCallStore((s) => s.clearLastEndedCall);
  const [timeLeft, setTimeLeft] = useState(REJOIN_TTL_MS);
  // While that DM is open its call pane shows the Rejoin button instead.
  const viewingCallDM = useDMStore((s) => {
    if (!s.dmViewOpen || !lastEndedDMCall) return false;
    const conversation = s.conversations.find((c) => c.id === s.activeConversationId);
    return conversation?.otherUserId === lastEndedDMCall.otherUserId;
  });

  useEffect(() => {
    if (!lastEndedDMCall) return;
    setTimeLeft(REJOIN_TTL_MS);

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        const next = prev - 1000;
        if (next <= 0) {
          clearLastEndedCall();
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [lastEndedDMCall, clearLastEndedCall]);

  if (!lastEndedDMCall || viewingCallDM) return null;

  const secondsLeft = Math.ceil(timeLeft / 1000);

  return (
    <div className="flex items-center gap-1 rounded-2xl border border-border bg-bg-elevated/95 px-3 py-2 shadow-2xl backdrop-blur-md">
      <Phone className="h-4 w-4 text-text-muted shrink-0" />
      <span className="text-sm text-text-primary">
        {lastEndedDMCall.onOtherDevice ? 'In a call on another device with ' : 'Rejoin call with '}
        <span className="font-semibold">{lastEndedDMCall.otherUsername}</span>
        {lastEndedDMCall.onOtherDevice ? '' : '?'}
      </span>
      <span className="text-xs text-text-muted ml-1">{secondsLeft}s</span>
      <button
        type="button"
        onClick={() => void rejoinCall()}
        className="ml-2 h-7 rounded-lg bg-accent px-3 text-xs font-semibold text-white transition-colors hover:bg-accent-hover"
      >
        {lastEndedDMCall.onOtherDevice ? 'Join here' : 'Rejoin'}
      </button>
      <button
        type="button"
        onClick={clearLastEndedCall}
        className="ml-1 w-7 h-7 rounded-lg flex items-center justify-center bg-bg-hover text-text-primary hover:bg-bg-input transition-colors"
        aria-label="Dismiss"
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
