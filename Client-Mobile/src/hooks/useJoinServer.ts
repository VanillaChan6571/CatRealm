import { useCallback, useState } from 'react';
import { useServerStore } from '@/stores/serverStore';
import { acceptInvite } from '@/lib/serverDirectory';
import { useOpenServer } from './useOpenServer';

/**
 * Join a realm (accepting its invite first when there is one, as desktop
 * does), add it to the synced list, then open it.
 */
export function useJoinServer() {
  const openServer = useOpenServer();
  const [joiningKey, setJoiningKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const join = useCallback(async ({ serverUrl, inviteCode }: { serverUrl?: string; inviteCode?: string | null }) => {
    const key = inviteCode ?? serverUrl ?? '';
    setJoiningKey(key);
    setError(null);
    try {
      const url = inviteCode ? await acceptInvite(inviteCode, serverUrl) : serverUrl;
      if (!url) throw new Error('Enter a server address.');
      const serverId = await useServerStore.getState().addServer(url, { inviteCode });
      const server = useServerStore.getState().byId(serverId);
      if (server) await openServer(server);
      return true;
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to join this server.');
      return false;
    } finally {
      setJoiningKey(null);
    }
  }, [openServer]);

  return { join, joiningKey, error, clearError: () => setError(null) };
}
