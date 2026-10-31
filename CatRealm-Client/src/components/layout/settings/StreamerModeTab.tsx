import { useTranslation } from 'react-i18next';

type StreamerModeTabProps = {
  streamerMode: boolean;
  setStreamerMode: (v: boolean) => void;
  streamerModeAutoDetect: boolean;
  setStreamerModeAutoDetect: (v: boolean) => void;
  streamerModeHidePI: boolean;
  setStreamerModeHidePI: (v: boolean) => void;
  streamerModeDisableSounds: boolean;
  setStreamerModeDisableSounds: (v: boolean) => void;
};

export function StreamerModeTab(props: StreamerModeTabProps) {
  const { t } = useTranslation();
  const {
    streamerMode,
    setStreamerMode,
    streamerModeAutoDetect,
    setStreamerModeAutoDetect,
    streamerModeHidePI,
    setStreamerModeHidePI,
    streamerModeDisableSounds,
    setStreamerModeDisableSounds,
  } = props;

  return (
    <div className="space-y-6 max-w-2xl">
      <h3 className="text-xl font-bold text-text-primary">{t('settings.navStreamerMode')}</h3>
      <p className="text-sm text-text-muted">
        {t('settingsContent.streamerModeDescription')}
      </p>

      <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
        <div>
          <p className="text-sm font-medium text-text-primary">{t('settingsContent.enableStreamerMode')}</p>
          <p className="text-xs text-text-muted">{t('settingsContent.enableStreamerModeDesc')}</p>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={streamerMode}
            onChange={(e) => setStreamerMode(e.target.checked)}
            className="sr-only"
          />
          <span
            className={`w-12 h-6 rounded-full transition-colors ${
              streamerMode ? 'bg-accent' : 'bg-bg-hover'
            } relative`}
          >
            <span
              className={`absolute top-1 ${streamerMode ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`}
            />
          </span>
        </label>
      </div>

      <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
        <div>
          <p className="text-sm font-medium text-text-primary">{t('settingsContent.autoEnableStreamingApps')}</p>
          <p className="text-xs text-text-muted">{t('settingsContent.autoEnableStreamingAppsDesc')}</p>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={streamerModeAutoDetect}
            onChange={(e) => setStreamerModeAutoDetect(e.target.checked)}
            className="sr-only"
          />
          <span
            className={`w-12 h-6 rounded-full transition-colors ${
              streamerModeAutoDetect ? 'bg-accent' : 'bg-bg-hover'
            } relative`}
          >
            <span
              className={`absolute top-1 ${streamerModeAutoDetect ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`}
            />
          </span>
        </label>
      </div>

      <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
        <div>
          <p className="text-sm font-medium text-text-primary">{t('settingsContent.hidePersonalInfo')}</p>
          <p className="text-xs text-text-muted">{t('settingsContent.hidePersonalInfoDesc')}</p>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={streamerModeHidePI}
            onChange={(e) => setStreamerModeHidePI(e.target.checked)}
            className="sr-only"
          />
          <span
            className={`w-12 h-6 rounded-full transition-colors ${
              streamerModeHidePI ? 'bg-accent' : 'bg-bg-hover'
            } relative`}
          >
            <span
              className={`absolute top-1 ${streamerModeHidePI ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`}
            />
          </span>
        </label>
      </div>

      <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
        <div>
          <p className="text-sm font-medium text-text-primary">{t('settingsContent.disableAllSounds')}</p>
          <p className="text-xs text-text-muted">{t('settingsContent.disableAllSoundsDesc')}</p>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={streamerModeDisableSounds}
            onChange={(e) => setStreamerModeDisableSounds(e.target.checked)}
            className="sr-only"
          />
          <span
            className={`w-12 h-6 rounded-full transition-colors ${
              streamerModeDisableSounds ? 'bg-accent' : 'bg-bg-hover'
            } relative`}
          >
            <span
              className={`absolute top-1 ${streamerModeDisableSounds ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`}
            />
          </span>
        </label>
      </div>
    </div>
  );
}
