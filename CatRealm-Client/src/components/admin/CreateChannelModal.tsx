import { useState } from 'react';
import { useChannelStore } from '../../stores/channelStore';
import { useUIStore } from '../../stores/uiStore';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { useTranslation } from 'react-i18next';

export function CreateChannelModal() {
  const { t } = useTranslation();
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const createChannel = useChannelStore((s) => s.createChannel);
  const categories = useChannelStore((s) => s.categories);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('basic');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [allowDisplayName, setAllowDisplayName] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError('');
    try {
      await createChannel(name.trim(), description.trim(), type, categoryId, allowDisplayName);
      setName('');
      setDescription('');
      setType('basic');
      setCategoryId(null);
      setAllowDisplayName(false);
      closeModal();
    } catch {
      setError('Failed to create channel');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={activeModal === 'createChannel'} onClose={closeModal} title="Create Channel">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Channel Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="new-channel"
          autoFocus
        />
        <Input
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's this channel about?"
        />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase text-text-secondary">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full rounded-md bg-bg-input border border-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="basic"># Basic (Text)</option>
            <option value="media">🖼 Media (Media Only)</option>
            <option value="voice">🔊 {t('channels.voice')}</option>
            <option value="announcement">📢 Announcement</option>
            <option value="forum">💬 Forum</option>
            <option value="theater">🎬 {t('channels.theater')}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase text-text-secondary">Category</label>
          <select
            value={categoryId ?? ''}
            onChange={(e) => setCategoryId(e.target.value || null)}
            className="w-full rounded-md bg-bg-input border border-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="">Uncategorized</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={allowDisplayName}
            onChange={(e) => setAllowDisplayName(e.target.checked)}
            className="h-4 w-4 rounded border-border bg-bg-input text-accent focus:ring-0"
          />
          Allow caps & spaces
        </label>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex gap-2 justify-end">
          <Button variant="secondary" type="button" onClick={closeModal}>Cancel</Button>
          <Button type="submit" disabled={loading || !name.trim()}>
            {loading ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
