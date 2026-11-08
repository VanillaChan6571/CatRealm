import { useEffect, useMemo, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { createAuthenticatedApi } from '../../lib/authApi';
import { createApi } from '../../lib/api';
import { reportableSafetyArtifacts, type ReportableSafetyArtifact } from '../../lib/safetyReporting';
import type { MessageAttachment } from '../../types';
import { Modal } from '../ui/Modal';

type ReportReason = 'suspected_csam' | 'grooming_or_exploitation' | 'child_sexual_abuse' | 'other_child_safety';
const REASONS: Array<{ value: ReportReason; label: string }> = [
  { value: 'suspected_csam', label: 'Suspected child sexual abuse material' },
  { value: 'grooming_or_exploitation', label: 'Grooming or exploitation' },
  { value: 'child_sexual_abuse', label: 'Child sexual abuse' },
  { value: 'other_child_safety', label: 'Other child-safety concern' },
];

export type SafetyReportTarget = {
  scopeKind: 'dm' | 'group_dm' | 'realm';
  scopeId: string;
  messageId: string;
  senderLabel: string;
  messageText: string;
  attachments?: MessageAttachment[] | null;
};

export function SafetyReportModal({ target, onClose, onSubmitted, realm = false }: {
  target: SafetyReportTarget | null;
  onClose: () => void;
  onSubmitted: (messageId: string, artifactKey: string) => void | Promise<void>;
  realm?: boolean;
}) {
  const artifacts = useMemo(() => reportableSafetyArtifacts(target?.messageText ?? '', target?.attachments), [target]);
  const [artifact, setArtifact] = useState<ReportableSafetyArtifact | null>(null);
  const [reason, setReason] = useState<ReportReason>('suspected_csam');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setArtifact(artifacts[0] ?? null);
    setReason('suspected_csam');
    setDetails('');
    setError(null);
  }, [target?.messageId]);

  async function submit() {
    if (!target || !artifact || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await (realm ? createApi() : createAuthenticatedApi()).post('/api/safety/reports', {
        ...(realm ? { channelId: target.scopeId } : { scopeKind: target.scopeKind, scopeId: target.scopeId }),
        messageId: target.messageId,
        artifactKind: artifact.kind,
        artifactKey: artifact.key,
        reason,
        details: details.trim(),
        evidence: { ...artifact.evidence, selectedMessageText: target.messageText },
      });
      await onSubmitted(target.messageId, artifact.key);
      onClose();
    } catch (err: unknown) {
      const response = (err as { response?: { status?: number; data?: { error?: string } } })?.response;
      setError(realm && response?.status === 404
        ? 'This Realm does not support in-app safety reports yet. Contact its operator, or email safety@catrealm.app for a concern involving a Central account.'
        : response?.data?.error ?? 'Could not submit the report. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={Boolean(target)} onClose={onClose} title="Report image or link">
      <div className="space-y-4">
        <div className="flex gap-3 rounded border border-red-500/30 bg-red-500/10 p-3">
          <ShieldAlert className="h-5 w-5 shrink-0 text-red-400" />
          <p className="text-sm text-text-secondary">Reporting hides the selected item. CatRealm receives this selected message and artifact for safety review; other encrypted DM messages stay private.</p>
        </div>
        <p className="text-xs text-text-muted">Sent by {target?.senderLabel || 'this user'}</p>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-xs font-semibold text-text-muted">ITEM</legend>
          {artifacts.map((item) => <label key={item.key} className="flex cursor-pointer gap-2 rounded border border-border p-3 text-sm text-text-primary"><input type="radio" checked={artifact?.key === item.key} onChange={() => setArtifact(item)} /><span className="break-all">{item.label}</span></label>)}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-xs font-semibold text-text-muted">REASON</legend>
          {REASONS.map((item) => <label key={item.value} className="flex cursor-pointer gap-2 rounded border border-border p-3 text-sm text-text-primary"><input type="radio" checked={reason === item.value} onChange={() => setReason(item.value)} /><span>{item.label}</span></label>)}
        </fieldset>
        <textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={4000} rows={4} placeholder="Optional context for the safety reviewer" className="w-full rounded border border-border bg-bg-input p-3 text-sm text-text-primary" />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="button" onClick={() => void submit()} disabled={!artifact || submitting} className="w-full rounded bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{submitting ? 'Submitting…' : 'Submit safety report'}</button>
      </div>
    </Modal>
  );
}
