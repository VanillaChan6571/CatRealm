import { useEffect, useState } from 'react';
import { createAuthenticatedApi } from '../../lib/authApi';
import { Modal } from '../ui/Modal';

const REASONS = [
  ['grooming_or_exploitation', 'Grooming or exploitation'],
  ['child_sexual_abuse', 'Child sexual abuse'],
  ['other_child_safety', 'Other child-safety concern'],
] as const;

export function ProfileSafetyReportModal({ open, subjectUserId, subjectLabel, onClose }: { open: boolean; subjectUserId: string; subjectLabel: string; onClose: () => void }) {
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>('grooming_or_exploitation');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setReason('grooming_or_exploitation'); setDetails(''); setError(null); } }, [open]);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await createAuthenticatedApi().post('/api/safety/profile-reports', { subjectUserId, reason, details });
      onClose();
    } catch (err: any) { setError(err?.response?.data?.error || 'Could not submit this report.'); }
    finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title="Report profile for child safety"><div className="space-y-4"><p className="text-sm text-text-secondary">Report {subjectLabel}'s profile or account behavior. For a specific image or link, report it from the message instead.</p>{REASONS.map(([value, label]) => <label key={value} className="flex gap-2 rounded border border-border p-3 text-sm text-text-primary"><input type="radio" checked={reason === value} onChange={() => setReason(value)} />{label}</label>)}<textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={4000} rows={4} placeholder="Describe the concern without attaching or forwarding suspected CSAM" className="w-full rounded border border-border bg-bg-input p-3 text-sm text-text-primary"/>{error && <p className="text-sm text-danger">{error}</p>}<button disabled={busy} onClick={() => void submit()} className="w-full rounded bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Submitting…' : 'Submit profile report'}</button></div></Modal>;
}
