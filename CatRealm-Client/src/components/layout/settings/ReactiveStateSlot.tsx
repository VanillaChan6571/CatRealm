import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, X } from 'lucide-react';
import type { ReactiveAvatarMotion, ReactiveAvatarState } from '../../../stores/reactiveAvatarStore';
import { STATE_LABEL_KEYS } from './reactiveAvatarLabels';
import { ReactiveCompressModal } from './ReactiveCompressModal';

const MAX_DIMENSION = 2048;
const THUMBNAIL_PX = 128;
/** Above this, picking art opens the compress suggestion instead of saving it. */
const COMPRESS_SUGGEST_BYTES = 10 * 1024 * 1024;

const ERROR_KEYS: Record<string, string> = {
  'too-large': 'settingsContent.reactiveErrorTooLarge',
  'unsupported-type': 'settingsContent.reactiveErrorUnsupported',
  'bad-dimensions': 'settingsContent.reactiveErrorDimensions',
};

/** GIF, animated WebP (VP8X animation flag) or APNG (acTL before IDAT). */
function isAnimated(bytes: Uint8Array): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (ascii(0, 3) === 'GIF') return true;
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return ascii(12, 16) === 'VP8X' && (bytes[20] & 0x02) !== 0;
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 8; i + 8 <= bytes.length;) {
      const type = ascii(i + 4, i + 8);
      if (type === 'acTL') return true;
      if (type === 'IDAT') return false;
      i += 12 + view.getUint32(i);
    }
  }
  return false;
}

/**
 * Still images larger than the overlay limit are scaled down here so artwork
 * exported at print size just works; animations are passed through untouched
 * (scaling through a canvas would flatten them to one frame) and the main
 * process rejects oversize ones.
 */
async function prepareImageBytes(file: File): Promise<Uint8Array> {
  const original = new Uint8Array(await file.arrayBuffer());
  if (isAnimated(original)) return original;
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) return original;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return original;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : original;
  } finally {
    bitmap.close();
  }
}

/** First frame of a (WebM) video, as an ImageBitmap. */
async function videoFirstFrame(blob: Blob): Promise<ImageBitmap> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('Video decode failed'));
    });
    // A detached <video> isn't "usable" as a bitmap source until it has seeked.
    video.currentTime = 0;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });
    return await createImageBitmap(video);
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** First frame scaled to a small PNG, so a grid of 60 fps animations costs nothing. */
async function toStillThumbnail(blob: Blob): Promise<Blob> {
  const bitmap = blob.type.startsWith('video/') ? await videoFirstFrame(blob) : await createImageBitmap(blob);
  try {
    const scale = Math.min(1, THUMBNAIL_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? blob), 'image/png'));
  } finally {
    bitmap.close();
  }
}

/** Object URL for a stored image id, read back through the main process. */
function useReactiveImageUrl(imageId: string | undefined, still = false) {
  const [loaded, setLoaded] = useState<{ id: string; url: string; isVideo: boolean } | null>(null);
  useEffect(() => {
    if (!imageId || !window.electron?.reactiveAvatarReadImage) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    void window.electron.reactiveAvatarReadImage(imageId).then(async (result) => {
      if (cancelled || !result.ok) return;
      const blob = new Blob([result.bytes], { type: result.mime });
      const shown = still ? await toStillThumbnail(blob) : blob;
      if (cancelled) return;
      objectUrl = URL.createObjectURL(shown);
      setLoaded({ id: imageId, url: objectUrl, isVideo: shown.type.startsWith('video/') });
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageId, still]);
  // A stale URL from a previous id is never shown (it is revoked on change).
  return loaded && loaded.id === imageId ? loaded : null;
}

/** Upload / preview / clear tile for one reactive avatar state. */
export function ReactiveStateSlot({
  state,
  imageId,
  onSave,
  onClear,
  size = 64,
}: {
  state: ReactiveAvatarState;
  imageId: string | undefined;
  onSave: (imageId: string) => void;
  onClear: () => void;
  size?: number;
}) {
  const { t } = useTranslation();
  const previewUrl = useReactiveImageUrl(imageId, true)?.url ?? null;
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [oversizedFile, setOversizedFile] = useState<File | null>(null);
  const stateLabel = t(STATE_LABEL_KEYS[state]);

  const saveBytes = async (bytes: Uint8Array) => {
    if (!window.electron?.reactiveAvatarSaveImage) return;
    try {
      const result = await window.electron.reactiveAvatarSaveImage(bytes);
      if (result.ok) onSave(result.id);
      else setError(t(ERROR_KEYS[result.error] ?? 'settingsContent.reactiveErrorGeneric'));
    } catch {
      setError(t('settingsContent.reactiveErrorGeneric'));
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file || !window.electron?.reactiveAvatarSaveImage) return;
    setError(null);
    if (file.size > COMPRESS_SUGGEST_BYTES) {
      setOversizedFile(file);
      return;
    }
    try {
      await saveBytes(await prepareImageBytes(file));
    } catch {
      setError(t('settingsContent.reactiveErrorGeneric'));
    }
  };

  return (
    <div className="flex flex-col items-center gap-1" style={{ width: size + 8 }}>
      <div className="relative">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          title={t('settingsContent.reactiveUpload', { state: stateLabel })}
          aria-label={t('settingsContent.reactiveUpload', { state: stateLabel })}
          style={{ width: size, height: size }}
          className="rounded-lg border border-dashed border-border bg-bg-input hover:border-accent flex items-center justify-center overflow-hidden transition-colors"
        >
          {previewUrl
            ? <img src={previewUrl} alt="" className="w-full h-full object-contain" />
            : <ImagePlus className="w-5 h-5 text-text-muted" />}
        </button>
        {imageId && (
          <button
            type="button"
            onClick={onClear}
            title={t('settingsContent.reactiveClear', { state: stateLabel })}
            aria-label={t('settingsContent.reactiveClear', { state: stateLabel })}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-bg-elevated border border-border flex items-center justify-center text-text-muted hover:text-danger"
          >
            <X className="w-3 h-3" />
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      <span className="text-[11px] text-text-muted">{stateLabel}</span>
      {error && <span className="text-[11px] text-danger text-center leading-tight">{error}</span>}
      {oversizedFile && (
        <ReactiveCompressModal
          file={oversizedFile}
          onUse={async (bytes) => {
            await saveBytes(bytes);
            setOversizedFile(null);
          }}
          onCancel={() => setOversizedFile(null)}
        />
      )}
    </div>
  );
}

/** Live preview of one state's art with the chosen motion, as the overlay shows it. */
export function ReactiveArtPreview({
  imageId,
  fallbackId,
  motion,
  speaking,
  size = 112,
}: {
  imageId: string | undefined;
  fallbackId: string | undefined;
  motion: ReactiveAvatarMotion;
  speaking: boolean;
  size?: number;
}) {
  const art = useReactiveImageUrl(imageId ?? fallbackId);
  const motionClass = speaking && motion === 'bounce'
    ? 'reactive-preview-bounce'
    : speaking && motion === 'pop'
      ? 'scale-[1.08]'
      : '';
  return (
    <div style={{ width: size, height: size }} className="flex items-center justify-center">
      {!art
        ? <ImagePlus className="w-6 h-6 text-text-muted" />
        : art.isVideo
          ? <video src={art.url} autoPlay loop muted playsInline className={`w-full h-full object-contain transition-transform duration-150 ${motionClass}`} />
          : <img src={art.url} alt="" className={`w-full h-full object-contain transition-transform duration-150 ${motionClass}`} />}
    </div>
  );
}
