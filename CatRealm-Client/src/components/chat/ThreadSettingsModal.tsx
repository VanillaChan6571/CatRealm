import { useEffect, useState } from 'react';
import { createApi } from '../../lib/api';
import { AutoHideField, SlowmodeField } from '../admin/PolicyFields';
import { formatMinutes, formatSeconds, policyErrorText, type ThreadPolicy } from '../admin/policyOptions';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import type { Thread } from '../../types';

/**
 * Settings for one thread: its own slowmode and auto-hide time, or "use the channel's".
 * Staff (Manage Posts) only; the realm server enforces that.
 */
export function ThreadSettingsModal({ thread, onClose }: { thread: Thread; onClose: () => void }) {
  const [policy, setPolicy] = useState<ThreadPolicy | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    createApi().get<ThreadPolicy>(`/api/policy/threads/${thread.id}`)
      .then((res) => { if (!cancelled) setPolicy(res.data); })
      .catch((err) => { if (!cancelled) setError(policyErrorText(err, 'Failed to load thread settings. The realm server may need updating.')); });
    return () => { cancelled = true; };
  }, [thread.id]);

  return (
    <Modal open onClose={onClose} title={`🧶 ${thread.name}`}>
      {policy
        ? <ThreadSettingsForm thread={thread} policy={policy} onClose={onClose} />
        : <p className={`py-6 text-center text-sm ${error ? 'text-danger' : 'text-text-muted'}`}>{error || 'Loading thread settings…'}</p>}
    </Modal>
  );
}

function ThreadSettingsForm({ thread, policy, onClose }: { thread: Thread; policy: ThreadPolicy; onClose: () => void }) {
  const [slowmode, setSlowmode] = useState<number | null>(policy.own.slowmode);
  const [autoHide, setAutoHide] = useState<number | null>(policy.own.autoHideMinutes);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await createApi().patch(`/api/policy/threads/${thread.id}`, { slowmode, autoHideMinutes: autoHide });
      onClose();
    } catch (err) {
      setError(policyErrorText(err, 'Failed to save thread settings'));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold uppercase text-text-secondary">Slowmode</label>
        <SlowmodeField
          value={slowmode}
          presets={[{ value: null, label: `Use the channel's thread setting (${formatSeconds(policy.channel.slowmode)})` }]}
          onChange={setSlowmode}
        />
        <div className="text-xs text-text-muted">How long a member waits between their own messages in this thread.</div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold uppercase text-text-secondary">Auto hide after</label>
        <AutoHideField
          value={autoHide}
          presets={[{ value: null, label: `Use the channel's thread setting (${formatMinutes(policy.channel.autoHideMinutes)})` }]}
          onChange={setAutoHide}
        />
        <div className="text-xs text-text-muted">
          With no new messages for this long, the thread leaves the channel&apos;s list until someone writes in it again.
        </div>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  );
}
