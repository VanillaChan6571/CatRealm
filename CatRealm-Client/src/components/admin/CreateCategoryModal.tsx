import { useState } from 'react';
import { useChannelStore } from '../../stores/channelStore';
import { useUIStore } from '../../stores/uiStore';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

export function CreateCategoryModal() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const createCategory = useChannelStore((s) => s.createCategory);

  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) {
      setError('Category name required');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await createCategory(name.trim());
      setName('');
      closeModal();
    } catch {
      setError('Failed to create category');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={activeModal === 'createCategory'} onClose={closeModal} title="Create Category">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Category Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New category"
          autoFocus
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" type="button" onClick={closeModal}>Cancel</Button>
          <Button type="button" onClick={() => handleSubmit()} disabled={loading || !name.trim()}>
            {loading ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
