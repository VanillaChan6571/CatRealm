import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  THEATER_CAPTION_LANGUAGES,
  useSettingsStore,
  type TheaterCaptionsMode,
} from '../../../stores/settingsStore';

function languageName(code: string, uiLanguage: string): string {
  try {
    const name = new Intl.DisplayNames([uiLanguage, 'en'], { type: 'language' }).of(code);
    return name ? name.charAt(0).toLocaleUpperCase(uiLanguage) + name.slice(1) : code;
  } catch {
    return code;
  }
}

/** Theater YouTube captions: show automatically in a chosen language, or never. */
export function TheaterCaptionsSection() {
  const { t, i18n } = useTranslation();
  const mode = useSettingsStore((s) => s.theaterCaptionsMode);
  const language = useSettingsStore((s) => s.theaterCaptionsLanguage);
  const setMode = useSettingsStore((s) => s.setTheaterCaptionsMode);
  const setLanguage = useSettingsStore((s) => s.setTheaterCaptionsLanguage);
  const uiLanguage = i18n.resolvedLanguage || i18n.language || 'en';

  const languageOptions = useMemo(
    () => THEATER_CAPTION_LANGUAGES
      .map((code) => ({ code, name: languageName(code, uiLanguage) }))
      .sort((a, b) => a.name.localeCompare(b.name, uiLanguage)),
    [uiLanguage],
  );

  const modes: { value: TheaterCaptionsMode; label: string }[] = [
    { value: 'auto', label: t('settingsContent.theaterCaptionsAuto') },
    { value: 'off', label: t('settingsContent.theaterCaptionsOff') },
  ];

  return (
    <div className="space-y-3 bg-bg-hover/30 p-4 rounded-lg">
      <div>
        <p className="text-sm font-medium text-text-primary">{t('settingsContent.theaterCaptions')}</p>
        <p className="text-xs text-text-muted">{t('settingsContent.theaterCaptionsDesc')}</p>
      </div>
      <div className="space-y-2">
        {modes.map((option) => (
          <label
            key={option.value}
            className="flex items-center gap-3 p-3 rounded border border-border cursor-pointer hover:bg-bg-hover/50 transition-colors"
          >
            <input
              type="radio"
              name="theater-captions-mode"
              checked={mode === option.value}
              onChange={() => setMode(option.value)}
              className="w-4 h-4"
            />
            <span className="text-sm text-text-primary">{option.label}</span>
          </label>
        ))}
      </div>
      <label className="flex items-center justify-between gap-3">
        <span className={`text-sm ${mode === 'off' ? 'text-text-muted' : 'text-text-primary'}`}>
          {t('settingsContent.theaterCaptionsLanguage')}
        </span>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          disabled={mode === 'off'}
          className="rounded border border-border bg-bg-input px-2 py-1 text-sm text-text-primary disabled:opacity-50"
          data-debug-name="Theater Captions Language"
          data-debug-file="src/components/layout/settings/TheaterCaptionsSection.tsx"
        >
          {languageOptions.map((option) => (
            <option key={option.code} value={option.code}>{option.name}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
