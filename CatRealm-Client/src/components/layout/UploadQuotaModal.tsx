import { useEffect, useState } from 'react';
import { useUIStore } from '../../stores/uiStore';
import type { UploadQuotaPeriod } from '../../lib/uploadQuota';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

type UploadQuotaModalData = {
  period?: UploadQuotaPeriod;
  nonce?: number;
};

export function UploadQuotaModal() {
  const activeModal = useUIStore((state) => state.activeModal);
  const modalData = useUIStore((state) => state.modalData) as UploadQuotaModalData | null;
  const closeModal = useUIStore((state) => state.closeModal);
  const [shake, setShake] = useState(false);
  const open = activeModal === 'uploadQuota';

  useEffect(() => {
    if (!open) return;
    setShake(false);
    const frame = window.requestAnimationFrame(() => setShake(true));
    const timer = window.setTimeout(() => setShake(false), 400);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [open, modalData?.nonce]);

  const message = modalData?.period === 'day'
    ? 'you reached the max upload for this day'
    : 'you reached the max upload hour';

  return (
    <Modal
      open={open}
      onClose={closeModal}
      title="Upload limit reached"
      className={`!max-w-md border border-danger/40 ${shake ? 'modal-reject-shake' : ''}`}
    >
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">{message}</p>
        <div className="flex justify-end">
          <Button variant="primary" onClick={closeModal}>Okay</Button>
        </div>
      </div>
    </Modal>
  );
}
