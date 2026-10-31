import { useState } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useMessageStore } from '../../stores/messageStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import type { Message } from '../../types';

export function DeleteBatchDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const modalData = useUIStore((s) => s.modalData) as Message[] | null;
  const requestDelete = useMessageStore((s) => s.requestDelete);
  const [isDeleting, setIsDeleting] = useState(false);

  if (activeModal !== 'deleteBatch' || !modalData || modalData.length === 0) return null;

  const count = modalData.length;

  const handleConfirm = () => {
    setIsDeleting(true);
    modalData.forEach((msg) => requestDelete(msg.id));
    setIsDeleting(false);
    closeModal();
  };

  return (
    <Modal open={activeModal === 'deleteBatch'} onClose={closeModal} title="Delete Media Batch">
      <div className="space-y-4 text-sm">
        <p className="text-text-secondary">
          Delete <strong className="text-text-primary">{count}</strong> media messages from this batch?
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={closeModal} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirm} disabled={isDeleting}>
            Delete
          </Button>
        </div>
      </div>
    </Modal>
  );
}
