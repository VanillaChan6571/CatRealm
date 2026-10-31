import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';

export function ClaimAdminBanner() {
  const { serverUrl, user, claimAdmin, loading, error, clearError } = useAuthStore();
  const [needsAdmin, setNeedsAdmin] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!serverUrl || user?.role === 'admin' || user?.role === 'owner' || user?.isOwner) return;
    axios.get(`${serverUrl}/api/auth/needs-admin`)
      .then((res) => setNeedsAdmin(res.data.needsAdmin))
      .catch(() => {});
  }, [serverUrl, user?.role]);

  if (!needsAdmin || user?.role === 'admin' || user?.role === 'owner' || user?.isOwner) return null;

  const handleClaim = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    claimAdmin(tokenInput.trim()).then(() => {
      const updatedUser = useAuthStore.getState().user;
      if (updatedUser?.role === 'owner' || updatedUser?.isOwner) {
        setNeedsAdmin(false);
      }
    });
  };

  return (
    <div className="bg-accent/10 border-b border-accent/30 px-4 py-2">
      {!expanded ? (
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-secondary">
            This server has no owner yet.
          </span>
          <Button size="sm" onClick={() => { setExpanded(true); clearError(); }}>
            Claim Owner
          </Button>
        </div>
      ) : (
        <form onSubmit={handleClaim} className="flex items-center gap-2">
          <Input
            placeholder="Paste owner setup token"
            value={tokenInput}
            onChange={(e) => { setTokenInput(e.target.value); if (error) clearError(); }}
            className="flex-1"
            autoFocus
          />
          <Button type="submit" size="sm" disabled={loading || !tokenInput.trim()}>
            {loading ? <Spinner size="sm" /> : 'Claim'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setExpanded(false); clearError(); }}>
            Cancel
          </Button>
          {error && <span className="text-xs text-danger">{error}</span>}
        </form>
      )}
    </div>
  );
}
