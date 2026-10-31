import { useState } from 'react';
import { Modal } from '../ui/Modal';

interface VoiceAutoDeleteModalProps {
  open: boolean;
  onConfirm: (expiresAt: number | null) => void;
  onCancel: () => void;
}

const OPTIONS = [
  { label: '30 minutes', ms: 30 * 60 * 1000 },
  { label: '3 days', ms: 3 * 86400 * 1000 },
  { label: '7 days', ms: 7 * 86400 * 1000 },
  { label: '14 days', ms: 14 * 86400 * 1000 },
  { label: '30 days', ms: 30 * 86400 * 1000 },
  { label: "Don't Auto Delete", ms: null },
];

export function VoiceAutoDeleteModal({ open, onConfirm, onCancel }: VoiceAutoDeleteModalProps) {
  const [selected, setSelected] = useState<number | null>(null); // index into OPTIONS; null = last (no delete)

  const selectedIndex = selected ?? OPTIONS.length - 1;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Auto-Delete Voice Message"
      className="max-w-sm"
    >
      <div className="space-y-1">
        {OPTIONS.map((opt, i) => (
          <button
            key={opt.label}
            type="button"
            onClick={() => setSelected(i)}
            className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
              selectedIndex === i
                ? 'bg-accent text-white'
                : 'text-text-primary hover:bg-bg-hover'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-border">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded border border-border text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            const opt = OPTIONS[selectedIndex];
            onConfirm(opt.ms !== null ? Date.now() + opt.ms : null);
          }}
          className="px-3 py-1.5 rounded border border-accent bg-accent text-white text-sm hover:opacity-90"
        >
          Send
        </button>
      </div>
    </Modal>
  );
}
