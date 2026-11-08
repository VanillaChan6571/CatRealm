import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// macOS only: without Screen Recording access the source list is simply empty, so say why.
export function ScreenCapturePermissionNotice() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electron?.getScreenCaptureAccess?.()
      .then((access) => { if (!cancelled) setStatus(access.status); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!status || status === 'granted') return null;

  return (
    <div className="rounded border border-amber-400/40 bg-amber-400/10 p-3 space-y-2" role="alert">
      <p className="text-xs text-amber-100">{t('settingsContent.ssScreenPermissionNeeded')}</p>
      <button
        type="button"
        onClick={() => { void window.electron?.openScreenCaptureSettings?.(); }}
        className="rounded bg-bg-hover px-3 py-1.5 text-xs text-text-primary hover:bg-bg-input"
      >
        {t('settingsContent.ssScreenPermissionOpenSettings')}
      </button>
    </div>
  );
}
