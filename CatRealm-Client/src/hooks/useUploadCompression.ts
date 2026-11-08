import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { UploadCompressionError, canCompressUpload, compressUploadToFit } from '../lib/uploadCompression';

/** Room left under the limit; the server compares exact byte counts. */
const LIMIT_MARGIN_BYTES = 64 * 1024;
/** How long the "Compressed X: A → B" line stays up. */
const SUMMARY_MS = 10_000;

export type UploadCompressionStatus = {
  fileName: string;
  progress: number;
  limitMb: number;
};

export type UploadCompressionSummary = {
  fileName: string;
  beforeBytes: number;
  afterBytes: number;
}[];

export type FitToLimitResult =
  /** Every file fits (possibly after compressing some). */
  | { kind: 'ok'; files: File[] }
  /** Cat Lab compression is off: the caller shows its usual "too large" error. */
  | { kind: 'rejected' }
  | { kind: 'failed'; message: string }
  | { kind: 'cancelled' };

/**
 * Cat Lab "Auto Compress Upload on Max Limit Hit": shrinks files that are over
 * the upload limit before they are queued, with progress and cancel.
 */
export function useUploadCompression() {
  const enabled = useSettingsStore((s) => s.catLabAutoCompressUploads);
  const [status, setStatus] = useState<UploadCompressionStatus | null>(null);
  const [summary, setSummary] = useState<UploadCompressionSummary | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    if (!summary) return;
    const timer = window.setTimeout(() => setSummary(null), SUMMARY_MS);
    return () => window.clearTimeout(timer);
  }, [summary]);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  const fitToLimit = useCallback(async (files: File[], limitBytes: number): Promise<FitToLimitResult> => {
    setSummary(null);
    if (!files.some((file) => file.size > limitBytes)) return { kind: 'ok', files };
    if (!enabled) return { kind: 'rejected' };
    if (controllerRef.current) return { kind: 'failed', message: 'Another file is still being compressed.' };

    const limitMb = Math.round(limitBytes / (1024 * 1024));
    const uncompressible = files.find((file) => file.size > limitBytes && !canCompressUpload(file));
    if (uncompressible) {
      return { kind: 'failed', message: `${uncompressible.name} is over ${limitMb} MB and this file type can’t be compressed.` };
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const fitted: File[] = [];
      const compressed: UploadCompressionSummary = [];
      for (const file of files) {
        if (file.size <= limitBytes) {
          fitted.push(file);
          continue;
        }
        setStatus({ fileName: file.name, progress: 0, limitMb });
        const result = await compressUploadToFit(file, {
          targetBytes: limitBytes - LIMIT_MARGIN_BYTES,
          signal: controller.signal,
          onProgress: (progress) => setStatus({ fileName: file.name, progress, limitMb }),
        });
        fitted.push(result);
        compressed.push({ fileName: file.name, beforeBytes: file.size, afterBytes: result.size });
      }
      setSummary(compressed);
      return { kind: 'ok', files: fitted };
    } catch (err) {
      if (controller.signal.aborted || (err instanceof UploadCompressionError && err.reason === 'cancelled')) {
        return { kind: 'cancelled' };
      }
      const message = err instanceof Error && err.message ? err.message : 'Compression failed.';
      return { kind: 'failed', message: `Couldn’t compress to fit ${limitMb} MB: ${message}` };
    } finally {
      controllerRef.current = null;
      setStatus(null);
    }
  }, [enabled]);

  return { status, summary, fitToLimit, cancel };
}
