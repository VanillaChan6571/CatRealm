import { useState } from 'react';
import { LockClosedIcon, LockOpenIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import { usePersonalNotesStore } from '../../stores/personalNotesStore';
import { useAuthStore } from '../../stores/authStore';

interface NoteLockDialogProps {
  open: boolean;
  onClose: () => void;
  noteId: string;
  currentTitle: string;
  currentBody: string;
  currentLockType: 'pin' | '2fa' | null;
  /** Called after a successful lock change with the new PIN (if pin lock set) or null */
  onLockChanged?: (newPin: string | null) => void;
}

type LockOption = 'none' | 'pin' | '2fa';

export function NoteLockDialog({
  open,
  onClose,
  noteId,
  currentTitle,
  currentBody,
  currentLockType,
  onLockChanged,
}: NoteLockDialogProps) {
  const [selected, setSelected] = useState<LockOption>(currentLockType ?? 'none');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateNote = usePersonalNotesStore((s) => s.updateNote);
  const isCentral = useAuthStore((s) => s.user?.accountType === 'central');

  if (!open) return null;

  async function handleConfirm() {
    setError(null);

    if (selected === 'pin') {
      if (pin.length < 4) { setError('PIN must be at least 4 characters.'); return; }
      if (pin !== confirmPin) { setError('PINs do not match.'); return; }
    }

    setSaving(true);
    try {
      if (selected === 'none') {
        await updateNote(noteId, currentTitle, currentBody, { removeLock: true });
        onLockChanged?.(null);
      } else if (selected === 'pin') {
        await updateNote(noteId, currentTitle, currentBody, { pin });
        onLockChanged?.(pin);
      } else {
        await updateNote(noteId, currentTitle, currentBody, { use2fa: true });
        onLockChanged?.(null);
      }
      handleClose();
    } catch {
      setError('Failed to update note lock.');
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    setPin('');
    setConfirmPin('');
    setError(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-bg-primary border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4">
        <div className="p-6">
          <h2 className="text-base font-semibold text-text-primary mb-4">Note Lock Settings</h2>

          <div className="space-y-2 mb-4">
            {/* No lock */}
            <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              selected === 'none' ? 'border-accent bg-accent/10' : 'border-border hover:bg-bg-hover/50'
            }`}>
              <input
                type="radio"
                name="lockType"
                value="none"
                checked={selected === 'none'}
                onChange={() => setSelected('none')}
                className="accent-accent"
              />
              <LockOpenIcon className="w-4 h-4 text-text-secondary shrink-0" />
              <div>
                <div className="text-sm font-medium text-text-primary">No Lock</div>
                <div className="text-xs text-text-muted">Note opens without a code.</div>
              </div>
            </label>

            {/* PIN lock */}
            <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              selected === 'pin' ? 'border-accent bg-accent/10' : 'border-border hover:bg-bg-hover/50'
            }`}>
              <input
                type="radio"
                name="lockType"
                value="pin"
                checked={selected === 'pin'}
                onChange={() => setSelected('pin')}
                className="accent-accent"
              />
              <LockClosedIcon className="w-4 h-4 text-text-secondary shrink-0" />
              <div>
                <div className="text-sm font-medium text-text-primary">PIN Lock</div>
                <div className="text-xs text-text-muted">Encrypts the note with a PIN. If lost, the note is unrecoverable.</div>
              </div>
            </label>

            {/* 2FA lock (central accounts only) */}
            {isCentral && (
              <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                selected === '2fa' ? 'border-accent bg-accent/10' : 'border-border hover:bg-bg-hover/50'
              }`}>
                <input
                  type="radio"
                  name="lockType"
                  value="2fa"
                  checked={selected === '2fa'}
                  onChange={() => setSelected('2fa')}
                  className="accent-accent"
                />
                <ShieldCheckIcon className="w-4 h-4 text-text-secondary shrink-0" />
                <div>
                  <div className="text-sm font-medium text-text-primary">2FA Lock</div>
                  <div className="text-xs text-text-muted">Requires your authenticator code to open.</div>
                </div>
              </label>
            )}
          </div>

          {/* PIN input fields */}
          {selected === 'pin' && (
            <div className="space-y-2 mb-4">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">New PIN</label>
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => { setPin(e.target.value); setError(null); }}
                  placeholder="At least 4 characters"
                  className="w-full px-3 py-2 text-sm bg-bg-input border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Confirm PIN</label>
                <input
                  type="password"
                  value={confirmPin}
                  onChange={(e) => { setConfirmPin(e.target.value); setError(null); }}
                  placeholder="Repeat your PIN"
                  className="w-full px-3 py-2 text-sm bg-bg-input border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>
          )}

          {error && <p className="mb-3 text-xs text-danger">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-3 py-2 text-sm font-medium text-text-secondary bg-bg-hover rounded-lg hover:bg-bg-hover/80 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { void handleConfirm(); }}
              disabled={saving}
              className="flex-1 px-3 py-2 text-sm font-medium text-white bg-accent rounded-lg hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
