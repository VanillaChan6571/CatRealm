import { useCallStore } from '../../stores/callStore';
import { useDMStore } from '../../stores/dmStore';
import { PhoneXMarkIcon } from '@heroicons/react/24/solid';
import { resolveAvatarUrl } from '../../utils/avatar';
import { AUTH_BASE } from '../../lib/authApi';

export function CallingIndicator() {
  const activeDMCall = useCallStore((s) => s.activeDMCall);
  const endCall = useCallStore((s) => s.endCall);
  const activeConversationId = useDMStore((s) => s.activeConversationId);
  const conversations = useDMStore((s) => s.conversations);

  // Only show when ringing (not yet connected)
  if (!activeDMCall || activeDMCall.status !== 'ringing') {
    return null;
  }

  // Suppress when already viewing the DM for this call (the call header shows it there)
  const activeConv = activeConversationId ? conversations.find((c) => c.id === activeConversationId) : null;
  if (activeConv?.otherUserId === activeDMCall.otherUserId) {
    return null;
  }

  const otherAvatarUrl = resolveAvatarUrl(activeDMCall.otherAvatar ?? undefined, AUTH_BASE, 'central');

  const handleEndCall = (e: React.MouseEvent) => {
    e.stopPropagation();
    endCall(activeDMCall.callId);
  };

  // No side padding: the 56px avatar plus px-3 was 80px in the 72px server bar.
  return (
    <div className="relative w-full py-4 flex flex-col items-center gap-2">
      {/* Animated Avatar with Pulsing Rings */}
      <div className="relative">
        {/* Green rings pulsing out from the avatar */}
        <div className="pointer-events-none absolute inset-0">
          <div className="call-ring absolute inset-0 rounded-full border-2 border-green-500/60" />
          <div className="call-ring call-ring-delayed absolute inset-0 rounded-full border-2 border-green-500/60" />
        </div>

        {/* Avatar wiggles like a ringing phone (keyframes in index.css) */}
        <div className="relative w-14 h-14 rounded-full overflow-hidden border-3 border-green-500 shadow-lg call-avatar-wiggle">
          {otherAvatarUrl ? (
            <img
              src={otherAvatarUrl}
              alt={activeDMCall.otherUsername}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-gray-600 to-gray-800 flex items-center justify-center text-xl font-bold text-white">
              {activeDMCall.otherUsername[0]?.toUpperCase() || '?'}
            </div>
          )}
        </div>
      </div>

      {/* Status Text */}
      <div className="text-center">
        <p className="text-xs font-medium text-text-primary truncate max-w-[60px]">
          Calling...
        </p>
      </div>

      {/* Cancel Button */}
      <button
        onClick={handleEndCall}
        className="w-8 h-8 rounded-full bg-red-500 hover:bg-red-600 text-white transition-colors flex items-center justify-center"
        title="Cancel call"
        aria-label="Cancel call"
      >
        <PhoneXMarkIcon className="w-4 h-4" />
      </button>
    </div>
  );
}
