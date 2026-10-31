import { PhoneIcon, XMarkIcon } from '@heroicons/react/24/solid';
import { Lock, TriangleAlert, Video, Phone } from 'lucide-react';
import { useCallStore } from '../../stores/callStore';
import { resolveAvatarUrl } from '../../utils/avatar';
import { AUTH_BASE } from '../../lib/authApi';

interface DMIncomingCallBannerProps {
  callId: string;
  callerName: string;
  callerAvatar: string | null;
  mediaType: 'audio' | 'video';
  privacyMode: boolean;
}

/**
 * DMIncomingCallBanner - Banner at top of DM view for accepting/declining calls
 */
export function DMIncomingCallBanner({
  callId,
  callerName,
  callerAvatar,
  mediaType,
  privacyMode,
}: DMIncomingCallBannerProps) {
  const answerCall = useCallStore((s) => s.answerCall);
  const callerAvatarUrl = resolveAvatarUrl(callerAvatar ?? undefined, AUTH_BASE, 'central');

  const handleAccept = () => {
    answerCall(callId, true);
  };

  const handleDecline = () => {
    answerCall(callId, false);
  };

  return (
    <div className="border-b border-border">
      {/* Main Banner */}
      <div className="bg-bg-elevated px-4 py-3 flex items-center gap-4">
        {/* Caller Avatar */}
        <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-green-500 shrink-0 animate-pulse">
          {callerAvatarUrl ? (
            <img
              src={callerAvatarUrl}
              alt={callerName}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-gray-600 to-gray-800 flex items-center justify-center text-lg font-bold text-white">
              {callerName[0]?.toUpperCase() || '?'}
            </div>
          )}
        </div>

        {/* Call Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">
            Incoming {mediaType} call from {callerName}
          </p>
          <p className="text-xs text-text-muted">
            <span className="inline-flex items-center gap-1">
              {mediaType === 'video' ? <Video className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
              {mediaType === 'video' ? 'Video call' : 'Voice call'}
            </span>
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Decline Button */}
          <button
            onClick={handleDecline}
            className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 active:scale-95 transition-all flex items-center gap-2 text-white font-medium text-sm"
            title="Decline"
            aria-label="Decline call"
          >
            <XMarkIcon className="w-4 h-4" />
            Decline
          </button>

          {/* Accept Button */}
          <button
            onClick={handleAccept}
            className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 active:scale-95 transition-all flex items-center gap-2 text-white font-medium text-sm"
            title="Accept call"
            aria-label="Accept call"
          >
            <PhoneIcon className="w-4 h-4" />
            Accept
          </button>
        </div>
      </div>

      {/* Privacy Mode Warning Banner */}
      {privacyMode ? (
        // Green banner for Privacy Mode
        <div className="bg-green-500/10 border-t border-green-500/20 px-4 py-2">
          <p className="flex items-center gap-1 text-xs text-green-400 font-medium">
            <Lock className="h-3 w-3 shrink-0" />
            The call is using Privacy Mode. This call uses relays and may fail to connect.
          </p>
        </div>
      ) : (
        // Yellow banner for P2P Mode
        <div className="bg-yellow-500/10 border-t border-yellow-500/20 px-4 py-2">
          <p className="flex items-center gap-1 text-xs text-yellow-400 font-medium">
            <TriangleAlert className="h-3 w-3 shrink-0" />
            The call is Peer 2 Peer. This may expose your IP if you do not trust them.
          </p>
        </div>
      )}
    </div>
  );
}
