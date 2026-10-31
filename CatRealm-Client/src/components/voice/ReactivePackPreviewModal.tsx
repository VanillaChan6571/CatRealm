import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { REACTIVE_AVATAR_STATES } from '../../stores/reactiveAvatarStore';
import { getApprovalKey, isOfferShown, useReactiveShareStore } from '../../stores/reactiveShareStore';
import { requestOfferedPack } from '../../lib/reactiveAvatarShare/exchange';
import { ReactiveArtPreview } from '../layout/settings/ReactiveStateSlot';
import { STATE_LABEL_KEYS } from '../layout/settings/reactiveAvatarLabels';

/**
 * Preview of someone's shared reactive avatar, inside CatRealm only (never in
 * OBS until allowed), with Allow / Block. Opening it is what downloads a
 * stranger's pack.
 */
export function ReactivePackPreviewModal({ personKey, name, onClose }: { personKey: string; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const offer = useReactiveShareStore((s) => s.offered[personKey]);
  const pack = useReactiveShareStore((s) => (offer ? s.received[offer.hash] : undefined));
  const approvals = useReactiveShareStore((s) => s.approvals);
  const setApproval = useReactiveShareStore((s) => s.setApproval);

  useEffect(() => {
    requestOfferedPack(personKey);
  }, [personKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!offer) return null;
  const approvalKey = getApprovalKey(personKey, offer);
  const shown = isOfferShown(personKey, offer, approvals);
  const blocked = approvals[approvalKey] === 'blocked';

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="reactive-preview-title" className="bg-bg-elevated rounded-lg shadow-xl w-full max-w-lg">
        <div className="px-4 py-3 border-b border-border">
          <h2 id="reactive-preview-title" className="text-lg font-semibold text-text-primary truncate">
            {t('reactiveShare.previewTitle', { name })}
          </h2>
          <p className="text-xs text-text-muted">
            {offer.kind === 'friend' ? t('reactiveShare.kindFriend') : t('reactiveShare.kindStranger')}
            {' · '}
            {blocked ? t('reactiveShare.statusBlocked') : shown ? t('reactiveShare.statusShown') : t('reactiveShare.statusHidden')}
          </p>
        </div>

        <div className="p-4">
          {pack ? (
            <div className="grid grid-cols-4 gap-2">
              {REACTIVE_AVATAR_STATES.map((state) => (
                <div key={state} className="flex flex-col items-center gap-1">
                  <div className="rounded-lg bg-bg-input border border-border p-1">
                    <ReactiveArtPreview
                      imageId={state === 'deafened' ? pack.images.deafened ?? pack.images.muted ?? pack.images.idle : pack.images[state] ?? pack.images.idle}
                      fallbackId={undefined}
                      motion={pack.motion}
                      speaking={state === 'speaking'}
                      size={88}
                    />
                  </div>
                  <span className="text-[11px] text-text-muted">{t(STATE_LABEL_KEYS[state])}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-28 flex items-center justify-center gap-2 text-sm text-text-muted">
              {offer.status === 'failed'
                ? t('reactiveShare.previewFailed')
                : (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    {t('reactiveShare.previewLoading')}
                  </>
                )}
            </div>
          )}
          <p className="mt-3 text-[11px] text-text-muted">
            {offer.kind === 'friend' ? t('reactiveShare.previewNoteFriend') : t('reactiveShare.previewNoteStranger')}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md text-sm text-text-secondary hover:bg-bg-hover">
            {t('common.close')}
          </button>
          {blocked || !shown ? (
            <>
              {!blocked && (
                <button
                  type="button"
                  onClick={() => setApproval(approvalKey, 'blocked')}
                  className="px-3 py-1.5 rounded-md text-sm border border-danger/50 text-danger hover:bg-danger/10"
                >
                  {t('reactiveShare.block')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setApproval(approvalKey, offer.kind === 'friend' ? null : 'allowed')}
                className="px-3 py-1.5 rounded-md text-sm bg-accent text-white hover:bg-accent-hover"
              >
                {t('reactiveShare.allow')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setApproval(approvalKey, 'blocked')}
              className="px-3 py-1.5 rounded-md text-sm border border-danger/50 text-danger hover:bg-danger/10"
            >
              {t('reactiveShare.block')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
