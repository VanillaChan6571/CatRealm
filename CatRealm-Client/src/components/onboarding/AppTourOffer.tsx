import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { markDeviceSeenAppTour, useAppTourStore } from '../../lib/appTour';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useTranslation } from 'react-i18next';

// The account has had the tour, this device hasn't: offer it, never force it.
export function AppTourOffer() {
  const { t } = useTranslation();
  const open = useUIStore((s) => s.activeModal === 'appTourOffer');
  const closeModal = useUIStore((s) => s.closeModal);
  const userId = useAuthStore((s) => s.user?.id);

  const dismiss = () => {
    if (userId) markDeviceSeenAppTour(userId);
    closeModal();
  };

  const takeTour = () => {
    closeModal();
    useAppTourStore.getState().start();
  };

  return (
    <Modal open={open} onClose={dismiss} title={t('appTour.offer.title')}>
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          {t('appTour.offer.body')}
        </p>
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={dismiss}>{t('appTour.offer.skip')}</Button>
          <Button className="!bg-yellow-400 hover:!bg-yellow-300 !text-black" onClick={takeTour} autoFocus>{t('appTour.offer.takeTour')}</Button>
        </div>
      </div>
    </Modal>
  );
}
