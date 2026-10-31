import { useMemo } from 'react';
import type { Message } from '../../types';
import { useMessageStore } from '../../stores/messageStore';
import { useUIStore } from '../../stores/uiStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

const MAX_SNIPPET = 140;

function getSnippet(content?: string | null) {
  const trimmed = (content ?? '').trim().replace(/\s+/g, ' ');
  if (trimmed.length <= MAX_SNIPPET) return trimmed || '(empty message)';
  return `${trimmed.slice(0, MAX_SNIPPET)}…`;
}

export function DeleteMessageDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData) as Message | null;
  const closeModal = useUIStore((s) => s.closeModal);
  const requestDelete = useMessageStore((s) => s.requestDelete);

  const snippet = useMemo(() => {
    if (!modalData) return '';
    return getSnippet(modalData.content);
  }, [modalData]);

  if (!modalData) return null;

  const handleDelete = () => {
    requestDelete(modalData.id);
    closeModal();
  };

  return (
    <Modal open={activeModal === 'deleteMessage'} onClose={closeModal} title="Delete Message">
      <div className="space-y-4">
        <div className="text-sm text-text-secondary space-y-2">
          <p>Are you sure you want to delete this message?</p>
          <div className="rounded border border-border bg-bg-input px-3 py-2 text-text-primary">
            <p className="text-xs text-text-muted mb-1">
              {modalData.username} #{modalData.id?.slice?.(0, 6) ?? '------'}
            </p>
            <p className="text-sm break-words whitespace-pre-wrap">{snippet}</p>
          </div>
          <p className="text-xs text-text-muted">This action cannot be undone.</p>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={closeModal}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete}>Delete Message</Button>
        </div>
      </div>
    </Modal>
  );
}
