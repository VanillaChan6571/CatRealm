import { Bot as BotIcon, X } from 'lucide-react';
import { useBotStore } from '../../stores/botStore';
import { useAuthStore } from '../../stores/authStore';
import { AvatarImage } from '../ui/AvatarImage';
import { resolveAvatarUrl } from '../../utils/avatar';

// Inline "Only you can see this" bot responses for the active channel.
// Never persisted — dismiss or navigate away and they're gone.
export function EphemeralBotNotices({ channelId }: { channelId: string }) {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const notices = useBotStore((s) => s.ephemeralByChannel[channelId]);
  const dismiss = useBotStore((s) => s.dismissEphemeral);

  if (!notices || notices.length === 0) return null;

  return (
    <div className="px-4 pb-1 space-y-1">
      {notices.map((msg, index) => (
        <div
          key={msg.id ?? `${msg.interactionId ?? index}-${msg.created_at}`}
          className="flex items-start gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2"
        >
          <span className="w-6 h-6 rounded-full overflow-hidden bg-indigo-600/40 flex items-center justify-center text-white shrink-0 mt-0.5">
            <AvatarImage
              src={resolveAvatarUrl(msg.avatar, serverUrl)}
              alt={msg.username}
              size={24}
              className="w-6 h-6 object-cover"
              fallback={<BotIcon className="w-3.5 h-3.5" />}
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="font-semibold text-text-primary">{msg.displayName || msg.username}</span>
              <span className="rounded bg-indigo-600 px-1 py-px text-[9px] font-bold uppercase text-white">BOT</span>
              {msg.interaction && (
                <span className="text-text-muted">/{msg.interaction.command}</span>
              )}
              <span className="text-yellow-400 italic">Only you can see this</span>
            </div>
            <p className="text-sm text-text-primary whitespace-pre-wrap break-words">{msg.content}</p>
          </div>
          <button
            type="button"
            onClick={() => dismiss(channelId, index)}
            className="p-1 rounded hover:bg-bg-hover text-text-muted shrink-0"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
