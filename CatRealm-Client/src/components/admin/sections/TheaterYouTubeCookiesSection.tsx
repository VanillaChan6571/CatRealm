import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cookie,
  Laptop,
  RefreshCw,
  Shield,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api';

type TheaterCookieStatus = {
  hasCookies: boolean;
  source: string | null;
  updatedAt: number | null;
  syncedByName: string | null;
  cookieCount: number;
  cookieFilePath: string;
  managedByServer: boolean;
};

type DesktopSessionStatus = {
  loggedIn: boolean;
  cookieCount: number;
};

function formatDate_raw(value: number | null) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleString();
  } catch {
    return null;
  }
}

export function TheaterYouTubeCookiesSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TheaterCookieStatus | null>(null);
  const [desktopStatus, setDesktopStatus] = useState<DesktopSessionStatus>({ loggedIn: false, cookieCount: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [manualCookieText, setManualCookieText] = useState('');
  const [authorizeModalOpen, setAuthorizeModalOpen] = useState(false);
  const [authorizeStep, setAuthorizeStep] = useState<'intro' | 'waiting' | 'syncing' | 'done'>('intro');
  const syncTriggeredRef = useRef(false);
  const isDesktopClient = typeof window !== 'undefined' && !!window.electron;

  const loadStatus = useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = !!opts?.quiet;
    if (!quiet) setLoading(true);
    if (quiet) setRefreshing(true);
    try {
      const desktopStatusPromise = window.electron?.theaterYouTubeCookieStatus
        ? window.electron.theaterYouTubeCookieStatus().catch(() => ({ loggedIn: false, cookieCount: 0 }))
        : Promise.resolve({ loggedIn: false, cookieCount: 0 });
      const [serverStatus, nextDesktopStatus] = await Promise.all([
        api.get('/api/admin/theater-youtube-cookies'),
        desktopStatusPromise,
      ]);
      setStatus(serverStatus);
      setDesktopStatus(nextDesktopStatus);
      if (!quiet) setError(null);
    } catch (err: any) {
      if (!quiet) {
        setError(err?.response?.data?.error || 'Failed to load Theater YouTube cookie status');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const syncDesktopSession = useCallback(async () => {
    if (!window.electron) return;
    setAuthorizeStep('syncing');
    setError(null);
    setSuccess(null);
    try {
      const exportResult = await window.electron.theaterYouTubeCookieExport();
      if (!exportResult.ok || !exportResult.cookieText) {
        throw new Error(exportResult.message || 'Failed to export the CatRealm YouTube session');
      }
      const serverStatus = await api.put('/api/admin/theater-youtube-cookies', {
        cookieText: exportResult.cookieText,
        source: 'desktop_session',
      });
      setStatus(serverStatus);
      setManualCookieText('');
      setSuccess(t('admin.cookiesSyncedCount', { count: exportResult.cookieCount ?? serverStatus.cookieCount ?? 0 }));
      setAuthorizeStep('done');
      setTimeout(() => {
        setAuthorizeModalOpen(false);
        setAuthorizeStep('intro');
      }, 1200);
    } catch (err: any) {
      syncTriggeredRef.current = false;
      setAuthorizeStep('waiting');
      setError(err?.response?.data?.error || err?.message || 'Failed to sync the desktop YouTube session');
    }
  }, []);

  useEffect(() => {
    if (!authorizeModalOpen || !window.electron) return;
    if (authorizeStep !== 'waiting') return;
    const interval = window.setInterval(() => {
      window.electron!.theaterYouTubeCookieStatus()
        .then((nextStatus) => {
          setDesktopStatus(nextStatus);
          if (nextStatus.loggedIn && !syncTriggeredRef.current) {
            syncTriggeredRef.current = true;
            void syncDesktopSession();
          }
        })
        .catch(() => {});
    }, 1500);
    return () => window.clearInterval(interval);
  }, [authorizeModalOpen, authorizeStep, syncDesktopSession]);

  const handleAuthorizeStart = useCallback(async () => {
    if (!window.electron) return;
    syncTriggeredRef.current = false;
    setAuthorizeStep('waiting');
    setError(null);
    setSuccess(null);
    const result = await window.electron.theaterYouTubeCookieOpen();
    if (!result.ok) {
      setAuthorizeStep('intro');
      setError(result.message || 'Failed to open the YouTube authorization window');
    }
  }, []);

  const handleManualImport = useCallback(async () => {
    if (!manualCookieText.trim()) {
      setError(t('admin.pasteNetscapeFirst'));
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const nextStatus = await api.put('/api/admin/theater-youtube-cookies', {
        cookieText: manualCookieText,
        source: 'manual_import',
      });
      setStatus(nextStatus);
      setManualCookieText('');
      setSuccess(t('admin.cookiesImportedCount', { count: nextStatus.cookieCount }));
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to import the cookie file');
    } finally {
      setSaving(false);
    }
  }, [manualCookieText]);

  const handleRevokeServerCookies = useCallback(async () => {
    if (!confirm(t('admin.revokeCookiesConfirm'))) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const nextStatus = await api.delete('/api/admin/theater-youtube-cookies');
      setStatus(nextStatus);
      setSuccess(t('admin.cookiesRevoked'));
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to remove the server-side cookie file');
    } finally {
      setSaving(false);
    }
  }, []);

  const handleClearDesktopSession = useCallback(async () => {
    if (!window.electron) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await window.electron.theaterYouTubeCookieClear();
      if (!result.ok) {
        throw new Error(result.message || 'Failed to clear the desktop YouTube session');
      }
      const nextStatus = await window.electron.theaterYouTubeCookieStatus();
      setDesktopStatus(nextStatus);
      setSuccess(t('admin.desktopSessionCleared'));
    } catch (err: any) {
      setError(err?.message || 'Failed to clear the desktop YouTube session');
    } finally {
      setSaving(false);
    }
  }, []);

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">{t('admin.loadingYTCookies')}</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-100 mb-2">{t('admin.theaterYTCookies')}</h2>
          <p className="text-gray-400">
            {t('admin.theaterYTDesc')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadStatus({ quiet: true })}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </button>
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <div className="space-y-1">
            <p className="font-semibold">{t('admin.ytBestEffort')}</p>
            <p>
              {t('admin.ytBestEffortDesc')}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          {success}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-5">
          <div className="mb-4 flex items-center gap-3">
            <Cookie className="h-5 w-5 text-blue-400" />
            <div>
              <h3 className="text-base font-semibold text-gray-100">{t('admin.serverCookieFile')}</h3>
              <p className="text-xs text-gray-400">{t('admin.serverCookieFileDesc')}</p>
            </div>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4 rounded-lg bg-gray-800/70 px-3 py-2">
              <span className="text-gray-400">{t('admin.statusLabel')}</span>
              <span className={status?.hasCookies ? 'text-emerald-300' : 'text-gray-300'}>
                {status?.hasCookies ? t('admin.cookieConfigured') : t('admin.cookieNotConfigured')}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg bg-gray-800/70 px-3 py-2">
              <span className="text-gray-400">{t('admin.sourceLabel')}</span>
              <span className="text-gray-200">{status?.source || t('admin.cookieNone')}</span>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg bg-gray-800/70 px-3 py-2">
              <span className="text-gray-400">{t('admin.cookieCount')}</span>
              <span className="text-gray-200">{status?.cookieCount ?? 0}</span>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg bg-gray-800/70 px-3 py-2">
              <span className="text-gray-400">{t('admin.lastSynced')}</span>
              <span className="text-gray-200">{formatDate_raw(status?.updatedAt ?? null) ?? t('admin.neverValue')}</span>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg bg-gray-800/70 px-3 py-2">
              <span className="text-gray-400">{t('admin.syncedBy')}</span>
              <span className="text-gray-200">{status?.syncedByName || t('admin.unknownLabel')}</span>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-gray-800 bg-black/20 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('admin.cookiePath')}</p>
            <p className="mt-1 break-all font-mono text-xs text-gray-300">{status?.cookieFilePath || 'Unavailable'}</p>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleRevokeServerCookies}
              disabled={saving || !status?.hasCookies}
              className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200 hover:bg-red-500/20 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {t('admin.revokeServerCookies')}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-5">
          <div className="mb-4 flex items-center gap-3">
            <Laptop className="h-5 w-5 text-fuchsia-400" />
            <div>
              <h3 className="text-base font-semibold text-gray-100">{t('admin.desktopAuthorization')}</h3>
              <p className="text-xs text-gray-400">{t('admin.desktopAuthDesc')}</p>
            </div>
          </div>

          {isDesktopClient ? (
            <>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4 rounded-lg bg-gray-800/70 px-3 py-2">
                  <span className="text-gray-400">{t('admin.desktopSession')}</span>
                  <span className={desktopStatus.loggedIn ? 'text-emerald-300' : 'text-gray-300'}>
                    {desktopStatus.loggedIn ? t('admin.desktopAuthorized') : t('admin.desktopNotAuthorized')}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg bg-gray-800/70 px-3 py-2">
                  <span className="text-gray-400">{t('admin.desktopCookieCount')}</span>
                  <span className="text-gray-200">{desktopStatus.cookieCount}</span>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setAuthorizeModalOpen(true);
                    setAuthorizeStep('intro');
                    setError(null);
                  }}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60"
                >
                  <Shield className="h-4 w-4" />
                  {t('admin.authorizeClone')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleClearDesktopSession()}
                  disabled={saving || (!desktopStatus.loggedIn && desktopStatus.cookieCount === 0)}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {t('admin.clearDesktopSession')}
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-gray-800 bg-gray-800/60 p-4 text-sm text-gray-300">
              {t('admin.desktopOnly')}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-5">
        <div className="mb-4 flex items-center gap-3">
          <Upload className="h-5 w-5 text-emerald-400" />
          <div>
            <h3 className="text-base font-semibold text-gray-100">{t('admin.manualImport')}</h3>
            <p className="text-xs text-gray-400">{t('admin.manualImportDesc')}</p>
          </div>
        </div>
        <textarea
          value={manualCookieText}
          onChange={(event) => setManualCookieText(event.target.value)}
          placeholder={`# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\t...`}
          className="min-h-[220px] w-full rounded-xl border border-gray-800 bg-gray-950 px-4 py-3 font-mono text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
          spellCheck={false}
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleManualImport()}
            disabled={saving || !manualCookieText.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            <Upload className="h-4 w-4" />
            {t('admin.importPastedCookies')}
          </button>
          <p className="text-xs text-gray-500">
            {t('admin.netscapeFormat')}
          </p>
        </div>
      </div>

      {authorizeModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-100">{t('admin.authorizeModalTitle')}</h3>
                <p className="text-sm text-gray-400">{t('admin.authorizeModalDesc')}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAuthorizeModalOpen(false);
                  setAuthorizeStep('intro');
                }}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                aria-label={t('common.close')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5 px-6 py-5">
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-100">
                {t('admin.ytFlowDesc')}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className={`rounded-xl border p-4 ${authorizeStep === 'intro' ? 'border-blue-500/40 bg-blue-500/10' : 'border-gray-800 bg-gray-900/60'}`}>
                  <p className="text-xs uppercase tracking-wide text-gray-500">{t('admin.step1Label')}</p>
                  <p className="mt-2 text-sm font-semibold text-gray-100">{t('admin.openAuthWindow')}</p>
                  <p className="mt-1 text-xs text-gray-400">{t('admin.openAuthWindowDesc')}</p>
                </div>
                <div className={`rounded-xl border p-4 ${authorizeStep === 'waiting' || authorizeStep === 'syncing' ? 'border-blue-500/40 bg-blue-500/10' : 'border-gray-800 bg-gray-900/60'}`}>
                  <p className="text-xs uppercase tracking-wide text-gray-500">{t('admin.step2Label')}</p>
                  <p className="mt-2 text-sm font-semibold text-gray-100">{t('admin.catRealmDetects')}</p>
                  <p className="mt-1 text-xs text-gray-400">{t('admin.catRealmDetectsDesc')}</p>
                </div>
                <div className={`rounded-xl border p-4 ${authorizeStep === 'done' ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-gray-800 bg-gray-900/60'}`}>
                  <p className="text-xs uppercase tracking-wide text-gray-500">{t('admin.step3Label')}</p>
                  <p className="mt-2 text-sm font-semibold text-gray-100">{t('admin.serverReceives')}</p>
                  <p className="mt-1 text-xs text-gray-400">{t('admin.serverReceivesDesc')}</p>
                </div>
              </div>

              {authorizeStep === 'waiting' && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                  {t('admin.waitingYTAuth')}
                </div>
              )}

              {authorizeStep === 'syncing' && (
                <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-100">
                  {t('admin.exportingSession')}
                </div>
              )}

              {authorizeStep === 'done' && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    {t('admin.cookiesSynced')}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-800 px-6 py-4">
              <p className="text-xs text-gray-500">
                {t('admin.privacyNote')}
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setAuthorizeModalOpen(false);
                    setAuthorizeStep('intro');
                  }}
                  className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-gray-200 hover:bg-gray-800"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleAuthorizeStart()}
                  disabled={authorizeStep === 'waiting' || authorizeStep === 'syncing'}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60"
                >
                  {t('admin.authorizeClone')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
