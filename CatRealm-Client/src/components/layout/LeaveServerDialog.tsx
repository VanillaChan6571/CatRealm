import { useState } from 'react';
import axios from 'axios';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useUIStore } from '../../stores/uiStore';
import { useServerStore } from '../../stores/serverStore';
import { useAuthStore } from '../../stores/authStore';
import { isServerOwnerToken } from '../../utils/serverOwnership';
import type { ServerEntry } from '../../stores/serverStore';

export function LeaveServerDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const modalData = useUIStore((s) => s.modalData) as ServerEntry | null;
  const removeServer = useServerStore((s) => s.removeServer);
  const accountType = useAuthStore((s) => s.user?.accountType);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (activeModal !== 'leaveServer' || !modalData) return null;

  const owner = isServerOwnerToken(modalData.token);

  const handleClose = () => {
    setLeaving(false);
    setError(null);
    closeModal();
  };

  const handleLeave = async () => {
    if (owner) {
      setError('The server owner cannot leave their own server.');
      return;
    }

    setLeaving(true);
    setError(null);

    // Central membership is authoritative on the realm. Keep the list entry
    // unless the realm confirms the leave so a rejection or network failure
    // cannot silently strand the user outside their own server list.
    if (accountType === 'central') {
      if (!modalData.token) {
        setError('Could not verify your membership with this server.');
        setLeaving(false);
        return;
      }

      try {
        await axios.post(`${modalData.url}/api/auth/leave`, null, {
          headers: { Authorization: `Bearer ${modalData.token}` },
          timeout: 5000,
        });
      } catch (leaveError) {
        const serverMessage = axios.isAxiosError(leaveError)
          ? leaveError.response?.data?.error
          : null;
        setError(
          typeof serverMessage === 'string' && serverMessage.trim()
            ? serverMessage
            : 'Could not leave this server. It has been kept in your server list.'
        );
        setLeaving(false);
        return;
      }
    }

    removeServer(modalData.url, 'user');
    handleClose();
  };

  return (
    <Modal
      open={activeModal === 'leaveServer'}
      onClose={() => { if (!leaving) handleClose(); }}
      title="Leave Server"
    >
      <div className="space-y-4 text-sm">
        <p className="text-text-secondary">
          Leave <span className="text-text-primary font-semibold">{modalData.name}</span>?
        </p>
        {owner && (
          <p className="text-warning">Server owners cannot leave their own server.</p>
        )}
        {error && (
          <p className="text-danger" role="alert">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={handleClose} disabled={leaving}>Cancel</Button>
          <Button variant="danger" onClick={() => void handleLeave()} disabled={owner || leaving}>
            {leaving ? 'Leaving...' : 'Leave'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
