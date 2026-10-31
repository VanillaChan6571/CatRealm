import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { playNotificationSound, getSoundCandidates, type SoundType } from '../../../lib/notificationSounds';

type SoundToggleProps = {
  label: string;
  settingKey: string;
  settings: any;
  setSoundSetting: (key: string, value: boolean) => void;
  setSoundVolume: (key: string, value: number) => void;
  soundType: SoundType;
};

export function SoundToggle({
  label,
  settingKey,
  settings,
  setSoundSetting,
  setSoundVolume,
  soundType,
}: SoundToggleProps) {
  const { t } = useTranslation();
  const isEnabled = settings[settingKey] as boolean;
  const volume = (settings.soundVolumes?.[settingKey] ?? 60) as number;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopTimerRef = useRef<number | null>(null);

  const stopPreviewAudio = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audioRef.current = null;
  }, []);

  const startLoopingPreview = useCallback((durationMs?: number) => {
    if (typeof window === 'undefined') return;
    stopPreviewAudio();
    const candidates = getSoundCandidates(soundType);
    const soundFile = candidates[0];
    if (!soundFile) return;
    const audio = new Audio(soundFile);
    audio.volume = Math.max(0, Math.min(1, volume / 100));
    audio.loop = true;
    audioRef.current = audio;
    audio.play().catch(() => {
      if (audioRef.current === audio) {
        stopPreviewAudio();
      }
    });
    if (durationMs) {
      stopTimerRef.current = window.setTimeout(stopPreviewAudio, durationMs);
    }
  }, [soundType, stopPreviewAudio, volume]);

  useEffect(() => stopPreviewAudio, [stopPreviewAudio]);

  const handleSliderStart = () => {
    startLoopingPreview();
  };

  const handleSliderChange = (newVolume: number) => {
    setSoundVolume(settingKey, newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume / 100;
    }
  };

  const handleSliderEnd = () => {
    stopPreviewAudio();
  };

  const handlePreview = () => {
    if (soundType === 'ambience') {
      startLoopingPreview(5000);
      return;
    }
    playNotificationSound(soundType, volume);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => setSoundSetting(settingKey, e.target.checked)}
            className="sr-only"
          />
          <span
            className={`w-10 h-5 rounded-full transition-colors ${
              isEnabled ? 'bg-accent' : 'bg-bg-hover'
            } relative`}
          >
            <span
              className={`absolute top-0.5 ${isEnabled ? 'left-5' : 'left-0.5'} w-4 h-4 rounded-full bg-white transition-all`}
            />
          </span>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handlePreview}
          className="text-xs text-accent hover:text-accent/80 whitespace-nowrap"
        >
          {t('settingsContent.previewSound')}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(e) => handleSliderChange(Number(e.target.value))}
          onMouseDown={handleSliderStart}
          onMouseUp={handleSliderEnd}
          onMouseLeave={handleSliderEnd}
          onTouchStart={handleSliderStart}
          onTouchEnd={handleSliderEnd}
          onTouchCancel={handleSliderEnd}
          className="flex-1"
        />
        <span className="text-xs text-text-muted whitespace-nowrap">{t('settingsContent.volume', { volume })}</span>
      </div>
    </div>
  );
}
