import React from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { isKlipyMediaUrl } from './KlipyFavoriteButton';

const ANIMATED_IMAGE_RE = /\.(gif|webp|apng)(\?|$)/i;

/**
 * Embed image that honours "Disable Autoplay/Looping" by drawing only the first frame
 * onto a canvas (drawing cross-origin pixels is allowed; reading them back is not).
 * Clicking the frozen frame plays it.
 */
export function EmbedImage({ src, alt, className }: { src: string; alt: string; className: string }) {
  const disabled = useSettingsStore((s) => s.disableEmbedAutoplay);
  const [playing, setPlaying] = React.useState(false);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const freeze = disabled && !playing && (ANIMATED_IMAGE_RE.test(src) || isKlipyMediaUrl(src));

  React.useEffect(() => {
    if (!freeze) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')?.drawImage(img, 0, 0);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [freeze, src]);

  if (!freeze) return <img src={src} alt={alt} className={className} />;
  return (
    <canvas
      ref={canvasRef}
      width={0}
      height={0}
      role="img"
      aria-label={alt}
      title="Click to play"
      className={`${className} cursor-pointer`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setPlaying(true);
      }}
    />
  );
}

/** Animated (GIF-style) preview videos loop muted like desktop GIFs unless the user disabled it. */
export function PreviewVideo({ src, animated }: { src: string; animated: boolean }) {
  const disabled = useSettingsStore((s) => s.disableEmbedAutoplay);
  const loop = animated && !disabled;
  return (
    <video
      src={src}
      controls={!loop}
      autoPlay={loop}
      muted={loop}
      loop={loop}
      playsInline={loop}
      className="max-w-md rounded-t bg-black"
    />
  );
}
