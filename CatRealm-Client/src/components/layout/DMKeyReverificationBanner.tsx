import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useDMKeyHealthStore, syncKnownConversationKeys } from '../../messaging/crypto/dmKeyStore';
import { verifyCurrentDeviceForKeySharing } from '../../lib/verifyDeviceForKeySharing';
import { Button } from '../ui/Button';

export function DMKeyReverificationBanner() {
  const userId = useAuthStore((state) => state.user?.id);
  const accountId = useDMKeyHealthStore((state) => state.accountId);
  const waitingDeviceId = useDMKeyHealthStore((state) => state.reverifyForPasskeyApprovedDeviceId);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setVerified(false); setError(null); }, [userId, waitingDeviceId]);

  if (!userId || accountId !== userId || !waitingDeviceId) return null;

  const handleVerify = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (verified) {
        await syncKnownConversationKeys();
      } else {
        await verifyCurrentDeviceForKeySharing();
        setVerified(true);
        await syncKnownConversationKeys();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify this device. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="status" className="shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-4 py-3">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        <div className="min-w-[240px] flex-1">
          <p className="text-sm font-medium text-text-primary">
            {verified ? 'Device verified. DM key sync is still pending.' : 'Verify this device to sync DM keys'}
          </p>
          <p className="text-xs text-text-secondary">
            {verified
              ? 'Your passkey proof succeeded. Try syncing again if the other device is still waiting.'
              : 'You recently signed in on another device and trusted it with a passkey. This device holds your DM keys, but its passkey proof has expired. Verify it to share the keys.'}
          </p>
          {error && <p role="alert" className="mt-1 text-xs text-red-300">{error}</p>}
        </div>
        <Button size="sm" onClick={() => void handleVerify()} disabled={busy}>
          {busy ? (verified ? 'Syncing…' : 'Verifying…') : (verified ? 'Retry sync' : 'Verify')}
        </Button>
      </div>
    </div>
  );
}
