import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useServerStore } from '../../stores/serverStore';
import { isServerOwnerToken } from '../../utils/serverOwnership';
import { httpRealmGatewayApplies, isHttpGatewayCandidateUrl, savedRealmHttpOrigin } from '../../lib/httpRealmGateway';
import { getSocket } from '../../lib/socket';

// Extract first letter from server name, skipping emojis
function getServerInitial(name: string): string {
  const cleaned = name.replace(/[\p{Emoji}\p{Emoji_Component}\s]/gu, '');
  if (cleaned.length > 0) {
    return cleaned.charAt(0).toUpperCase();
  }
  return Array.from(name)[0] || '?';
}

export function OfflineServersModal() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const servers = useServerStore((s) => s.servers);
  const serverStatus = useServerStore((s) => s.serverStatus);
  const removeServer = useServerStore((s) => s.removeServer);
  const reconnectThroughHttpGateway = useServerStore((s) => s.reconnectThroughHttpGateway);
  const isCentral = useAuthStore((s) => s.user?.accountType === 'central');
  const accountId = useAuthStore((s) => s.user?.id);
  const autoTryHttpRealmGateway = useSettingsStore((s) => s.autoTryHttpRealmGateway);
  const attempted = useRef(new Set<string>());
  const dismissed = useRef(new Set<string>());
  const lastAccountId = useRef<string | undefined>(undefined);
  const [gatewayBusyUrl, setGatewayBusyUrl] = useState<string | null>(null);
  const [gatewayError, setGatewayError] = useState<string | null>(null);

  const offlineServers = servers.filter((server) => {
    const status = serverStatus[server.url] ?? 'idle';
    return status === 'disconnected' && !getSocket(server.url)?.connected;
  });
  const mixedContentServers = offlineServers.filter((server) => isHttpGatewayCandidateUrl(server.url)
    && (server.url.startsWith('http://') || serverStatus[server.url] === 'disconnected'));
  const mixedContentKey = mixedContentServers.map((server) => server.url).sort().join('|');

  useEffect(() => {
    if (lastAccountId.current !== accountId) {
      attempted.current.clear();
      dismissed.current.clear();
      lastAccountId.current = accountId;
    }
    if (!isCentral || !httpRealmGatewayApplies() || !mixedContentKey) return;
    if (!autoTryHttpRealmGateway) {
      if (!activeModal && !dismissed.current.has(mixedContentKey)) {
        useUIStore.getState().openModal('offlineServers');
      }
      return;
    }
    const pending = mixedContentKey.split('|').filter((url) => !attempted.current.has(url));
    if (!pending.length) return;
    pending.forEach((url) => attempted.current.add(url));
    void (async () => {
      for (const url of pending) {
        if (!useSettingsStore.getState().autoTryHttpRealmGateway) break;
        try {
          await reconnectThroughHttpGateway(url);
        } catch {
          // The realm stays in the list for a manual retry and visible error.
        }
      }
    })();
  }, [accountId, activeModal, autoTryHttpRealmGateway, isCentral, mixedContentKey, reconnectThroughHttpGateway]);

  const handleClose = () => {
    if (mixedContentKey) dismissed.current.add(mixedContentKey);
    closeModal();
  };

  if (activeModal !== 'offlineServers') return null;

  const handleRemove = (serverUrl: string, serverName: string) => {
    if (!confirm(`Remove "${serverName}" from your server list? Because the server is offline, this will not change your membership.`)) {
      return;
    }
    removeServer(serverUrl, 'user');
  };

  const handleGatewayReconnect = async (serverUrl: string) => {
    setGatewayBusyUrl(serverUrl);
    setGatewayError(null);
    try {
      await reconnectThroughHttpGateway(serverUrl);
      closeModal();
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : 'Could not connect through the HTTP gateway.');
    } finally {
      setGatewayBusyUrl(null);
    }
  };

  const handleConnectMixedContent = async () => {
    setGatewayError(null);
    for (const server of mixedContentServers) {
      setGatewayBusyUrl(server.url);
      try {
        await reconnectThroughHttpGateway(server.url);
      } catch (error) {
        setGatewayError(error instanceof Error ? error.message : 'Could not connect through the HTTP gateway.');
        setGatewayBusyUrl(null);
        return;
      }
    }
    setGatewayBusyUrl(null);
    closeModal();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div
        className="bg-bg-elevated rounded-lg shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-danger/20 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-danger">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" stroke="white" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-text-primary">Servers needing attention</h2>
              <p className="text-sm text-text-secondary">
                Some servers could not connect when you logged in
              </p>
            </div>
          </div>
        </div>

        {/* Server list */}
        <div className="flex-1 overflow-y-auto p-4">
          {isCentral && !autoTryHttpRealmGateway && mixedContentServers.length > 0 && (
            <div className="mb-4 rounded-lg border border-warning bg-warning/15 p-4 text-sm text-text-primary">
              <p className="font-semibold text-warning">HTTP realms need your choice</p>
              <p className="mt-1">The following servers may not support SSL/HTTPS. Would you like to connect to them insecurely proxied by CatRealm Central and at your own risk?</p>
              <p className="mt-1 text-xs text-text-muted">Your browser connects to the gateway over HTTPS; the gateway connects to each realm over unencrypted HTTP.</p>
              <ul className="mt-2 list-disc pl-5">
                {mixedContentServers.map((server) => <li key={server.url}>{server.name}</li>)}
              </ul>
              <div className="mt-3 flex gap-2">
                <button onClick={() => void handleConnectMixedContent()} disabled={gatewayBusyUrl !== null} className="rounded bg-warning px-3 py-1.5 font-medium text-black disabled:opacity-50">Connect through gateway</button>
                <button onClick={handleClose} className="rounded px-3 py-1.5 text-text-secondary hover:bg-bg-hover">Not now</button>
              </div>
            </div>
          )}
          {gatewayError && <p className="mb-3 text-sm text-danger">{gatewayError}</p>}
          {offlineServers.length === 0 ? (
            <div className="text-center py-8 text-text-secondary">
              <p>No offline servers</p>
            </div>
          ) : (
            <div className="space-y-2">
              {offlineServers.map((server) => {
                const isOwner = isServerOwnerToken(server.token);
                const letter = getServerInitial(server.name);
                const canUseGateway = isCentral && httpRealmGatewayApplies()
                  && !!savedRealmHttpOrigin(server.url);

                return (
                  <div
                    key={server.url}
                    className="bg-bg-sidebar rounded-lg p-4 flex items-center gap-4 hover:bg-bg-hover transition-colors"
                  >
                    {/* Server icon */}
                    <div className="relative shrink-0">
                      <div className="w-12 h-12 rounded-xl bg-bg-elevated flex items-center justify-center text-lg font-bold text-text-secondary">
                        {server.icon ? (
                          <img src={server.icon} alt={server.name} className="w-full h-full rounded-xl object-cover" />
                        ) : (
                          letter
                        )}
                      </div>
                      <div className="absolute -top-1 -right-1 w-4 h-4 bg-danger text-white text-[10px] rounded-full flex items-center justify-center shadow">
                        !
                      </div>
                    </div>

                    {/* Server info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-text-primary truncate">{server.name}</h3>
                      <p className="text-sm text-text-secondary truncate">
                        {mixedContentServers.some((candidate) => candidate.url === server.url)
                          ? 'May need HTTP gateway' : 'Disconnected'}
                      </p>
                    </div>

                    {/* Removing an offline realm is list-only; owners must not
                        mistake this for leaving their own server. */}
                    {canUseGateway && (
                      <button
                        onClick={() => void handleGatewayReconnect(server.url)}
                        disabled={gatewayBusyUrl !== null}
                        title="Connect through HTTPS; the gateway-to-realm connection still uses HTTP"
                        className="px-3 py-1.5 bg-accent text-white rounded text-sm font-medium shrink-0 disabled:opacity-50"
                      >
                        {gatewayBusyUrl === server.url ? 'Connecting...' : 'Use gateway'}
                      </button>
                    )}
                    <button
                      onClick={() => handleRemove(server.url, server.name)}
                      disabled={isOwner}
                      title={isOwner ? 'Server owners cannot leave their own server' : 'Remove from server list'}
                      className="px-3 py-1.5 bg-danger/10 hover:bg-danger hover:text-white text-danger rounded text-sm font-medium transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-danger/10 disabled:hover:text-danger"
                    >
                      {isOwner ? 'Owner' : 'Remove'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={handleClose}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
