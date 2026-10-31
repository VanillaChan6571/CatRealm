import { useState } from 'react';
import { useChannelStore } from '../../stores/channelStore';
import { useUIStore } from '../../stores/uiStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import type { Category } from '../../types';

export function DeleteCategoryDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData) as Category | null;
  const closeModal = useUIStore((s) => s.closeModal);
  const deleteCategory = useChannelStore((s) => s.deleteCategory);
  const [loading, setLoading] = useState(false);

  if (!modalData) return null;

  const handleDelete = async () => {
    setLoading(true);
    try {
      await deleteCategory(modalData.id);
      closeModal();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={activeModal === 'deleteCategory'} onClose={closeModal} title="Delete Category">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Delete category <strong className="text-text-primary">{modalData.name}</strong>? Channels will be moved to Uncategorized.
        </p>
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={closeModal}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete} disabled={loading}>
            {loading ? 'Deleting...' : 'Delete Category'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
