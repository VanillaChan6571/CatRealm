import { useState } from 'react';
import type { FormEvent } from 'react';
import { Modal } from '../ui/Modal';
import { useThreadStore } from '../../stores/threadStore';

interface Props {
  channelId: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function NewForumPostModal({ channelId, open, onClose, onCreated }: Props) {
  const createForumPost = useThreadStore((s) => s.createForumPost);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setTitle('');
    setBody('');
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await createForumPost(channelId, title.trim(), body.trim());
      setTitle('');
      setBody('');
      onCreated();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create post');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="New Post">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Title</label>
          <input
            className="w-full bg-bg-input border border-border rounded px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent"
            placeholder="Post title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            required
            autoFocus
          />
          <div className="text-right text-xs text-text-muted mt-1">{title.length}/100</div>
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Content</label>
          <textarea
            className="w-full bg-bg-input border border-border rounded px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent resize-none"
            placeholder="Write your post..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={2000}
            rows={6}
            required
          />
          <div className="text-right text-xs text-text-muted mt-1">{body.length}/2000</div>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-sm rounded bg-bg-hover text-text-primary hover:bg-bg-elevated border border-border transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !title.trim() || !body.trim()}
            className="px-4 py-2 text-sm rounded bg-accent text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {loading ? 'Posting...' : 'Post'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
