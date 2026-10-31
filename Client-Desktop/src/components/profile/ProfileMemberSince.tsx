import type { Profile } from '../../types';

interface ProfileMemberSinceProps {
  profile: Profile;
  serverName?: string;
  activeServerUrl: string | null;
}

function formatDate(timestamp: number | undefined): string {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function ProfileMemberSince({ profile, serverName, activeServerUrl }: ProfileMemberSinceProps) {
  const hasCentralDate = profile.accountType === 'central' && profile.centralJoinDate;
  const hasServerDate = profile.serverJoinDate && activeServerUrl;
  const entries: Array<{ label: string; date: string }> = [];

  if (hasServerDate) {
    entries.push({
      label: serverName || 'This Server',
      date: formatDate(profile.serverJoinDate),
    });
  }
  if (hasCentralDate) {
    entries.push({
      label: 'CatRealm Central',
      date: formatDate(profile.centralJoinDate),
    });
  }

  const infractions = (profile.ongoingInfractions ?? []).filter(
    (infraction) => infraction && typeof infraction.expiresAt === 'number' && infraction.expiresAt * 1000 > Date.now(),
  );

  if (!entries.length && !infractions.length) {
    return null;
  }

  return (
    <div className="space-y-2">
      {entries.length > 0 && (
        <>
          <label className="text-xs text-text-muted font-semibold">Member Since</label>
          <div className="rounded border border-border bg-bg-input p-3">
            <div className="flex items-center gap-2 text-xs flex-wrap">
              {entries.map((entry, idx) => (
                <span key={`${entry.label}-${entry.date}`} className="inline-flex items-center gap-1.5">
                  {idx > 0 && <span className="text-text-muted">|</span>}
                  <span className="text-text-muted">{entry.label}</span>
                  <span className="text-text-primary font-medium">{entry.date}</span>
                </span>
              ))}
            </div>
          </div>
        </>
      )}
      {infractions.length > 0 && (
        <>
          <label className="text-xs text-yellow-400 font-semibold">Ongoing Infractions</label>
          <div className="rounded border border-yellow-500/50 bg-yellow-500/10 p-3 space-y-1">
            {infractions.map((infraction) => (
              <div key={`${infraction.type}-${infraction.expiresAt}`} className="flex items-center gap-2 text-xs flex-wrap">
                <span className="text-yellow-400 font-medium">({infraction.label || 'Limited Account'})</span>
                <span className="text-text-muted">expires {formatDate(infraction.expiresAt)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
