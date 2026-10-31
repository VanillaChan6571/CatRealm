import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from './Button';

type CropShape = 'rect' | 'circle';

interface CropPoint {
  x: number;
  y: number;
}

interface ImageCropModalProps {
  isOpen: boolean;
  file: File | null;
  title: string;
  aspectRatio: number;
  outputWidth: number;
  outputHeight: number;
  shape?: CropShape;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (file: File) => void;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function outputFileName(sourceName: string) {
  const dot = sourceName.lastIndexOf('.');
  const base = dot > 0 ? sourceName.slice(0, dot) : sourceName;
  return `${base}-cropped.png`;
}

function isAnimatedPngFile(file: File) {
  return file.type === 'image/png' && /\.apng$/i.test(file.name);
}

async function isAnimatedWebpFile(file: File) {
  if (file.type !== 'image/webp' && !/\.webp$/i.test(file.name)) return false;
  try {
    const header = await file.slice(0, 1024).arrayBuffer();
    const bytes = new Uint8Array(header);
    for (let i = 0; i <= bytes.length - 4; i += 1) {
      if (
        bytes[i] === 0x41 && // A
        bytes[i + 1] === 0x4e && // N
        bytes[i + 2] === 0x49 && // I
        bytes[i + 3] === 0x4d // M
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

async function shouldPreserveAnimation(file: File) {
  if (file.type === 'image/gif') return true;
  if (isAnimatedPngFile(file)) return true;
  if (await isAnimatedWebpFile(file)) return true;
  return false;
}

export function ImageCropModal({
  isOpen,
  file,
  title,
  aspectRatio,
  outputWidth,
  outputHeight,
  shape = 'rect',
  busy = false,
  onCancel,
  onConfirm,
}: ImageCropModalProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<CropPoint>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragOrigin, setDragOrigin] = useState<CropPoint>({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);

  const frame = useMemo(() => {
    const width = aspectRatio > 1.2 ? 360 : 300;
    return {
      width,
      height: Math.round(width / aspectRatio),
    };
  }, [aspectRatio]);

  const fitScale = useMemo(() => {
    if (!naturalSize) return 1;
    return Math.max(frame.width / naturalSize.width, frame.height / naturalSize.height);
  }, [naturalSize, frame.width, frame.height]);

  const effectiveScale = fitScale * zoom;

  const clampedOffset = useMemo(() => {
    if (!naturalSize) return { x: 0, y: 0 };
    const scaledWidth = naturalSize.width * effectiveScale;
    const scaledHeight = naturalSize.height * effectiveScale;
    const maxX = Math.max(0, (scaledWidth - frame.width) / 2);
    const maxY = Math.max(0, (scaledHeight - frame.height) / 2);
    return {
      x: clamp(offset.x, -maxX, maxX),
      y: clamp(offset.y, -maxY, maxY),
    };
  }, [effectiveScale, frame.height, frame.width, naturalSize, offset.x, offset.y]);

  useEffect(() => {
    if (!isOpen || !file) return;
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setSaving(false);

    const img = new Image();
    img.onload = () => {
      setNaturalSize({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    };
    img.src = url;

    return () => {
      URL.revokeObjectURL(url);
      setImageUrl(null);
      setNaturalSize(null);
      setDragging(false);
      setSaving(false);
    };
  }, [file, isOpen]);

  useEffect(() => {
    setOffset(clampedOffset);
  }, [clampedOffset.x, clampedOffset.y]);

  if (!isOpen || !file || !imageUrl || !naturalSize) return null;

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(true);
    setDragOrigin({ x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const dx = event.clientX - dragOrigin.x;
    const dy = event.clientY - dragOrigin.y;
    setDragOrigin({ x: event.clientX, y: event.clientY });
    setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleConfirm = async () => {
    if (busy || saving) return;
    setSaving(true);
    try {
      if (await shouldPreserveAnimation(file)) {
        onConfirm(file);
        return;
      }

      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image for cropping'));
        img.src = imageUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not initialize canvas');

      const scaledWidth = naturalSize.width * effectiveScale;
      const scaledHeight = naturalSize.height * effectiveScale;
      const imageLeft = frame.width / 2 + clampedOffset.x - scaledWidth / 2;
      const imageTop = frame.height / 2 + clampedOffset.y - scaledHeight / 2;
      const sourceX = (0 - imageLeft) / effectiveScale;
      const sourceY = (0 - imageTop) / effectiveScale;
      const sourceWidth = frame.width / effectiveScale;
      const sourceHeight = frame.height / effectiveScale;

      ctx.drawImage(
        img,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        outputWidth,
        outputHeight
      );

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((nextBlob) => resolve(nextBlob), 'image/png', 0.95);
      });
      if (!blob) throw new Error('Could not generate cropped image');

      const cropped = new File([blob], outputFileName(file.name), {
        type: 'image/png',
        lastModified: Date.now(),
      });
      onConfirm(cropped);
    } catch {
      // Parent upload handlers surface API/file errors; keep modal open on crop generation errors.
    } finally {
      setSaving(false);
    }
  };

  const scaledWidth = naturalSize.width * effectiveScale;
  const scaledHeight = naturalSize.height * effectiveScale;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" data-tour-pause>
      <div className="w-full max-w-2xl rounded-lg border border-border bg-bg-chat p-5 shadow-xl">
        <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
        <p className="mt-1 text-xs text-text-muted">Drag to position. Use zoom to frame the crop.</p>

        <div className="mt-4 flex justify-center">
          <div
            className={`relative overflow-hidden border border-border bg-bg-input ${shape === 'circle' ? 'rounded-full' : 'rounded-lg'}`}
            style={{ width: frame.width, height: frame.height, touchAction: 'none' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <img
              src={imageUrl}
              alt="Crop preview"
              draggable={false}
              className="absolute select-none pointer-events-none"
              style={{
                width: scaledWidth,
                height: scaledHeight,
                left: `calc(50% + ${clampedOffset.x}px)`,
                top: `calc(50% + ${clampedOffset.y}px)`,
                transform: 'translate(-50%, -50%)',
                maxWidth: 'none',
              }}
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs text-text-muted">Zoom</label>
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="w-full"
          />
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={saving || busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleConfirm} disabled={saving || busy}>
            {saving || busy ? 'Applying...' : 'Apply Crop'}
          </Button>
        </div>
      </div>
    </div>
  );
}
