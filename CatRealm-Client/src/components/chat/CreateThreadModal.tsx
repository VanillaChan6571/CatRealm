import { useState } from 'react';
import { useThreadStore } from '../../stores/threadStore';
import type { Message } from '../../types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

const NAME_MAX = 100;
const MESSAGE_MAX = 2000;

function errorText(error: unknown) {
  const response = (error as { response?: { data?: { error?: unknown } } } | null)?.response;
  return typeof response?.data?.error === 'string' ? response.data.error : 'Failed to create thread';
}

function suggestedName(message: Message) {
  const firstLine = (message.content ?? '').split('\n')[0].trim();
  return firstLine ? firstLine.slice(0, 60) : '';
}

/**
 * Asks for a thread's name and opening message before it is created, so a thread always
 * starts with something in it. Opened by the "start thread" action on a message.
 */
export function CreateThreadModal() {
  const source = useThreadStore((s) => s.threadDraftSource);
  const cancel = useThreadStore((s) => s.cancelThreadDraft);
  if (!source) return null;
  // Keyed so each message starts with a fresh form.
  return <CreateThreadForm key={source.id} source={source} onClose={cancel} />;
}

function CreateThreadForm({ source, onClose }: { source: Message; onClose: () => void }) {
  const createThread = useThreadStore((s) => s.createThread);
  const [name, setName] = useState(() => suggestedName(source));
  const [firstMessage, setFirstMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const ready = name.trim().length >= 2 && firstMessage.trim().length > 0;

  const submit = async () => {
    if (!ready || saving) return;
    setSaving(true);
    try {
      await createThread(source.channel_id, source.id, name.trim(), firstMessage.trim());
      onClose();
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="🧶 Start a thread">
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="space-y-3">
        <div className="rounded-md border border-border bg-bg-chat/50 px-3 py-2 text-xs text-text-muted">
          <span className="font-semibold text-text-secondary">{source.display_name || source.username}</span>
          <p className="mt-0.5 line-clamp-2 break-words text-text-secondary">
            {source.content?.trim() || 'Attachment'}
          </p>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase text-text-secondary">Thread name</span>
          <input
            autoFocus
            value={name}
            maxLength={NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            placeholder="What is this thread about?"
            className="w-full rounded-md border border-border bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase text-text-secondary">First message</span>
          <textarea
            value={firstMessage}
            maxLength={MESSAGE_MAX}
            onChange={(event) => setFirstMessage(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void submit(); }}
            rows={4}
            placeholder="Start the conversation…  (Ctrl+Enter to create)"
            className="w-full resize-y rounded-md border border-border bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!ready || saving}>{saving ? 'Creating…' : 'Create thread'}</Button>
        </div>
      </form>
    </Modal>
  );
}
