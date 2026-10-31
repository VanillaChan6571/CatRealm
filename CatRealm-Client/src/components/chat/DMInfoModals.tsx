import { LockClosedIcon } from '@heroicons/react/24/outline';

type DMEncryptionInfoModalProps = {
  open: boolean;
  onClose: () => void;
  retentionDays: number;
};

type DMRetentionSettingsModalProps = {
  open: boolean;
  onClose: () => void;
  saving: boolean;
  retentionDays: number;
  otherUsername: string;
  onSelectRetentionDays: (days: number) => void;
};

function formatRetentionLabel(retentionDays: number): string {
  if (retentionDays === 7) return '7 days';
  if (retentionDays === 30) return '30 days';
  if (retentionDays === 90) return '90 days';
  if (retentionDays === 180) return '180 days';
  if (retentionDays === 365) return '1 year';
  if (retentionDays === 1825) return '5 years';
  return `${retentionDays} days`;
}

export function DMEncryptionInfoModal({ open, onClose, retentionDays }: DMEncryptionInfoModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-bg-elevated rounded-lg shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-border flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <LockClosedIcon className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-text-primary">Message Encryption</h2>
            <p className="text-sm text-text-muted">Your messages are protected</p>
          </div>
        </div>

        <div className="p-6 space-y-4 text-text-secondary">
          <div>
            <h3 className="font-semibold text-text-primary mb-2 flex items-center gap-2">
              <svg className="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              True End-to-End Encryption
            </h3>
            <p className="text-sm leading-relaxed">
              Messages are encrypted with <strong>AES-256-GCM</strong> entirely on your device before leaving it.
              Only the intended recipients can decrypt them — CatRealm's servers never see plaintext.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-text-primary mb-2 flex items-center gap-2">
              <svg className="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Device Key Exchange
            </h3>
            <p className="text-sm leading-relaxed">
              Each device holds a unique <strong>X25519</strong> key pair. When a conversation starts, a shared secret is
              generated and wrapped individually for every trusted device using an ephemeral Diffie-Hellman exchange — so
              only your devices can unwrap it.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-text-primary mb-2 flex items-center gap-2">
              <svg className="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Message Storage
            </h3>
            <p className="text-sm leading-relaxed">
              Ciphertext is stored on CatRealm servers solely for delivery to your other devices. Messages are automatically
              deleted after <strong>{formatRetentionLabel(retentionDays)}</strong> based on your conversation's retention setting.
            </p>
          </div>

          <div className="bg-emerald-900/50 rounded-lg p-4 border border-emerald-600/50">
            <p className="text-xs text-emerald-200 leading-relaxed">
              <strong className="text-emerald-200">Security note:</strong> The server stores only encrypted ciphertext and
              public key metadata. Your private keys never leave your device, so neither CatRealm nor anyone with server
              access can read your messages.
            </p>
          </div>
        </div>

        <div className="p-4 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export function DMRetentionSettingsModal({
  open,
  onClose,
  saving,
  retentionDays,
  otherUsername,
  onSelectRetentionDays,
}: DMRetentionSettingsModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-bg-elevated rounded-lg shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-border flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center">
            <svg className="w-6 h-6 text-accent" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-text-primary">Message Retention</h2>
            <p className="text-sm text-text-muted">Auto-delete old messages</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-text-secondary">
            Request to change retention for this conversation. Both users must agree to any changes.
          </p>

          <div className="space-y-2">
            {[
              { days: 7, label: '7 Days' },
              { days: 30, label: '30 Days' },
              { days: 90, label: '90 Days' },
              { days: 180, label: '180 Days' },
              { days: 365, label: '1 Year (Default)' },
              { days: 1825, label: '5 Years' },
            ].map(({ days, label }) => (
              <button
                key={days}
                onClick={() => onSelectRetentionDays(days)}
                disabled={saving}
                className={`w-full px-4 py-3 rounded-lg text-left transition-colors ${
                  retentionDays === days
                    ? 'bg-accent text-white'
                    : 'bg-bg-hover text-text-primary hover:bg-bg-input'
                } ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{label}</span>
                  {retentionDays === days && (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              </button>
            ))}
          </div>

          <div className="bg-blue-800/70 rounded-lg p-4 border border-blue-600/80">
            <p className="text-xs text-blue-100 leading-relaxed">
              <strong className="text-blue-100">Attachment Rules:</strong> Attachments follow your retention setting
              (7-180 days use exact period). For 1 year retention, attachments max out at 1 year. For 5 years, attachments
              over 25MB max at 6 months and under 25MB max at 1 year.
            </p>
          </div>

          <div className="bg-amber-800/70 rounded-lg p-4 border border-amber-600/80">
            <p className="text-xs text-amber-100 leading-relaxed">
              <strong className="text-amber-100">Note:</strong> Changing retention requires approval from {otherUsername}. They will see a request banner and must agree before the change takes effect.
            </p>
          </div>
        </div>

        <div className="p-4 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-bg-hover hover:bg-bg-input text-text-primary rounded-lg font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
