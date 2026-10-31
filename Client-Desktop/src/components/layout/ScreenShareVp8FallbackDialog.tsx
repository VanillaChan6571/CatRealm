import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

type ScreenShareVp8FallbackModalData = {
  encoderBackend?: ScreenShareVideoEncoderBackend;
  sourceKind?: 'device' | 'desktop' | 'browser' | null;
};

function getModalData(value: unknown): ScreenShareVp8FallbackModalData {
  if (!value || typeof value !== 'object') return {};
  return value as ScreenShareVp8FallbackModalData;
}

export function ScreenShareVp8FallbackDialog() {
  const { t } = useTranslation();
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData);
  const closeModal = useUIStore((s) => s.closeModal);
  const openModal = useUIStore((s) => s.openModal);

  const open = activeModal === 'screenShareVp8Fallback';
  const { encoderBackend, sourceKind } = getModalData(modalData);

  const handleOpenVoiceSettings = () => {
    openModal('profileSettings', { initialTab: 'voice' });
  };

  return (
    <Modal open={open} onClose={closeModal} title={t('settingsContent.ssFallbackTitle')}>
      <div className="space-y-4">
        <div className="flex gap-3 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-amber-100">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-none" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-text-primary">{t('settingsContent.ssFallbackUsingVp8')}</p>
            <p className="text-sm text-text-secondary">
              {t('settingsContent.ssFallbackUsingVp8Desc')}
            </p>
          </div>
        </div>

        <div className="rounded-md bg-bg-input px-3 py-2 text-xs text-text-muted">
          {t('settingsContent.ssFallbackBackend', { backend: encoderBackend ?? t('settingsContent.ssPickerAuto') })}
          {sourceKind ? ` - ${t('settingsContent.ssFallbackSource', { source: sourceKind })}` : ''}
        </div>

        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={closeModal}>
            {t('settingsContent.ssFallbackDismiss')}
          </Button>
          <Button variant="primary" onClick={handleOpenVoiceSettings}>
            {t('settings.navVoice')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
