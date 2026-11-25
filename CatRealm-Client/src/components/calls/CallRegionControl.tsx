import { useEffect, useState } from 'react';
import { getCallSocket } from '../../stores/callStore';

type Region = 'eu' | 'us-central';
type Mode = 'automatic' | Region;
type RegionState = { ok?: boolean; region?: Region; mode?: Mode; canSwitch?: boolean; migrate?: boolean; error?: string };

export function CallRegionControl({ callId }: { callId: string }) {
  const [state, setState] = useState<RegionState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setState(null);
    setError(null);
    const socket = getCallSocket();
    if (!socket?.connected) return;
    let active = true;
    const timer = window.setTimeout(() => { active = false; }, 5000);
    socket.emit('call:region:get', { callId }, (response?: RegionState) => {
      if (!active) return;
      window.clearTimeout(timer);
      if (response?.ok) setState(response);
    });
    const changed = (payload: RegionState & { callId?: string }) => {
      if (payload.callId === callId) setState((current) => ({ ...current, ...payload, ok: true }));
    };
    socket.on('call:region:changed', changed);
    return () => {
      active = false;
      window.clearTimeout(timer);
      socket.off('call:region:changed', changed);
    };
  }, [callId]);

  if (!state?.ok || !state.canSwitch || !state.region) return null;
  const switchRegion = (mode: Mode) => {
    const socket = getCallSocket();
    if (!socket?.connected || pending) return;
    setPending(true);
    setError(null);
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setPending(false);
      setError('Region change timed out');
    }, 8000);
    socket.emit('call:region:switch', { callId, region: mode }, (response?: RegionState) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      setPending(false);
      if (!response?.ok) setError(response?.error || 'Could not change region');
      else setState((current) => ({ ...current, ...response }));
    });
  };

  return (
    <div className="absolute right-4 top-4 z-30 rounded-md border border-border bg-bg-elevated/95 px-3 py-2 text-xs text-text-primary shadow-lg">
      <label className="flex items-center gap-2">
        <span>Voice region: {state.region === 'eu' ? 'EU' : 'US Central'}</span>
        <select
          aria-label="Call voice region"
          value={state.mode || 'automatic'}
          disabled={pending}
          onChange={(event) => switchRegion(event.target.value as Mode)}
          className="rounded border border-border bg-bg-secondary px-2 py-1 text-text-primary"
        >
          <option value="automatic">Automatic</option>
          <option value="eu">EU</option>
          <option value="us-central">US Central</option>
        </select>
      </label>
      {pending && <div className="mt-1 text-text-muted">Changing region…</div>}
      {error && <div className="mt-1 max-w-52 text-red-300">{error}</div>}
    </div>
  );
}
