import { useTranslation } from 'react-i18next';

type TimeFormatTabProps = {
  timeFormat: '12' | '24';
  setTimeFormat: (format: '12' | '24') => void;
};

export function TimeFormatTab(props: TimeFormatTabProps) {
  const { t } = useTranslation();
  const { timeFormat, setTimeFormat } = props;

  return (
    <div className="space-y-6 max-w-2xl">
      <h3 className="text-xl font-bold text-text-primary">{t('settings.navTimeFormat')}</h3>

      <div className="space-y-4 bg-bg-hover/30 p-4 rounded-lg">
        <p className="text-sm font-medium text-text-primary">{t('settingsContent.timeFormatDescription')}</p>

        <label className="flex items-center gap-3 p-3 rounded border border-border cursor-pointer hover:bg-bg-hover/50 transition-colors">
          <input
            type="radio"
            name="time-format"
            checked={timeFormat === '12'}
            onChange={() => setTimeFormat('12')}
            className="w-4 h-4"
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-text-primary">{t('settingsContent.twelveHourFormat')}</p>
            <p className="text-xs text-text-muted">{t('settingsContent.twelveHourExample')}</p>
          </div>
        </label>

        <label className="flex items-center gap-3 p-3 rounded border border-border cursor-pointer hover:bg-bg-hover/50 transition-colors">
          <input
            type="radio"
            name="time-format"
            checked={timeFormat === '24'}
            onChange={() => setTimeFormat('24')}
            className="w-4 h-4"
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-text-primary">{t('settingsContent.twentyFourHourFormat')}</p>
            <p className="text-xs text-text-muted">{t('settingsContent.twentyFourHourExample')}</p>
          </div>
        </label>
      </div>
    </div>
  );
}
