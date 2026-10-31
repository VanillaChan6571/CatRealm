import { useState, useMemo } from 'react';
import { X } from 'lucide-react';
import { useChannelStore } from '../../stores/channelStore';
import { useDMStore } from '../../stores/dmStore';
import { useMessageStore } from '../../stores/messageStore';
import { useAuthStore } from '../../stores/authStore';
import { AUTH_BASE } from '../../lib/authApi';
import { resolveAvatarUrl } from '../../utils/avatar';
import { AvatarImage } from '../ui/AvatarImage';
import { formatMessageTime } from '../../utils/formatTime';
import { useSettingsStore } from '../../stores/settingsStore';

interface MediaForwardDialogProps {
  url: string;
  createdAt?: string | number | null;
  onClose: () => void;
}

export function MediaForwardDialog({ url, createdAt, onClose }: MediaForwardDialogProps) {
  const [search, setSearch] = useState('');
  const [forwarded, setForwarded] = useState(false);
  const [sending, setSending] = useState(false);

  const channels = useChannelStore((s) => s.channels);
  const conversations = useDMStore((s) => s.conversations);
  const forwardMedia = useMessageStore((s) => s.forwardMedia);
  const sendDMMessage = useDMStore((s) => s.sendMessage);
  const serverInfo = useAuthStore((s) => s.serverInfo);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const timeFormat = useSettingsStore((s) => s.timeFormat);

  const serverIconUrl = serverInfo?.serverIcon
    ? serverInfo.serverIcon.startsWith('http')
      ? serverInfo.serverIcon
      : `${serverUrl}${serverInfo.serverIcon}`
    : null;

  const timeLabel = createdAt ? formatMessageTime(Number(createdAt), timeFormat) : null;

  const filteredChannels = useMemo(
    () => channels.filter((c) => c.name.toLowerCase().includes(search.toLowerCase())),
    [channels, search]
  );
  const filteredDMs = useMemo(
    () => conversations.filter((c) => c.otherUsername.toLowerCase().includes(search.toLowerCase())),
    [conversations, search]
  );

  // Unix seconds for original timestamp
  const originalAt = createdAt ? Number(createdAt) : Math.floor(Date.now() / 1000);
  const serverName = serverInfo?.name ?? '';

  const handleSendToChannel = (channelId: string) => {
    if (sending) return;
    setSending(true);
    try {
      forwardMedia(channelId, url, { serverName, at: originalAt });
      setForwarded(true);
      setTimeout(onClose, 2500);
    } finally {
      setSending(false);
    }
  };

  const handleSendToDM = async (otherUserId: string) => {
    if (sending) return;
    setSending(true);
    try {
      // DMs are E2E encrypted — encode forwarded metadata as a special JSON payload
      // that MessageFormatter detects and renders as a protected forwarded badge.
      const dmPayload = JSON.stringify({ __catrealm_fwd__: { s: serverName, t: originalAt, u: url } });
      await sendDMMessage(otherUserId, dmPayload);
      setForwarded(true);
      setTimeout(onClose, 2500);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-bg-elevated border border-border rounded-lg w-80 max-h-[70vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="font-semibold text-sm text-text-primary">Forward Media</span>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary"
          >
            <X size={16} />
          </button>
        </div>

        {!forwarded && (
          <div className="px-3 py-2 border-b border-border shrink-0">
            <input
              type="text"
              placeholder="Search channels or DMs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-bg-input border border-border rounded px-3 py-1.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
              autoFocus
            />
          </div>
        )}

        <div className="overflow-y-auto flex-1 py-1">
          {forwarded ? (
            <div className="flex flex-col items-center justify-center py-6 gap-3">
              <div className="flex items-center gap-2 text-accent font-semibold text-sm">
                <span>→</span>
                <span>Forwarded</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-text-muted">
                {serverIconUrl ? (
                  <img
                    src={serverIconUrl}
                    alt={serverInfo?.name ?? 'Server'}
                    className="w-5 h-5 rounded-full object-cover"
                  />
                ) : (
                  <span className="w-5 h-5 rounded-full bg-bg-muted flex items-center justify-center text-[10px] text-text-secondary font-semibold shrink-0">
                    {(serverInfo?.name ?? 'S').charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="text-text-secondary font-medium">{serverInfo?.name ?? 'Server'}</span>
                {timeLabel && (
                  <>
                    <span className="text-text-muted">–</span>
                    <span>{timeLabel}</span>
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              {filteredChannels.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide">
                    Channels
                  </div>
                  {filteredChannels.map((channel) => (
                    <button
                      key={channel.id}
                      onClick={() => handleSendToChannel(channel.id)}
                      disabled={sending}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50"
                    >
                      <span className="text-text-muted">#</span>
                      <span className="truncate">{channel.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {filteredDMs.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide">
                    Direct Messages
                  </div>
                  {filteredDMs.map((conv) => (
                    <button
                      key={conv.otherUserId}
                      onClick={() => handleSendToDM(conv.otherUserId)}
                      disabled={sending}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50"
                    >
                      <AvatarImage
                        src={resolveAvatarUrl(conv.otherAvatar, AUTH_BASE, 'central')}
                        alt={conv.otherUsername}
                        size={24}
                        className="w-6 h-6 rounded-full shrink-0"
                        fallback={
                          <span className="w-6 h-6 rounded-full bg-bg-muted flex items-center justify-center text-xs text-text-secondary">
                            {conv.otherUsername.charAt(0).toUpperCase()}
                          </span>
                        }
                      />
                      <span className="truncate">
                        {conv.otherDisplayName || conv.otherUsername}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {filteredChannels.length === 0 && filteredDMs.length === 0 && (
                <div className="text-center py-6 text-sm text-text-muted">No results</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
