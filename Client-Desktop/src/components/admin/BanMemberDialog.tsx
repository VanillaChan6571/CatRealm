import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useUIStore } from '../../stores/uiStore';
import { createApi } from '../../lib/api';

export function BanMemberDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData) as { userId: string; username: string } | null;
  const closeModal = useUIStore((s) => s.closeModal);
  const [reason, setReason] = useState('');
  const [banning, setBanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setReason('');
    setError(null);
    closeModal();
  };

  const handleBan = async () => {
    if (!modalData) return;
    setBanning(true);
    setError(null);
    try {
      await createApi().post(`/api/admin/users/${modalData.userId}/ban`, { reason: reason.trim() || undefined });
      handleClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to ban member.');
    } finally {
      setBanning(false);
    }
  };

  return (
    <Modal open={activeModal === 'banMember'} onClose={handleClose} title="Ban Member">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Permanently ban <span className="font-semibold text-text-primary">{modalData?.username}</span> from this server?
          They will not be able to rejoin.
        </p>
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-muted uppercase tracking-wide">Reason (optional)</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={256}
            placeholder="Enter a reason..."
            className="w-full bg-bg-input border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={handleClose} disabled={banning}>Cancel</Button>
          <Button variant="danger" onClick={handleBan} disabled={banning}>
            {banning ? 'Banning...' : 'Ban Member'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
