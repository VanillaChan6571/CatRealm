import { useState } from 'react';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import { usePersonalNotesStore, type PersonalNoteContent } from '../../stores/personalNotesStore';

interface NoteUnlockDialogProps {
  open: boolean;
  onClose: () => void;
  noteId: string;
  lockType: 'pin' | '2fa';
  onUnlocked: (content: PersonalNoteContent, pin?: string) => void;
}

export function NoteUnlockDialog({ open, onClose, noteId, lockType, onUnlocked }: NoteUnlockDialogProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loadNoteContent = usePersonalNotesStore((s) => s.loadNoteContent);

  if (!open) return null;

  const isPIN = lockType === 'pin';
  const label = isPIN ? 'PIN' : '2FA Code';
  const placeholder = isPIN ? 'Enter your PIN' : 'Enter 6-digit code';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const content = await loadNoteContent(noteId, isPIN ? { pin: code } : { totpCode: code });
      if (content) {
        onUnlocked(content, isPIN ? code : undefined);
        setCode('');
      } else {
        setError(isPIN ? 'Incorrect PIN' : 'Invalid code — try again.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to unlock note';
      setError(msg === 'Incorrect PIN' ? 'Incorrect PIN' : isPIN ? 'Incorrect PIN' : 'Invalid or expired code.');
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setCode('');
    setError(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-bg-primary border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
              <LockClosedIcon className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-text-primary">Unlock Note</h2>
              <p className="text-xs text-text-muted">This note is protected by a {label}.</p>
            </div>
          </div>

          <form onSubmit={(e) => { void handleSubmit(e); }}>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">{label}</label>
            <input
              type={isPIN ? 'password' : 'text'}
              value={code}
              onChange={(e) => { setCode(e.target.value); setError(null); }}
              placeholder={placeholder}
              inputMode={isPIN ? undefined : 'numeric'}
              maxLength={isPIN ? 64 : 6}
              autoFocus
              className="w-full px-3 py-2 text-sm bg-bg-input border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {error && (
              <p className="mt-2 text-xs text-danger">{error}</p>
            )}
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 px-3 py-2 text-sm font-medium text-text-secondary bg-bg-hover rounded-lg hover:bg-bg-hover/80 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !code.trim()}
                className="flex-1 px-3 py-2 text-sm font-medium text-white bg-accent rounded-lg hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Unlocking…' : 'Unlock'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
