import { Lock } from 'lucide-react';
import { CONNECT_TO_VOICE_PERMISSION_MESSAGE } from '../../lib/voicePermissionErrors';
import { useUIStore } from '../../stores/uiStore';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

type VoicePermissionDeniedModalData = {
  channelName?: string | null;
};

function getModalData(value: unknown): VoicePermissionDeniedModalData {
  if (!value || typeof value !== 'object') return {};
  return value as VoicePermissionDeniedModalData;
}

export function VoicePermissionDeniedDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData);
  const closeModal = useUIStore((s) => s.closeModal);

  const open = activeModal === 'voicePermissionDenied';
  const { channelName } = getModalData(modalData);

  return (
    <Modal open={open} onClose={closeModal} title="Cannot Join Voice Channel">
      <div className="space-y-4">
        <div className="flex gap-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-text-primary">
          <div className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-md bg-danger/15 text-danger">
            <Lock className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-text-primary">
              {CONNECT_TO_VOICE_PERMISSION_MESSAGE}
            </p>
            {channelName && (
              <p className="text-xs text-text-muted">{channelName}</p>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="primary" onClick={closeModal}>
            Okay
          </Button>
        </div>
      </div>
    </Modal>
  );
}
