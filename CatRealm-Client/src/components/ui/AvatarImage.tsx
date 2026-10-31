import { useEffect, useMemo, useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';

const frozenAvatarCache = new Map<string, Promise<string | null>>();
const MAX_FROZEN_AVATAR_CACHE_ENTRIES = 256;

type AvatarImageProps = {
  src?: string | null;
  alt?: string;
  size: number;
  className?: string;
  fallback: React.ReactNode;
};

function isGif(src?: string | null) {
  if (!src) return false;
  return src.toLowerCase().includes('.gif');
}

function frozenAvatar(src: string, size: number): Promise<string | null> {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const outputSize = Math.max(1, Math.round(size * pixelRatio));
  const cacheKey = `${src}\n${outputSize}`;
  const cached = frozenAvatarCache.get(cacheKey);
  if (cached) return cached;

  const pending = new Promise<string | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        // Decode the GIF once, but retain only the small first frame that the
        // avatar actually displays. The previous natural-size canvas could
        // turn one large GIF into several MB for every mounted avatar row.
        const canvas = document.createElement('canvas');
        canvas.width = outputSize;
        canvas.height = outputSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, outputSize, outputSize);
        resolve(canvas.toDataURL('image/webp', 0.82));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });

  frozenAvatarCache.set(cacheKey, pending);
  if (frozenAvatarCache.size > MAX_FROZEN_AVATAR_CACHE_ENTRIES) {
    const oldest = frozenAvatarCache.keys().next().value;
    if (oldest) frozenAvatarCache.delete(oldest);
  }
  return pending;
}

export function AvatarImage({ src, alt, size, className, fallback }: AvatarImageProps) {
  const playGifAvatars = useSettingsStore((s) => s.playGifAvatars);
  const [staticSrc, setStaticSrc] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const shouldFreeze = useMemo(() => !!src && isGif(src) && !playGifAvatars, [src, playGifAvatars]);

  useEffect(() => {
    setLoadFailed(false);
  }, [src]);

  useEffect(() => {
    if (!shouldFreeze || !src) {
      setStaticSrc(null);
      return;
    }

    let cancelled = false;
    void frozenAvatar(src, size).then((dataUrl) => {
      if (!cancelled) setStaticSrc(dataUrl);
    });

    return () => {
      cancelled = true;
    };
  }, [shouldFreeze, src, size]);

  if (!src) {
    return (
      <div
        className={className}
        style={{ width: size, height: size }}
      >
        {fallback}
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div
        className={className}
        style={{ width: size, height: size }}
      >
        {fallback}
      </div>
    );
  }

  const displaySrc = shouldFreeze ? (staticSrc ?? '') : src;
  if (shouldFreeze && !staticSrc) {
    return (
      <div
        className={className}
        style={{ width: size, height: size }}
      >
        {fallback}
      </div>
    );
  }

  return (
    <img
      src={displaySrc}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      style={{ width: size, height: size }}
      onError={() => setLoadFailed(true)}
    />
  );
}
