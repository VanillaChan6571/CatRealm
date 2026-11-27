import { useState } from 'react';
import { getLegacyDMKeyDiagnostics, useDMVaultStatus, type LegacyDMKeyDiagnostics } from '../../lib/dmKeyVault';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

export function DMVaultNotice() {
  const reason = useDMVaultStatus((state) => state.reason);
  const issue = useDMVaultStatus((state) => state.issue);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<LegacyDMKeyDiagnostics | null>(null);

  if (!reason) return null;

  return (
    <>
      <div role="alert" className="bg-amber-500 text-black text-sm font-semibold px-3 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
        <span>{reason}</span>
        {issue === 'legacy' && (
          <button type="button" onClick={() => { setDiagnostics(getLegacyDMKeyDiagnostics()); setReviewOpen(true); }} className="rounded border border-black/50 px-2 py-1 text-xs font-bold hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">
            Review old keys
          </button>
        )}
      </div>
      <Modal open={reviewOpen && issue === 'legacy'} onClose={() => setReviewOpen(false)} title="Old DM key copies">
        <div className="space-y-3 text-sm text-text-secondary">
          {diagnostics && (
            <div role="status" className="rounded border border-border bg-bg-elevated px-3 py-2 text-text-primary">
              <p>Old-key storage entries on this installation: {diagnostics.entries} ({diagnostics.plausibleKeys} look like DM keys).</p>
              <p>Account marker: {diagnostics.accountMarker}. Device marker: {diagnostics.deviceMarker}. Saved session: {diagnostics.sessionMarker}.</p>
            </div>
          )}
          <p>Older CatRealm versions left plaintext DM key copies on this installation. Their account and device markers may have been added when signing out, so even matching markers cannot prove who wrote every key. CatRealm has kept these copies for reviewed recovery.</p>
          <p>Your device can be trusted and your current DMs can work normally while this warning is visible. Account &amp; Security does not resolve ownership of these old copies.</p>
          <p>If multiple accounts use this installation, check older DMs under each account. If a chat has locked messages, use its key recovery flow with a device or peer that still holds the key. Keep this app’s data until you have verified those messages are recoverable. CatRealm does not automatically move or delete these old copies.</p>
          <div className="flex justify-end pt-2">
            <Button variant="secondary" onClick={() => setReviewOpen(false)}>Close</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
