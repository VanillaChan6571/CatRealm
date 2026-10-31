import { useState } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useServerStore } from '../../stores/serverStore';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { httpRealmGatewayApplies } from '../../lib/httpRealmGateway';

export function AddServerModal() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const open = activeModal === 'addServer';

  const addServer = useServerStore((s) => s.addServer);

  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bareIpPort = /^(?:(?:\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:]+\]):\d+$/i.test(url.trim());
  const willUseHttpGateway = httpRealmGatewayApplies()
    && (bareIpPort || /^http:\/\//i.test(url.trim()));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError(null);
    try {
      await addServer(bareIpPort && httpRealmGatewayApplies() ? `http://${url.trim()}` : url.trim());
      setUrl('');
      closeModal();
    } catch (err: unknown) {
      if (err instanceof Error) {
        // Check for specific error types
        if (willUseHttpGateway) {
          setError(err.message);
        } else if (err.message === 'Server your attempting to connect to is Decentralized Only, login/register directly with that server.') {
          setError(err.message);
        } else if (err.message.includes('Network Error') || err.message.includes('connect')) {
          const isSecureContext = typeof window !== 'undefined' && window.location.protocol === 'https:';
          setError(
            isSecureContext
              ? 'Could not connect to server. The server may not support HTTPS.'
              : 'Could not connect to server. Check the URL and try again.'
          );
        } else {
          setError(err.message);
        }
      } else {
        setError('Failed to add server');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setUrl('');
    setError(null);
    setLoading(false);
    closeModal();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Add Server">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-text-muted text-sm">
          Enter the URL of a CatRealm server to join it.
        </p>

        <Input
          label="Server URL"
          placeholder="https://example.com or localhost:3000"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) setError(null);
          }}
          autoFocus
        />

        {willUseHttpGateway && (
          <p className="text-xs text-warning">
            The gateway provides HTTPS to your browser, but traffic from the gateway to this realm uses unencrypted HTTP.
          </p>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={loading || !url.trim()}>
            {loading ? <Spinner size="sm" /> : 'Join Server'}
          </Button>
        </div>

        <div className="pt-3 border-t border-border space-y-2">
          <p className="text-xs text-text-secondary">
            If you need to create a server, we have a doc guide on how to create one:{' '}
            <a
              href="https://catrealm.app/docs/"
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              https://catrealm.app/docs/
            </a>
          </p>
          <p className="text-xs text-yellow-300">
            Currently NekoHosting is offering 100 free servers at{' '}
            <a
              href="https://nekohosting.gg/store/catrealm"
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              https://nekohosting.gg/store/catrealm
            </a>
            . Limited Stock, 1 Per Person.
          </p>
        </div>
      </form>
    </Modal>
  );
}
