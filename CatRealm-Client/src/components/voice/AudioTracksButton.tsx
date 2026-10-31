import { useTranslation } from 'react-i18next';
import { FlaskConical } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';

/**
 * Cat Lab — opens the per-person audio tracks mixer. Self-gating: renders
 * nothing unless the experiment is enabled, so call surfaces can include it
 * unconditionally.
 */
export function AudioTracksButton({ className = 'rounded-xl' }: { className?: string }) {
  const { t } = useTranslation();
  const enabled = useSettingsStore((s) => s.catLabAudioTracks);
  if (!enabled) return null;

  return (
    <button
      type="button"
      onClick={() => useUIStore.getState().openModal('audioTracksMixer')}
      title={t('audioTracks.openButton')}
      aria-label={t('audioTracks.openButton')}
      className={`w-9 h-9 flex items-center justify-center transition-colors bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 ring-1 ring-purple-400/40 ${className}`}
    >
      <FlaskConical className="w-5 h-5" />
    </button>
  );
}
