import type { AppLanguage } from '../../../stores/settingsStore';
import { useTranslation } from 'react-i18next';

type LanguageTabProps = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
};

const LANGUAGE_OPTIONS: Array<{
  id: AppLanguage;
  nativeLabel: string;
  translationKey:
    | 'settings.languageEnglish'
    | 'settings.languageSpanish'
    | 'settings.languageRussian'
    | 'settings.languageJapanese';
}> = [
  { id: 'en', nativeLabel: 'English', translationKey: 'settings.languageEnglish' },
  { id: 'es', nativeLabel: 'Español', translationKey: 'settings.languageSpanish' },
  { id: 'ru', nativeLabel: 'Русский', translationKey: 'settings.languageRussian' },
  { id: 'ja', nativeLabel: '日本語', translationKey: 'settings.languageJapanese' },
];

export function LanguageTab({ language, setLanguage }: LanguageTabProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6 max-w-2xl">
      <h3 className="text-xl font-bold text-text-primary">{t('settings.languageTitle')}</h3>

      <div className="space-y-4 bg-bg-hover/30 p-4 rounded-lg">
        <div>
          <p className="text-sm font-medium text-text-primary">{t('settings.languageDescription')}</p>
          <p className="text-xs text-text-muted mt-1">{t('settings.languageScope')}</p>
        </div>

        <div className="space-y-2">
          {LANGUAGE_OPTIONS.map((option) => (
            <label
              key={option.id}
              className="flex items-center gap-3 p-3 rounded border border-border cursor-pointer hover:bg-bg-hover/50 transition-colors"
            >
              <input
                type="radio"
                name="language"
                checked={language === option.id}
                onChange={() => setLanguage(option.id)}
                className="w-4 h-4"
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-text-primary">{option.nativeLabel}</p>
                <p className="text-xs text-text-muted">{t(option.translationKey)}</p>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
