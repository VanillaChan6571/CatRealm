import { useState } from 'react';
import { useDMStore } from '../../stores/dmStore';

export function DMRequestActions({ otherUserId, declined = false }: { otherUserId: string; declined?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const respond = async (decision: 'accept' | 'decline') => {
    setBusy(true); setError(null);
    try { await useDMStore.getState().respondToRequest(otherUserId, decision); }
    catch { setError('Could not update this request. Please retry.'); }
    finally { setBusy(false); }
  };
  return <div className="p-3 border-t border-border space-y-2 text-sm">
    <p>{declined ? 'You declined this message request.' : 'Message request — accept to reply and allow notifications or calls.'}</p>
    <button disabled={busy} className="px-3 py-1 rounded bg-accent text-white disabled:opacity-50" onClick={() => void respond('accept')}>Accept</button>
    {!declined && <button disabled={busy} className="ml-2 px-3 py-1 rounded border border-border disabled:opacity-50" onClick={() => void respond('decline')}>Decline</button>}
    {error && <p role="alert" className="text-danger">{error}</p>}
  </div>;
}
