import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Info, Loader2 } from 'lucide-react';
import { compressReactiveArt, detectArtSource } from '../../../lib/reactiveAvatarCompress';

const TARGET_OPTIONS_MB = [2.5, 5, 10] as const;

function formatMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function YesNo({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden">
      {[true, false].map((option) => (
        <button
          key={String(option)}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option)}
          className={`px-3 py-1 text-xs transition-colors disabled:opacity-50 ${
            value === option ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-hover'
          }`}
        >
          {option ? t('common.yes') : t('common.no')}
        </button>
      ))}
    </div>
  );
}

/**
 * Shown (with a shake) when picked art is over the size threshold: suggests
 * letting CatRealm compress it to a target size, or using the original anyway.
 */
export function ReactiveCompressModal({
  file,
  onUse,
  onCancel,
}: {
  file: File;
  onUse: (bytes: Uint8Array) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [targetMb, setTargetMb] = useState<number>(TARGET_OPTIONS_MB[0]);
  const [animated, setAnimated] = useState(true);
  const [transparent, setTransparent] = useState(true);
  const [sourceAnimated, setSourceAnimated] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const busy = progress !== null;

  useEffect(() => {
    let cancelled = false;
    void detectArtSource(file).then((detected) => {
      if (cancelled) return;
      setSourceAnimated(detected.animated);
      setAnimated(detected.animated);
      setTransparent(detected.transparent);
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const close = () => {
    abortRef.current?.abort();
    onCancel();
  };

  const handleCompress = async () => {
    setError(null);
    setProgress(0);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await compressReactiveArt(file, {
        targetBytes: Math.floor(targetMb * 1024 * 1024),
        animated,
        transparent,
        onProgress: setProgress,
        signal: controller.signal,
      });
      await onUse(result.bytes);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setError(t('settingsContent.reactiveCompressFailed'));
      setShake(true);
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  const handleUseOriginal = async () => {
    setError(null);
    setProgress(0);
    try {
      await onUse(new Uint8Array(await file.arrayBuffer()));
    } finally {
      setProgress(null);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reactive-compress-title"
        className={`bg-bg-elevated rounded-lg shadow-xl w-full max-w-md border border-danger/40 ${shake ? 'modal-reject-shake' : ''}`}
        onAnimationEnd={() => setShake(false)}
      >
        <div className="px-4 py-3 border-b border-border">
          <h2 id="reactive-compress-title" className="text-lg font-semibold text-text-primary">
            {t('settingsContent.reactiveCompressTitle')}
          </h2>
          <p className="text-xs text-text-muted truncate">
            {file.name} · <span className="text-danger font-medium">{formatMb(file.size)}</span>
          </p>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-text-secondary">{t('settingsContent.reactiveCompressBody')}</p>

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-text-primary">{t('settingsContent.reactiveCompressTarget')}</p>
            <div className="flex flex-wrap gap-2">
              {TARGET_OPTIONS_MB.map((mb) => (
                <button
                  key={mb}
                  type="button"
                  disabled={busy}
                  onClick={() => setTargetMb(mb)}
                  className={`px-3 py-1.5 rounded-md border text-xs transition-colors disabled:opacity-50 ${
                    targetMb === mb ? 'border-accent bg-accent/15 text-accent' : 'border-border text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  {mb} MB
                </button>
              ))}
            </div>
            <p className="text-[11px] text-text-muted">{t('settingsContent.reactiveCompressTargetHint')}</p>
          </div>

          {sourceAnimated && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-text-primary">{t('settingsContent.reactiveCompressAnimated')}</p>
              <YesNo value={animated} onChange={setAnimated} disabled={busy} />
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-text-primary flex items-center gap-1.5">
                {t('settingsContent.reactiveCompressTransparent')}
                <span title={t('settingsContent.reactiveCompressTransparentInfo')} className="text-text-muted cursor-help">
                  <Info className="w-3.5 h-3.5" aria-hidden="true" />
                </span>
              </p>
              <YesNo value={transparent} onChange={setTransparent} disabled={busy} />
            </div>
            <p className="text-[11px] text-text-muted">{t('settingsContent.reactiveCompressTransparentInfo')}</p>
          </div>

          {busy && (
            <div className="space-y-1">
              <div className="h-1.5 rounded-full bg-bg-hover overflow-hidden">
                <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
              </div>
              <p className="text-[11px] text-text-muted">{t('settingsContent.reactiveCompressWorking', { percent: Math.round((progress ?? 0) * 100) })}</p>
            </div>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button type="button" onClick={close} className="px-3 py-1.5 rounded-md text-sm text-text-secondary hover:bg-bg-hover">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleUseOriginal()}
            className="px-3 py-1.5 rounded-md text-sm border border-border text-text-secondary hover:bg-bg-hover disabled:opacity-50"
          >
            {t('settingsContent.reactiveCompressUseOriginal')}
          </button>
          <button
            type="button"
            disabled={busy || sourceAnimated === null}
            onClick={() => void handleCompress()}
            className="px-3 py-1.5 rounded-md text-sm bg-accent text-white hover:bg-accent-hover disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            {t('settingsContent.reactiveCompressAction')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
