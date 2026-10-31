import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { ColorPicker } from '../admin/ColorPicker';
import type { ServerFolder } from '../../stores/serverStore';

interface ServerFolderSettingsModalProps {
  folder: ServerFolder;
  onApply: (name: string, color: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function ServerFolderSettingsModal({ folder, onApply, onDelete, onClose }: ServerFolderSettingsModalProps) {
  const [name, setName] = useState(folder.name);
  const [color, setColor] = useState(folder.color);

  function handleApply() {
    const trimmed = name.trim();
    if (trimmed) {
      onApply(trimmed, color);
    }
    onClose();
  }

  return (
    <Modal open={true} onClose={onClose} title="Server Folder Settings">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Folder Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }}
            className="bg-bg-input border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
            placeholder="Folder name"
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-secondary">Folder Color</label>
          <ColorPicker value={color} onChange={setColor} />
        </div>

        <div className="flex items-center justify-between pt-2">
          {onDelete ? (
            <button
              onClick={() => { onDelete(); onClose(); }}
              className="px-3 py-1.5 text-sm text-danger hover:bg-danger/10 rounded transition-colors"
            >
              Delete Folder
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover/50 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="px-4 py-1.5 text-sm bg-accent text-white rounded hover:bg-accent/90 transition-colors"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
