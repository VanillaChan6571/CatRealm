import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { MotionIntensity } from '../../../stores/settingsStore';
import { VoiceBackgroundSection } from './VoiceBackgroundSection';
import { MyReactiveAvatarSection } from './MyReactiveAvatarSection';

const MOTION_OPTIONS: { id: MotionIntensity; label: string; desc: string }[] = [
  { id: 'snappy', label: 'Snappy', desc: 'Quick and crisp — minimal movement, fastest response.' },
  { id: 'middle', label: 'Middle', desc: 'Balanced and smooth. The default.' },
  { id: 'lively', label: 'Lively', desc: 'Springy and playful — more bounce and personality.' },
];

type CustomTheme = {
  id: string;
  themeName: string;
  author: string;
  version: string;
};

type AppearanceTabProps = {
  theme: string;
  setTheme: (id: string) => void;
  motionIntensity: MotionIntensity;
  setMotionIntensity: (v: MotionIntensity) => void;
  heavyAnimationsEnabled: boolean;
  setHeavyAnimationsEnabled: (v: boolean) => void;
  customThemes: CustomTheme[];
  removeTheme: (id: string) => void;
  playGifAvatars: boolean;
  setPlayGifAvatars: (v: boolean) => void;
  showAvatarBackground: boolean;
  setShowAvatarBackground: (v: boolean) => void;
  enableImageThumbnailing: boolean;
  setEnableImageThumbnailing: (v: boolean) => void;
  disableEmbedAutoplay: boolean;
  setDisableEmbedAutoplay: (v: boolean) => void;
  importError: string | null;
  themeFileInputRef: RefObject<HTMLInputElement | null>;
  handleDownloadTemplate: () => void;
  handleImportTheme: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

export function AppearanceTab(props: AppearanceTabProps) {
  const { t } = useTranslation();
  const {
    theme,
    setTheme,
    motionIntensity,
    setMotionIntensity,
    heavyAnimationsEnabled,
    setHeavyAnimationsEnabled,
    customThemes,
    removeTheme,
    playGifAvatars,
    setPlayGifAvatars,
    showAvatarBackground,
    setShowAvatarBackground,
    enableImageThumbnailing,
    setEnableImageThumbnailing,
    disableEmbedAutoplay,
    setDisableEmbedAutoplay,
    importError,
    themeFileInputRef,
    handleDownloadTemplate,
    handleImportTheme,
  } = props;

  return (
    <div className="space-y-6 max-w-2xl">
      <h3 className="text-xl font-bold text-text-primary">{t('settings.navAppearance')}</h3>

      <div className="space-y-4 bg-bg-hover/30 p-4 rounded-lg">
        <p className="text-sm font-medium text-text-primary">{t('settingsContent.theme')}</p>
        <p className="text-xs text-text-muted mb-4">{t('settingsContent.themeDesc')}</p>

        <div className="space-y-2">
          <label className="flex items-center gap-3 p-3 rounded border border-border cursor-pointer hover:bg-bg-hover/50 transition-colors">
            <input
              type="radio"
              name="theme"
              checked={theme === 'dark-cat'}
              onChange={() => setTheme('dark-cat')}
              className="w-4 h-4"
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-text-primary">DarkCat</p>
              <p className="text-xs text-text-muted">{t('settingsContent.darkCatDesc')}</p>
            </div>
          </label>

          <label className="flex items-center gap-3 p-3 rounded border border-border cursor-pointer hover:bg-bg-hover/50 transition-colors">
            <input
              type="radio"
              name="theme"
              checked={theme === 'angel-cat'}
              onChange={() => setTheme('angel-cat')}
              className="w-4 h-4"
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-text-primary">AngelCat</p>
              <p className="text-xs text-text-muted">{t('settingsContent.angelCatDesc')}</p>
            </div>
          </label>

          <label className="flex items-center gap-3 p-3 rounded border border-border cursor-pointer hover:bg-bg-hover/50 transition-colors">
            <input
              type="radio"
              name="theme"
              checked={theme === 'midnight-cat'}
              onChange={() => setTheme('midnight-cat')}
              className="w-4 h-4"
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-text-primary">MidnightCat</p>
              <p className="text-xs text-text-muted">{t('settingsContent.midnightCatDesc')}</p>
            </div>
          </label>

          <label className="flex items-center gap-3 p-3 rounded border border-border cursor-pointer hover:bg-bg-hover/50 transition-colors">
            <input
              type="radio"
              name="theme"
              checked={theme === 'retro-discord'}
              onChange={() => setTheme('retro-discord')}
              className="w-4 h-4"
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-text-primary">RetroDiscord</p>
              <p className="text-xs text-text-muted">{t('settingsContent.retroDiscordDesc')}</p>
            </div>
          </label>

          {customThemes.map((ct) => (
            <label key={ct.id} className="flex items-center gap-3 p-3 rounded border border-border cursor-pointer hover:bg-bg-hover/50 transition-colors">
              <input
                type="radio"
                name="theme"
                checked={theme === ct.id}
                onChange={() => setTheme(ct.id)}
                className="w-4 h-4"
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-text-primary">{ct.themeName}</p>
                <p className="text-xs text-text-muted">{t('settingsContent.themeBy', { author: ct.author, version: ct.version })}</p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  removeTheme(ct.id);
                  if (theme === ct.id) setTheme('dark-cat');
                }}
                className="ml-2 text-text-muted hover:text-danger transition-colors text-lg leading-none"
                aria-label={t('settingsContent.removeTheme', { theme: ct.themeName })}
              >×</button>
            </label>
          ))}
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="px-3 py-2 rounded border border-border text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            {t('settingsContent.downloadThemeTemplate')}
          </button>
          <label className="px-3 py-2 rounded border border-border text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer">
            {t('settingsContent.importCustomTheme')}
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImportTheme}
              ref={themeFileInputRef}
            />
          </label>
        </div>
        {importError && <p className="text-xs text-danger mt-1">{importError}</p>}
      </div>

      <VoiceBackgroundSection />

      <MyReactiveAvatarSection />

      <div className="space-y-4 bg-bg-hover/30 p-4 rounded-lg">
        <p className="text-sm font-medium text-text-primary">Motion</p>
        <p className="text-xs text-text-muted mb-4">
          How lively the app's animations feel. Your system "reduce motion" setting is always respected.
        </p>
        <div className="space-y-2">
          {MOTION_OPTIONS.map((opt) => (
            <label
              key={opt.id}
              className="flex items-center gap-3 p-3 rounded border border-border cursor-pointer hover:bg-bg-hover/50 transition-colors"
            >
              <input
                type="radio"
                name="motion"
                checked={motionIntensity === opt.id}
                onChange={() => setMotionIntensity(opt.id)}
                className="w-4 h-4"
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-text-primary">{opt.label}</p>
                <p className="text-xs text-text-muted">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="bg-bg-hover/30 p-4 rounded-lg space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">Heavier animations</p>
            <p className="text-xs text-text-muted">Extra ambient effects — starfield, glow shimmers, drifting particles.</p>
          </div>
          <label className="inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={heavyAnimationsEnabled}
              onChange={(e) => setHeavyAnimationsEnabled(e.target.checked)}
              className="sr-only"
            />
            <span
              className={`w-12 h-6 rounded-full transition-colors ${
                heavyAnimationsEnabled ? 'bg-accent' : 'bg-bg-hover'
              } relative`}
            >
              <span
                className={`absolute top-1 ${heavyAnimationsEnabled ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`}
              />
            </span>
          </label>
        </div>
        <p className="text-xs text-warning flex items-start gap-1.5">
          <span aria-hidden="true">⚠</span>
          <span>May degrade performance on some hardware — lower frame rate and higher GPU/battery use.</span>
        </p>
      </div>

      <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
        <div>
          <p className="text-sm font-medium text-text-primary">{t('settingsContent.autoplayGifAvatars')}</p>
          <p className="text-xs text-text-muted">{t('settingsContent.autoplayGifAvatarsDesc')}</p>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={playGifAvatars}
            onChange={(e) => setPlayGifAvatars(e.target.checked)}
            className="sr-only"
          />
          <span
            className={`w-12 h-6 rounded-full transition-colors ${
              playGifAvatars ? 'bg-accent' : 'bg-bg-hover'
            } relative`}
          >
            <span
              className={`absolute top-1 ${playGifAvatars ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`}
            />
          </span>
        </label>
      </div>

      <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
        <div>
          <p className="text-sm font-medium text-text-primary">{t('settingsContent.accentAvatarBackground')}</p>
          <p className="text-xs text-text-muted">{t('settingsContent.accentAvatarBackgroundDesc')}</p>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={showAvatarBackground}
            onChange={(e) => setShowAvatarBackground(e.target.checked)}
            className="sr-only"
          />
          <span
            className={`w-12 h-6 rounded-full transition-colors ${
              showAvatarBackground ? 'bg-accent' : 'bg-bg-hover'
            } relative`}
          >
            <span
              className={`absolute top-1 ${showAvatarBackground ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`}
            />
          </span>
        </label>
      </div>

      <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
        <div>
          <p className="text-sm font-medium text-text-primary">{t('settingsContent.imageThumbnailing')}</p>
          <p className="text-xs text-text-muted">{t('settingsContent.imageThumbnailingDesc')}</p>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={enableImageThumbnailing}
            onChange={(e) => setEnableImageThumbnailing(e.target.checked)}
            className="sr-only"
          />
          <span
            className={`w-12 h-6 rounded-full transition-colors ${
              enableImageThumbnailing ? 'bg-accent' : 'bg-bg-hover'
            } relative`}
          >
            <span
              className={`absolute top-1 ${enableImageThumbnailing ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`}
            />
          </span>
        </label>
      </div>

      <div className="flex items-center justify-between bg-bg-hover/30 p-4 rounded-lg">
        <div>
          <p className="text-sm font-medium text-text-primary">{t('settingsContent.disableEmbedAutoplay')}</p>
          <p className="text-xs text-text-muted">{t('settingsContent.disableEmbedAutoplayDesc')}</p>
        </div>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={disableEmbedAutoplay}
            onChange={(e) => setDisableEmbedAutoplay(e.target.checked)}
            className="sr-only"
          />
          <span
            className={`w-12 h-6 rounded-full transition-colors ${
              disableEmbedAutoplay ? 'bg-accent' : 'bg-bg-hover'
            } relative`}
          >
            <span
              className={`absolute top-1 ${disableEmbedAutoplay ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`}
            />
          </span>
        </label>
      </div>
    </div>
  );
}
