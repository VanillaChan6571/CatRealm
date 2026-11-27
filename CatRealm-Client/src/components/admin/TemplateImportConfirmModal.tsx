import { apiErrorMessage } from '../../lib/apiErrors';
import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { AlertTriangle } from 'lucide-react';

interface TemplateImportConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (verification: { token: string }) => void;
}

export function TemplateImportConfirmModal({
  open,
  onClose,
  onConfirm,
}: TemplateImportConfirmModalProps) {
  const [verificationToken, setVerificationToken] = useState('');
  const [generatingToken, setGeneratingToken] = useState(false);
  const [error, setError] = useState('');

  const handleGenerateToken = async () => {
    try {
      setGeneratingToken(true);
      setError('');

      const { api } = await import('../../lib/api');
      await api.post('/api/admin/generate-import-token');

      alert('Token generated! Check your server console for the verification token.');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to generate token'));
    } finally {
      setGeneratingToken(false);
    }
  };

  const handleConfirm = () => {
    if (!verificationToken.trim()) {
      setError('Please enter the verification token from your server console');
      return;
    }
    onConfirm({ token: verificationToken.trim() });
  };

  return (
    <Modal open={open} onClose={onClose} title="⚠️ Confirm Template Import">
      <div className="space-y-4">
        {/* Warning */}
        <div className="p-4 rounded-lg bg-red-900/20 border border-red-600/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-red-300 mb-2">
                Are you absolutely sure?
              </h3>
              <p className="text-sm text-red-200/90 mb-3">
                This action is <strong>DESTRUCTIVE</strong> and will permanently:
              </p>
              <ul className="text-sm text-red-200/90 space-y-1 list-disc list-inside">
                <li>Delete ALL current voice & text channels</li>
                <li>Delete ALL current categories</li>
                <li>Remove ALL roles (except default member role)</li>
                <li>Replace default member permissions from @everyone</li>
                <li>Rename your server</li>
                <li>Rebuild your server from the template</li>
              </ul>
              <p className="text-sm text-red-300 font-semibold mt-3">
                ⚠️ This cannot be undone! Make sure you have a backup if needed.
              </p>
            </div>
          </div>
        </div>

        {/* Verification */}
        <div className="p-4 rounded-lg bg-bg-elevated border border-border">
          <h4 className="text-sm font-semibold text-text-primary mb-3">
            Verification Required
          </h4>

          <div className="space-y-3">
              <p className="text-sm text-text-secondary">
                As the realm owner, generate a one-time verification token.
              </p>
              <Button
                onClick={handleGenerateToken}
                disabled={generatingToken}
                variant="secondary"
                className="w-full"
              >
                {generatingToken ? 'Generating...' : 'Generate Verification Token'}
              </Button>
              <Input
                label="Verification Token (from server console)"
                value={verificationToken}
                onChange={(e) => {
                  setVerificationToken(e.target.value.toUpperCase());
                  setError('');
                }}
                placeholder="32-character token"
                maxLength={32}
                className="font-mono text-center text-lg tracking-widest"
              />
              <p className="text-xs text-text-muted">
                The token is displayed in your server console and expires in 10 minutes.
              </p>
          </div>
        </div>

        {error && (
          <p className="text-sm text-danger">{error}</p>
        )}

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            className="bg-red-600 hover:bg-red-700"
          >
            I Understand, Proceed with Import
          </Button>
        </div>
      </div>
    </Modal>
  );
}
