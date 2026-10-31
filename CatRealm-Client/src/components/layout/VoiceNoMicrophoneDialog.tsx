import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { Button } from '../ui/Button';

type VoiceNoMicrophoneModalData = {
  channelId?: string;
  channelName?: string | null;
  errorName?: string | null;
};

function getModalData(value: unknown): VoiceNoMicrophoneModalData {
  if (!value || typeof value !== 'object') return {};
  return value as VoiceNoMicrophoneModalData;
}

export function VoiceNoMicrophoneDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData);
  const closeModal = useUIStore((s) => s.closeModal);
  const openModal = useUIStore((s) => s.openModal);

  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  if (activeModal !== 'voiceNoMicrophone') return null;

  const { channelId, channelName, errorName } = getModalData(modalData);

  // The permission was actively denied (vs. no device / device busy), so
  // re-requesting can recover it — the desktop shells auto-grant for the app
  // origin, and even a manual block can be re-prompted here.
  const isPermissionDenied = errorName === 'NotAllowedError' || errorName === 'SecurityError';

  const handleJoinMuted = () => {
    if (channelId) {
      void useVoiceStore.getState().joinVoice(channelId, { allowNoMicrophone: true });
    }
    closeModal();
  };

  const handleOpenVoiceSettings = () => {
    openModal('profileSettings', { initialTab: 'voice' });
  };

  // Backup path: re-execute the microphone permission request. On success we
  // drop the temporary probe stream and retry the original join.
  const handleGrantAndRetry = async () => {
    setRequesting(true);
    setRequestError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getTracks().forEach((track) => track.stop());
      closeModal();
      if (channelId) {
        void useVoiceStore.getState().joinVoice(channelId);
      }
    } catch (error) {
      const name = (error as { name?: string })?.name ?? 'Error';
      setRequestError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone access is still blocked. Enable it in Windows Settings → Privacy & security → Microphone, then try again.'
          : `Could not access a microphone (${name}). Check that one is connected and not in use by another app.`,
      );
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-bg-elevated shadow-xl">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-warning/15 text-warning">
            <AlertTriangle size={20} aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              {isPermissionDenied ? 'Microphone access blocked' : 'Microphone unavailable'}
            </h2>
            {channelName && (
              <p className="text-xs text-text-muted">{channelName}</p>
            )}
          </div>
        </div>

        <div className="space-y-3 px-5 py-4 text-sm text-text-secondary">
          {isPermissionDenied ? (
            <>
              <p>
                CatRealm's access to your microphone was denied. Choose{' '}
                <span className="font-medium text-text-primary">Grant microphone access</span> to
                request it again — no restart needed.
              </p>
              <p>
                Or join without a mic; you won't be able to talk until access is granted.
              </p>
            </>
          ) : (
            <>
              <p>
                Your system does not have a microphone, or CatRealm cannot access it. Would you like
                to still join?
              </p>
              <p>
                You will not be able to talk until you configure a microphone in your system settings
                or CatRealm voice settings.
              </p>
            </>
          )}
          {requestError ? (
            <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">{requestError}</p>
          ) : (
            errorName && (
              <p className="rounded-md bg-bg-secondary px-3 py-2 text-xs text-text-muted">
                Device error: {errorName}
              </p>
            )
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-3 rounded-b-lg bg-bg-secondary px-5 py-4">
          <Button variant="secondary" size="sm" onClick={closeModal} disabled={requesting}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleOpenVoiceSettings}
            disabled={requesting}
          >
            Voice Settings
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleJoinMuted}
            disabled={!channelId || requesting}
          >
            Join Muted
          </Button>
          <Button variant="primary" size="sm" onClick={handleGrantAndRetry} disabled={requesting}>
            {requesting
              ? 'Requesting…'
              : isPermissionDenied
                ? 'Grant microphone access'
                : 'Retry microphone'}
          </Button>
        </div>
      </div>
    </div>
  );
}
