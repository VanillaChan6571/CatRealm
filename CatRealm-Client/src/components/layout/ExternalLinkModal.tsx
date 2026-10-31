import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useUIStore } from '../../stores/uiStore';
import { getExternalUrlDomain } from '../../utils/externalLinks';

interface ExternalLinkModalData {
  url: string;
  domain?: string;
}

export function ExternalLinkModal() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const openModal = useUIStore((s) => s.openModal);
  const modalData = useUIStore((s) => s.modalData) as ExternalLinkModalData | null;

  if (activeModal !== 'externalLink' || !modalData?.url) return null;

  const domain = modalData.domain || getExternalUrlDomain(modalData.url) || 'this domain';
  const openContentSocial = () => {
    openModal('profileSettings', { initialTab: 'content-social' });
  };

  return (
    <Modal open={activeModal === 'externalLink'} onClose={closeModal} title="CatRealm Protection">
      <div className="space-y-4">
        <div className="rounded border border-yellow-600/30 bg-yellow-900/20 p-3">
          <p className="text-sm font-semibold text-yellow-300">Reason - Domain Not Trusted.</p>
        </div>
        <p className="text-sm text-text-secondary leading-relaxed">
          Hisss! Cats seen you click on a link &amp; we denied your redirect link! If you want to allow "{domain}" please head over to{' '}
          <button
            type="button"
            onClick={openContentSocial}
            className="text-accent hover:underline font-medium"
          >
            Content &amp; Social
          </button>
          {' '}to allow this domain! Nyaow best be careful now!
        </p>
        <div className="rounded border border-border bg-bg-input p-3">
          <p className="text-xs text-text-secondary break-all select-text">{modalData.url}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="primary" onClick={closeModal}>Okay</Button>
        </div>
      </div>
    </Modal>
  );
}

