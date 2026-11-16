import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { createApi } from '../../lib/api';
import { apiErrorMessage, useWorkItemStore, workItemBasePath, type WorkKind } from '../../stores/workItemStore';
import type { WorkItemLabel } from '../../types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { confirmAction } from './confirmAction';
import { LabelChip } from './shared';
import { WORK_ITEM_LIMITS, fieldClass } from './workItemUtils';

const PRESET_COLORS = ['#f23f42', '#f0883e', '#f5c542', '#23a559', '#1abc9c', '#3b9eff', '#7c5cff', '#eb459e', '#8b949e'];

interface Draft {
  id: string | null;
  name: string;
  color: string;
}

const NEW_LABEL: Draft = { id: null, name: '', color: PRESET_COLORS[0] };

/** Create, rename, recolour and delete a channel's labels. Managers only (the server enforces it). */
export function LabelManagerModal({ kind, channelId, labels, open, onClose }: {
  kind: WorkKind;
  channelId: string;
  labels: WorkItemLabel[];
  open: boolean;
  onClose: () => void;
}) {
  const fetchLabels = useWorkItemStore((s) => s.fetchLabels);
  const [draft, setDraft] = useState<Draft>(NEW_LABEL);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `${workItemBasePath(kind, channelId)}/labels`;
  const validColor = /^#[0-9a-f]{6}$/i.test(draft.color);

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    try {
      await action();
      await fetchLabels(kind, channelId);
      setDraft(NEW_LABEL);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const body = { name: draft.name.trim(), color: draft.color.toLowerCase() };
    if (!body.name || !validColor) return;
    void run(
      () => (draft.id ? createApi().patch(`${base}/${draft.id}`, body) : createApi().post(base, body)),
      'Failed to save label',
    );
  };

  const remove = async (label: WorkItemLabel) => {
    const confirmed = await confirmAction({
      title: 'Delete label',
      message: `Delete the label "${label.name}"? It is removed from everything that uses it.`,
    });
    if (confirmed) await run(() => createApi().delete(`${base}/${label.id}`), 'Failed to delete label');
  };

  return (
    <Modal open={open} onClose={onClose} title="Labels">
      <form
        onSubmit={(event) => { event.preventDefault(); save(); }}
        className="rounded-lg border border-border bg-bg-chat/40 p-3"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase text-text-secondary">{draft.id ? 'Edit label' : 'New label'}</span>
          {draft.name.trim() && validColor && <LabelChip label={{ id: 'preview', name: draft.name.trim(), color: draft.color }} />}
        </div>
        <div className="flex gap-2">
          <input
            value={draft.name}
            maxLength={WORK_ITEM_LIMITS.labelName}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="Label name"
            className={fieldClass}
          />
          <input
            value={draft.color}
            maxLength={7}
            onChange={(event) => setDraft({ ...draft, color: event.target.value })}
            className={`${fieldClass} w-24 font-mono`}
            aria-label="Hex colour"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setDraft({ ...draft, color })}
              className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${draft.color.toLowerCase() === color ? 'ring-2 ring-white/80 ring-offset-2 ring-offset-bg-elevated' : ''}`}
              style={{ backgroundColor: color }}
              aria-label={`Use ${color}`}
            />
          ))}
          <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-dashed border-border text-center text-xs leading-6 text-text-muted" title="Custom colour">
            +
            <input
              type="color"
              value={validColor ? draft.color : '#888888'}
              onChange={(event) => setDraft({ ...draft, color: event.target.value })}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <span className="ml-auto flex gap-2">
            {draft.id && <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(NEW_LABEL)}>Cancel</Button>}
            <Button type="submit" size="sm" disabled={busy || !draft.name.trim() || !validColor}>
              {draft.id ? 'Save' : 'Create label'}
            </Button>
          </span>
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </form>

      <div className="mt-3 divide-y divide-border/60">
        {labels.length === 0 && <p className="py-6 text-center text-sm text-text-muted">No labels yet. Create the first one above.</p>}
        {labels.map((label) => (
          <div key={label.id} className="flex items-center gap-2 py-2">
            <LabelChip label={label} />
            <span className="ml-auto flex gap-0.5">
              <button
                type="button"
                onClick={() => { setDraft({ id: label.id, name: label.name, color: label.color }); setError(''); }}
                className="rounded p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary"
                title="Edit label"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void remove(label)}
                className="rounded p-1.5 text-text-muted hover:bg-danger/15 hover:text-danger"
                title="Delete label"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
