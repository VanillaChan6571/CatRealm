import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../../stores/uiStore';
import { useAppTourStore } from '../../../lib/appTour';

// The startup/tray/link toggles work on every desktop platform; the firewall
// repair drives Windows Firewall (netsh) and is meaningless elsewhere.
const isWindowsPlatform = typeof navigator !== 'undefined' && /\bWindows\b/.test(navigator.userAgent);

type WindowsTabProps = {
  openOnStartup: boolean;
  setOpenOnStartup: (v: boolean) => void;
  minimizeToTray: boolean;
  setMinimizeToTray: (v: boolean) => void;
  openLinksInApp: boolean;
  setOpenLinksInApp: (v: boolean) => void;
};

export function WindowsTab(props: WindowsTabProps) {
  const { t } = useTranslation();
  const { openOnStartup, setOpenOnStartup, minimizeToTray, setMinimizeToTray, openLinksInApp, setOpenLinksInApp } = props;
  const closeModal = useUIStore((s) => s.closeModal);
  const [firewallFixBusy, setFirewallFixBusy] = useState(false);
  const [firewallFixStatus, setFirewallFixStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [firewallFixLog, setFirewallFixLog] = useState<ScreenshareFirewallRuleStatus[]>([]);

  useEffect(() => {
    const unsubscribe = window.electron?.onScreenshareFirewallRuleStatus?.((payload) => {
      setFirewallFixLog((previous) => [...previous.slice(-5), payload]);
    });
    return () => unsubscribe?.();
  }, []);

  const handleFirewallRuleFix = async () => {
    const fixScreenshareFirewallRule = window.electron?.fixScreenshareFirewallRule;
    if (!fixScreenshareFirewallRule) {
      setFirewallFixStatus({ type: 'error', message: t('settingsContent.streamFirewallRuleFixUnavailable') });
      return;
    }

    setFirewallFixBusy(true);
    setFirewallFixStatus(null);
    setFirewallFixLog([]);
    try {
      const result = await fixScreenshareFirewallRule();
      if (result.ok) {
        setFirewallFixStatus({ type: 'success', message: t('settingsContent.streamFirewallRuleFixSuccess') });
      } else {
        setFirewallFixStatus({ type: 'error', message: result.message || t('settingsContent.streamFirewallRuleFixFailed') });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('settingsContent.streamFirewallRuleFixFailed');
      setFirewallFixStatus({ type: 'error', message });
    } finally {
      setFirewallFixBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h3 className="text-xl font-bold text-text-primary">
        {isWindowsPlatform ? t('settings.navWindows') : t('settings.navDesktop')}
      </h3>

      <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
        <div>
          <p className="text-sm font-medium text-text-primary">{t('settingsContent.openStartup')}</p>
          <p className="text-xs text-text-muted">{t('settingsContent.openStartupDesc')}</p>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={openOnStartup}
            onChange={(e) => setOpenOnStartup(e.target.checked)}
            className="sr-only"
          />
          <span
            className={`w-12 h-6 rounded-full transition-colors ${
              openOnStartup ? 'bg-accent' : 'bg-bg-hover'
            } relative`}
          >
            <span
              className={`absolute top-1 ${openOnStartup ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`}
            />
          </span>
        </label>
      </div>

      <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
        <div>
          <p className="text-sm font-medium text-text-primary">{t('settingsContent.minimizeTray')}</p>
          <p className="text-xs text-text-muted">{t('settingsContent.minimizeTrayDesc')}</p>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={minimizeToTray}
            onChange={(e) => setMinimizeToTray(e.target.checked)}
            className="sr-only"
          />
          <span
            className={`w-12 h-6 rounded-full transition-colors ${
              minimizeToTray ? 'bg-accent' : 'bg-bg-hover'
            } relative`}
          >
            <span
              className={`absolute top-1 ${minimizeToTray ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`}
            />
          </span>
        </label>
      </div>
      <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
        <div>
          <p className="text-sm font-medium text-text-primary">{t('settingsContent.openLinksInApp')}</p>
          <p className="text-xs text-text-muted">{t('settingsContent.openLinksInAppDesc')}</p>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={openLinksInApp}
            onChange={(e) => setOpenLinksInApp(e.target.checked)}
            className="sr-only"
          />
          <span
            className={`w-12 h-6 rounded-full transition-colors ${
              openLinksInApp ? 'bg-accent' : 'bg-bg-hover'
            } relative`}
          >
            <span
              className={`absolute top-1 ${openLinksInApp ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`}
            />
          </span>
        </label>
      </div>

      {/* The tour walks the desktop layout, so it stays hidden at mobile widths. */}
      <div className="hidden md:flex items-center justify-between gap-4 bg-bg-hover/30 p-4 rounded-lg">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">{t('settingsContent.replayAppTour')}</p>
          <p className="text-xs text-text-muted">{t('settingsContent.replayAppTourDesc')}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            closeModal();
            useAppTourStore.getState().start();
          }}
          className="shrink-0 rounded bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:bg-accent-hover"
        >
          {t('settingsContent.replayAppTourButton')}
        </button>
      </div>

      {isWindowsPlatform && (
      <div className="flex items-start justify-between gap-4 bg-bg-hover/30 p-4 rounded-lg">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">{t('settingsContent.streamFirewallRuleFix')}</p>
          <p className="text-xs text-text-muted">{t('settingsContent.streamFirewallRuleFixDesc')}</p>
          {firewallFixStatus && (
            <p className={`mt-2 text-xs ${firewallFixStatus.type === 'success' ? 'text-success' : 'text-danger'}`}>
              {firewallFixStatus.message}
            </p>
          )}
          {firewallFixLog.length > 0 && (
            <div className="mt-3 space-y-1 rounded border border-border/70 bg-bg-input/40 p-2">
              {firewallFixLog.map((entry, index) => (
                <p
                  key={`${entry.at}-${index}`}
                  className={`break-words text-[11px] leading-snug ${
                    entry.level === 'success'
                      ? 'text-success'
                      : entry.level === 'error'
                        ? 'text-danger'
                        : 'text-text-muted'
                  }`}
                >
                  {entry.message}
                </p>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleFirewallRuleFix}
          disabled={firewallFixBusy}
          className="shrink-0 rounded bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {firewallFixBusy ? t('settingsContent.streamFirewallRuleFixing') : t('settingsContent.streamFirewallRuleFix')}
        </button>
      </div>
      )}
    </div>
  );
}
