import { useServerStore } from '../../stores/serverStore';
import { useUIStore } from '../../stores/uiStore';
import { Button } from '../ui/Button';

export function RealmTrustWarningBanner() {
  const servers = useServerStore((state) => state.servers);
  const verifyRealmTrust = useServerStore((state) => state.verifyRealmTrust);
  const removeServer = useServerStore((state) => state.removeServer);
  const promptUrl = useUIStore((state) => state.realmTrustPromptUrl);
  const setPromptUrl = useUIStore((state) => state.setRealmTrustPromptUrl);
  const server = servers.find((entry) => entry.url === promptUrl)
    ?? servers.find((entry) => entry.realmTrust?.state === 'changed');
  if (!server || server.realmTrust?.state !== 'changed') return null;

  return (
    <div className="border-b border-warning/40 bg-warning/10 px-4 py-3">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        <div className="min-w-[240px] flex-1">
          <p className="text-sm font-medium text-text-primary">This Realm has changed</p>
          <p className="text-xs text-text-secondary">
            {server.name} is presenting a new identity. It may have been reset or replaced. Re-approve before using it again.
          </p>
        </div>
        <Button size="sm" onClick={() => { void verifyRealmTrust(server.url, true); setPromptUrl(null); }}>
          Review &amp; Re-approve
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { removeServer(server.url, 'user'); setPromptUrl(null); }}>
          Remove Realm
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPromptUrl(null)}>
          Not now
        </Button>
      </div>
    </div>
  );
}
