import { useEffect, useState } from 'react';
import { detectPrivateBrowsing } from '../../lib/privateBrowsing';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../ui/Button';

export function PrivateBrowsingBanner() {
  const isCentral = useAuthStore((state) => state.user?.accountType === 'central');
  const [isPrivate, setIsPrivate] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isCentral) return;
    let active = true;
    void detectPrivateBrowsing().then((result) => { if (active) setIsPrivate(result); });
    return () => { active = false; };
  }, [isCentral]);

  if (!isCentral || !isPrivate || dismissed) return null;

  return (
    <div role="status" className="shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-4 py-3">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        <div className="min-w-[240px] flex-1">
          <p className="text-sm font-medium text-text-primary">You're in a private window</p>
          <p className="text-xs text-text-secondary">This device's encryption keys are deleted when the window closes, so DMs sent to it can't be read later. Use a normal window or the desktop app to keep this device.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>Got it</Button>
      </div>
    </div>
  );
}
