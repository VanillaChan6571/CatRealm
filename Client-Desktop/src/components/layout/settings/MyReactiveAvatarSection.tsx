import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../../stores/settingsStore';
import {
  REACTIVE_AVATAR_MOTIONS,
  REACTIVE_AVATAR_STATES,
  useReactiveAvatarStore,
  type ReactiveAvatarMotion,
  type ReactiveAvatarState,
} from '../../../stores/reactiveAvatarStore';
import { useReactiveShareStore, type ReactiveShareMode } from '../../../stores/reactiveShareStore';
import { getMySharedPackSize } from '../../../lib/reactiveAvatarShare/exchange';
import { compressReactiveArt, detectArtSource } from '../../../lib/reactiveAvatarCompress';
import { ReactiveArtPreview, ReactiveStateSlot } from './ReactiveStateSlot';
import { MOTION_LABEL_KEYS, STATE_LABEL_KEYS } from './reactiveAvatarLabels';

const SHARE_MODES: { mode: ReactiveShareMode; labelKey: string }[] = [
  { mode: 'off', labelKey: 'settingsContent.reactiveShareOff' },
  { mode: 'friends', labelKey: 'settingsContent.reactiveShareFriends' },
  { mode: 'everyone', labelKey: 'settingsContent.reactiveShareEveryone' },
];

/** Per-state budget for share copies: four states stay well under the 12 MB pack cap. */
const SHARE_COPY_TARGET_BYTES = Math.floor(2.5 * 1024 * 1024);

/**
 * Makes compressed copies of large states for friends; your own overlay keeps
 * the originals. Already-compressed WebM and small images are sent as-is.
 */
async function makeShareCopies(onProgress: (done: number, total: number) => void) {
  const { myPack, setMyShareCopy } = useReactiveAvatarStore.getState();
  const read = window.electron?.reactiveAvatarReadImage;
  const saveImage = window.electron?.reactiveAvatarSaveImage;
  if (!read || !saveImage) return;
  const todo: { id: string; blob: Blob }[] = [];
  for (const id of new Set(Object.values(myPack.images))) {
    if (!id || myPack.shareCopies[id]) continue;
    const result = await read(id);
    if (!result.ok || result.bytes.byteLength <= SHARE_COPY_TARGET_BYTES || result.mime.startsWith('video/')) continue;
    todo.push({ id, blob: new Blob([result.bytes], { type: result.mime }) });
  }
  for (let i = 0; i < todo.length; i++) {
    onProgress(i, todo.length);
    const { animated, transparent } = await detectArtSource(todo[i].blob);
    const compressed = await compressReactiveArt(todo[i].blob, { targetBytes: SHARE_COPY_TARGET_BYTES, animated, transparent });
    const saved = await saveImage(compressed.bytes);
    if (!saved.ok) throw new Error(saved.error);
    setMyShareCopy(todo[i].id, saved.id);
  }
  onProgress(todo.length, todo.length);
}

function formatMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Same fallback chain the overlay uses for a missing state. */
function resolveStateImage(images: Partial<Record<ReactiveAvatarState, string>>, state: ReactiveAvatarState) {
  if (state === 'deafened') return images.deafened ?? images.muted ?? images.idle;
  return images[state] ?? images.idle;
}

/**
 * Appearance → My Reactive Avatar (Cat Lab experiment): your own per-state art.
 * It shows for you in your OBS overlay and is the pack friends will receive.
 */
export function MyReactiveAvatarSection() {
  const { t } = useTranslation();
  const myPack = useReactiveAvatarStore((s) => s.myPack);
  const setMyImage = useReactiveAvatarStore((s) => s.setMyImage);
  const clearMyImage = useReactiveAvatarStore((s) => s.clearMyImage);
  const setMyMotion = useReactiveAvatarStore((s) => s.setMyMotion);
  const overlayReactiveOn = useSettingsStore((s) => s.obsOverlayEnabled && s.obsOverlayReactiveAvatars);
  const [previewState, setPreviewState] = useState<ReactiveAvatarState>('speaking');
  const desktop = !!window.electron?.reactiveAvatarSaveImage;
  const hasArt = Object.keys(myPack.images).length > 0;
  const shareMode = useReactiveShareStore((s) => s.shareMode);
  const setShareMode = useReactiveShareStore((s) => s.setShareMode);
  const [packSize, setPackSize] = useState<{ bytes: number; shareable: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getMySharedPackSize().then((size) => {
      if (!cancelled) setPackSize(size);
    });
    return () => {
      cancelled = true;
    };
  }, [myPack.updatedAt]);
  // Keep the last known size while it's recalculated, so the line (and any
  // in-progress compress button) doesn't flicker away after each change.
  const currentSize = hasArt ? packSize : null;
  const [copyProgress, setCopyProgress] = useState<{ done: number; total: number } | null>(null);
  const [copyError, setCopyError] = useState(false);
  const hasShareCopies = Object.keys(myPack.shareCopies).length > 0;

  const handleMakeShareCopies = async () => {
    setCopyError(false);
    setCopyProgress({ done: 0, total: 0 });
    try {
      await makeShareCopies((done, total) => setCopyProgress({ done, total }));
    } catch {
      setCopyError(true);
    } finally {
      setCopyProgress(null);
    }
  };

  return (
    <div className="catlab-feature-card space-y-4 bg-bg-hover/30 p-4 rounded-lg">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm font-medium text-text-primary">{t('settingsContent.myReactiveAvatar')}</p>
        <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
          {t('settingsContent.catLabExperimental')}
        </span>
      </div>
      <p className="text-xs text-text-muted">{t('settingsContent.myReactiveAvatarDesc')}</p>

      {!desktop ? (
        <p className="text-xs text-text-muted">{t('settingsContent.reactiveDesktopOnly')}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-5">
            <div className="flex flex-col items-center gap-2">
              <div className="rounded-lg bg-bg-input border border-border p-2">
                <ReactiveArtPreview
                  imageId={resolveStateImage(myPack.images, previewState)}
                  fallbackId={undefined}
                  motion={myPack.motion}
                  speaking={previewState === 'speaking'}
                />
              </div>
              <div className="flex flex-wrap justify-center gap-1 max-w-[180px]">
                {REACTIVE_AVATAR_STATES.map((state) => (
                  <button
                    key={state}
                    type="button"
                    onClick={() => setPreviewState(state)}
                    className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                      previewState === state
                        ? 'border-accent bg-accent/15 text-accent'
                        : 'border-border text-text-muted hover:text-text-primary'
                    }`}
                  >
                    {t(STATE_LABEL_KEYS[state])}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-w-[240px] space-y-3">
              <div className="flex flex-wrap gap-2">
                {REACTIVE_AVATAR_STATES.map((state) => (
                  <ReactiveStateSlot
                    key={state}
                    state={state}
                    imageId={myPack.images[state]}
                    onSave={(id) => setMyImage(state, id)}
                    onClear={() => clearMyImage(state)}
                  />
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                {t('settingsContent.reactiveMotion')}
                <select
                  value={myPack.motion}
                  onChange={(e) => setMyMotion(e.target.value as ReactiveAvatarMotion)}
                  className="bg-bg-input border border-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent"
                >
                  {REACTIVE_AVATAR_MOTIONS.map((m) => (
                    <option key={m} value={m}>{t(MOTION_LABEL_KEYS[m])}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="space-y-1.5 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-text-secondary">{t('settingsContent.reactiveShareWith')}</span>
              <div className="inline-flex rounded-md border border-border overflow-hidden">
                {SHARE_MODES.map(({ mode, labelKey }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setShareMode(mode)}
                    className={`px-3 py-1 text-xs transition-colors ${
                      shareMode === mode ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-hover'
                    }`}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-text-muted">{t('settingsContent.reactiveShareDesc')}</p>
            {currentSize && shareMode !== 'off' && (
              <div className="flex flex-wrap items-center gap-2">
                <p className={`text-[11px] ${currentSize.shareable ? 'text-text-muted' : 'text-danger'}`}>
                  {currentSize.shareable
                    ? t('settingsContent.reactiveShareSize', { size: formatMb(currentSize.bytes) })
                    : t('settingsContent.reactiveShareTooBig', { size: formatMb(currentSize.bytes) })}
                  {currentSize.shareable && hasShareCopies && ` · ${t('settingsContent.reactiveShareCopiesNote')}`}
                </p>
                {(!currentSize.shareable || copyProgress) && (
                  <button
                    type="button"
                    disabled={copyProgress !== null}
                    onClick={() => void handleMakeShareCopies()}
                    className="px-2.5 py-1 rounded-md text-[11px] bg-accent text-white hover:bg-accent-hover disabled:opacity-60"
                  >
                    {copyProgress
                      ? t('settingsContent.reactiveShareCompressing', { done: copyProgress.done, total: copyProgress.total || '…' })
                      : t('settingsContent.reactiveShareCompress')}
                  </button>
                )}
                {copyError && <p className="text-[11px] text-danger">{t('settingsContent.reactiveShareCompressFailed')}</p>}
              </div>
            )}
          </div>

          <p className="text-xs text-text-muted">
            {!hasArt
              ? t('settingsContent.myReactiveAvatarEmpty')
              : overlayReactiveOn ? t('settingsContent.myReactiveAvatarOverlayOn') : t('settingsContent.myReactiveAvatarOverlayOff')}
          </p>
        </>
      )}
    </div>
  );
}
