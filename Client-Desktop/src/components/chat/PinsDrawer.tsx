import { useEffect, useState } from 'react';
import { useChannelStore } from '../../stores/channelStore';
import { useMessageStore } from '../../stores/messageStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAuthStore } from '../../stores/authStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { formatMessageTime } from '../../utils/formatTime';
import { PERMISSIONS, hasChannelPermission } from '../../utils/permissions';
import { useViewedChannels } from '../../hooks/useViewedChannels';
import { requestChatMessageJump } from './messageJump';

export function PinsDrawer() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const activeChannelId = useChannelStore((s) => s.activeChannelId);
  const channels = useViewedChannels();
  const pinsByChannel = useMessageStore((s) => s.pinsByChannel);
  const fetchPins = useMessageStore((s) => s.fetchPins);
  const unpinMessage = useMessageStore((s) => s.unpinMessage);
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (activeModal !== 'pins' || !activeChannelId) return;
    setLoading(true);
    fetchPins(activeChannelId).finally(() => setLoading(false));
  }, [activeModal, activeChannelId, fetchPins]);

  const pins = activeChannelId ? (pinsByChannel[activeChannelId] ?? []) : [];
  const activeChannel = channels.find((channel) => channel.id === activeChannelId);
  const canUnpin = hasChannelPermission(user?.permissions, activeChannel?.effective_permissions, PERMISSIONS.PIN_MESSAGES);

  return (
    <Modal open={activeModal === 'pins'} onClose={closeModal} title="Pinned Messages">
      <div className="space-y-3 text-sm">
        {loading && <p className="text-xs text-text-muted">Loading pins...</p>}
        {!loading && pins.length === 0 && (
          <p className="text-xs text-text-muted">No pinned messages in this channel.</p>
        )}
        <div className="max-h-72 overflow-y-auto space-y-2">
          {pins.map((pin) => (
            <div key={pin.message_id} className="rounded border border-border p-2">
              <div className="flex items-center justify-between text-xs text-text-muted">
                <span>{pin.username}</span>
                <span>{formatMessageTime(pin.created_at, timeFormat)}</span>
              </div>
              <p className="text-sm text-text-secondary mt-1 break-words whitespace-pre-wrap">
                {pin.content || '(no text)'}
              </p>
              <div className="flex justify-end gap-2 mt-2">
                <Button variant="secondary" size="sm" onClick={() => {
                  closeModal();
                  requestChatMessageJump({
                    channelId: activeChannelId!,
                    messageId: pin.message_id,
                    timestamp: pin.created_at,
                  });
                }}>
                  Jump to message
                </Button>
                {canUnpin && (
                  <Button variant="ghost" size="sm" onClick={() => unpinMessage(activeChannelId!, pin.message_id)}>
                    Unpin
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={closeModal}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
