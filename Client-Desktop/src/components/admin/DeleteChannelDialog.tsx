import { useState } from 'react';
import { useChannelStore } from '../../stores/channelStore';
import { useUIStore } from '../../stores/uiStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import type { Channel } from '../../types';

export function DeleteChannelDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData) as Channel | null;
  const closeModal = useUIStore((s) => s.closeModal);
  const deleteChannel = useChannelStore((s) => s.deleteChannel);
  const [loading, setLoading] = useState(false);

  if (!modalData) return null;

  const handleDelete = async () => {
    setLoading(true);
    try {
      await deleteChannel(modalData.id);
      closeModal();
    } catch {
      // error handled by store
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={activeModal === 'deleteChannel'} onClose={closeModal} title="Delete Channel">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Are you sure you want to delete <strong className="text-text-primary">#{modalData.name}</strong>?
          This will permanently delete all messages in this channel.
        </p>
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={closeModal}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete} disabled={loading}>
            {loading ? 'Deleting...' : 'Delete Channel'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
