import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  DEFAULT_VOICE_BG_CSS,
  buildVoiceBackgroundCss,
  getVoiceBackgroundAnimation,
  isVideoBackground,
  loadVoiceBackgroundFile,
} from '../../lib/voiceCallBackground';
import { VoiceBgSceneLayer } from './VoiceBgSceneLayer';

/**
 * Absolute-positioned background layer for the server voice call view.
 * Renders the built-in blue gradient, a user-defined color pattern, or a
 * locally stored image/video (device-only, never uploaded).
 * Parent must be `relative overflow-hidden`.
 */
export function VoiceCallBackground() {
  const mode = useSettingsStore((s) => s.voiceBgMode);
  const colors = useSettingsStore((s) => s.voiceBgColors);
  const pattern = useSettingsStore((s) => s.voiceBgPattern);
  const animated = useSettingsStore((s) => s.voiceBgAnimated);
  const scene = useSettingsStore((s) => s.voiceBgScene);
  const imageUpdatedAt = useSettingsStore((s) => s.voiceBgImageUpdatedAt);

  const [media, setMedia] = useState<{ url: string; isVideo: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    if (mode === 'image') {
      void loadVoiceBackgroundFile().then((stored) => {
        if (cancelled || !stored) return;
        objectUrl = URL.createObjectURL(stored.blob);
        setMedia({ url: objectUrl, isVideo: isVideoBackground(stored.type) });
      });
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setMedia(null);
    };
  }, [mode, imageUpdatedAt]);

  const background = mode === 'colors'
    ? buildVoiceBackgroundCss(colors, pattern)
    : DEFAULT_VOICE_BG_CSS;
  const animation = mode === 'colors' && animated
    ? getVoiceBackgroundAnimation(colors, pattern)
    : { className: '', style: {} };

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {/* Gradient base; also the fallback while media loads or is missing. */}
      <div
        className={`absolute inset-0 ${animation.className}`}
        style={{ background, ...animation.style }}
      />
      {mode === 'colors' && scene && (
        <VoiceBgSceneLayer scene={scene} colors={colors} animated={animated} />
      )}
      {mode === 'image' && media && (
        media.isVideo ? (
          <video
            src={media.url}
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <img src={media.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )
      )}
      {mode === 'image' && media && (
        // Keeps tiles and text readable over arbitrary uploads.
        <div className="absolute inset-0 bg-black/25" />
      )}
    </div>
  );
}
