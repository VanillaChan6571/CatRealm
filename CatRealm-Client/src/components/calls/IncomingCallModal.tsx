import { useEffect, useMemo, useRef, useState } from 'react';
import { useCallStore } from '../../stores/callStore';
import { useDMStore } from '../../stores/dmStore';
import { useGroupChatStore } from '../../stores/groupChatStore';
import { useServerStore } from '../../stores/serverStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { resolveAvatarUrl } from '../../utils/avatar';
import { groupChatFallbackBackground } from '../../utils/groupChatAvatar';
import { AUTH_BASE } from '../../lib/authApi';
import { Phone, Users, Video } from 'lucide-react';

/**
 * IncomingCallModal - Compact sidebar indicator for incoming calls
 * Click to navigate to the DM or Group Chat conversation
 */
type IncomingCallTab = 'dms' | 'groupChats';

type IncomingCallModalProps = {
  onNavigateToTab?: (tab: IncomingCallTab) => void;
};

const MAX_INCOMING_RINGS = 3;

export function IncomingCallModal({ onNavigateToTab }: IncomingCallModalProps) {
  const incomingDMCalls = useCallStore((s) => s.incomingDMCalls);
  const incomingGroupCalls = useCallStore((s) => s.incomingGroupCalls);
  const activeDMCall = useCallStore((s) => s.activeDMCall);
  const activeGroupCall = useCallStore((s) => s.activeGroupCall);
  const groups = useGroupChatStore((s) => s.groups);
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const streamerMode = useSettingsStore((s) => s.streamerMode);
  const streamerModeDisableSounds = useSettingsStore((s) => s.streamerModeDisableSounds);
  const soundVolumes = useSettingsStore((s) => s.soundVolumes);

  // Get the most recent incoming call (DM or Group)
  const mostRecentDMCall = Object.values(incomingDMCalls)
    .sort((a, b) => b.receivedAt - a.receivedAt)[0];
  const mostRecentGroupCall = Object.values(incomingGroupCalls)
    .filter((call) => call.shouldNotify !== false)
    .sort((a, b) => b.receivedAt - a.receivedAt)[0];

  const incomingCall = useMemo(() => {
    if (!mostRecentDMCall && !mostRecentGroupCall) return null;
    if (!mostRecentDMCall && mostRecentGroupCall) {
      const group = groups.find((item) => item.id === mostRecentGroupCall.groupChatId);
      return {
        kind: 'group' as const,
        callId: mostRecentGroupCall.callId,
        receivedAt: mostRecentGroupCall.receivedAt,
        mediaType: mostRecentGroupCall.mediaType,
        titleName: group?.name || 'Group Chat',
        subtitle: `${mostRecentGroupCall.initiatorName} is calling`,
        groupChatId: mostRecentGroupCall.groupChatId,
        groupAvatar: group?.avatar ?? null,
      };
    }
    if (mostRecentDMCall && !mostRecentGroupCall) {
      return {
        kind: 'dm' as const,
        callId: mostRecentDMCall.callId,
        receivedAt: mostRecentDMCall.receivedAt,
        mediaType: mostRecentDMCall.mediaType,
        titleName: mostRecentDMCall.callerName,
        subtitle: 'Incoming direct call',
        callerId: mostRecentDMCall.callerId,
        callerName: mostRecentDMCall.callerName,
        callerAvatar: mostRecentDMCall.callerAvatar,
      };
    }
    if ((mostRecentDMCall?.receivedAt ?? 0) >= (mostRecentGroupCall?.receivedAt ?? 0)) {
      return {
        kind: 'dm' as const,
        callId: mostRecentDMCall!.callId,
        receivedAt: mostRecentDMCall!.receivedAt,
        mediaType: mostRecentDMCall!.mediaType,
        titleName: mostRecentDMCall!.callerName,
        subtitle: 'Incoming direct call',
        callerId: mostRecentDMCall!.callerId,
        callerName: mostRecentDMCall!.callerName,
        callerAvatar: mostRecentDMCall!.callerAvatar,
      };
    }
    const group = groups.find((item) => item.id === mostRecentGroupCall!.groupChatId);
    return {
      kind: 'group' as const,
      callId: mostRecentGroupCall!.callId,
      receivedAt: mostRecentGroupCall!.receivedAt,
      mediaType: mostRecentGroupCall!.mediaType,
      titleName: group?.name || 'Group Chat',
      subtitle: `${mostRecentGroupCall!.initiatorName} is calling`,
      groupChatId: mostRecentGroupCall!.groupChatId,
      groupAvatar: group?.avatar ?? null,
    };
  }, [groups, mostRecentDMCall, mostRecentGroupCall]);

  const [isVisible, setIsVisible] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeIncomingCallIdRef = useRef<string | null>(null);
  const playbackRequestIdRef = useRef(0);
  const ringCountRef = useRef(0);
  const exhaustedIncomingCallIdRef = useRef<string | null>(null);
  const hasActiveCall = !!(
    (activeDMCall && activeDMCall.status === 'active')
    || (activeGroupCall && activeGroupCall.status === 'active')
  );

  const stopIncomingAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
  };

  useEffect(() => () => {
    stopIncomingAudio();
  }, []);

  useEffect(() => {
    if (incomingCall && !hasActiveCall) {
      setIsVisible(true);

      // Play notification sound with proper volume from settings
      const soundsDisabled = streamerMode && streamerModeDisableSounds;
      if (!soundsDisabled && notificationsEnabled) {
        // Play incoming call sound (looping)
        try {
          const requestId = ++playbackRequestIdRef.current;
          const volume = soundVolumes?.['soundCallIncoming'] ?? 60;
          if (exhaustedIncomingCallIdRef.current === incomingCall.callId) {
            return undefined;
          }
          if (activeIncomingCallIdRef.current === incomingCall.callId && audioRef.current) {
            return undefined;
          }
          activeIncomingCallIdRef.current = incomingCall.callId;
          ringCountRef.current = 0;

          // Import sound candidates and play at most MAX_INCOMING_RINGS times.
          import('../../lib/notificationSounds').then(({ getSoundCandidates }) => {
            if (requestId !== playbackRequestIdRef.current) return;
            const candidates = getSoundCandidates('dm-incoming-call');
            if (candidates.length > 0) {
              stopIncomingAudio();
              const audio = new Audio(candidates[0]);
              audio.volume = volume / 100;
              audio.loop = false;

              const playNextRing = () => {
                if (requestId !== playbackRequestIdRef.current) return;
                if (activeIncomingCallIdRef.current !== incomingCall.callId) return;
                if (ringCountRef.current >= MAX_INCOMING_RINGS) {
                  exhaustedIncomingCallIdRef.current = incomingCall.callId;
                  stopIncomingAudio();
                  return;
                }
                ringCountRef.current += 1;
                audio.currentTime = 0;
                audio.play().catch((err) => {
                  if (err && typeof err === 'object' && 'name' in err && (err as { name?: string }).name === 'AbortError') {
                    return;
                  }
                  console.warn('[Call] Failed to play incoming call sound:', err);
                });
              };

              audio.onended = () => {
                playNextRing();
              };
              audioRef.current = audio;
              playNextRing();
            }
          });
        } catch (err) {
          console.warn('[Call] Failed to setup notification sound:', err);
        }
      }

    }
    if (!incomingCall || hasActiveCall) {
      setIsVisible(false);
      activeIncomingCallIdRef.current = null;
      playbackRequestIdRef.current += 1;
      ringCountRef.current = 0;
      stopIncomingAudio();
    }
    return undefined;
  }, [hasActiveCall, incomingCall, notificationsEnabled, soundVolumes, streamerMode, streamerModeDisableSounds]);

  if (!incomingCall || !isVisible) {
    return null;
  }

  const callerAvatarUrl = incomingCall.kind === 'dm'
    ? resolveAvatarUrl(incomingCall.callerAvatar ?? undefined, AUTH_BASE, 'central')
    : null;
  const groupAvatarUrl = incomingCall.kind === 'group'
    ? resolveAvatarUrl(incomingCall.groupAvatar ?? undefined, AUTH_BASE, 'central')
    : null;
  const groupAvatarBg = incomingCall.kind === 'group'
    ? groupChatFallbackBackground(incomingCall.groupChatId || incomingCall.titleName || 'group-chat')
    : '';

  const handleClick = () => {
    // Navigate to home (away from any server)
    const { goHome } = useServerStore.getState();
    goHome();

    if (incomingCall.kind === 'dm') {
      onNavigateToTab?.('dms');
      void useDMStore.getState().openConversation(
        incomingCall.callerId,
        incomingCall.callerName,
        incomingCall.callerAvatar ?? null,
      );
      return;
    }

    onNavigateToTab?.('groupChats');
    useGroupChatStore.getState().selectGroup(incomingCall.groupChatId);
  };

  return (
    <button
      onClick={handleClick}
      className="relative px-3 py-4 w-full hover:bg-bg-hover transition-colors"
      title={incomingCall.kind === 'dm'
        ? `Incoming call from ${incomingCall.titleName}`
        : `Incoming group call in ${incomingCall.titleName}`
      }
    >
      <div className="relative flex flex-col items-center gap-1.5">
        {/* Rings pulse out from the avatar itself (they used to be centred on
            the whole button, below the avatar and over the text). */}
        <div className="relative">
          <div className="pointer-events-none absolute inset-0">
            <div className="call-ring absolute inset-0 rounded-full border-2 border-green-500/60" />
            <div className="call-ring call-ring-delayed absolute inset-0 rounded-full border-2 border-green-500/60" />
          </div>
          <div className="relative w-14 h-14 rounded-full overflow-hidden border-2 border-green-500 shadow-lg call-avatar-wiggle">
            {incomingCall.kind === 'dm' && callerAvatarUrl ? (
              <img
                src={callerAvatarUrl}
                alt={incomingCall.titleName}
                className="w-full h-full object-cover"
              />
            ) : incomingCall.kind === 'group' && groupAvatarUrl ? (
              <img
                src={groupAvatarUrl}
                alt={incomingCall.titleName}
                className="w-full h-full object-cover"
              />
            ) : incomingCall.kind === 'group' ? (
              <div
                className="w-full h-full flex items-center justify-center text-[24px] leading-none"
                style={{ backgroundColor: groupAvatarBg }}
              >
                <Users className="h-6 w-6" />
              </div>
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-gray-600 to-gray-800 flex items-center justify-center text-xl font-bold text-white">
                {incomingCall.titleName[0]?.toUpperCase() || '?'}
              </div>
            )}
          </div>
        </div>

        {/* Caller Name (truncated) */}
        <p className="text-xs font-semibold text-text-primary text-center truncate w-full px-1">
          {incomingCall.titleName}
        </p>
        <p className="text-[10px] text-text-muted text-center font-medium truncate w-full px-1">
          {incomingCall.subtitle}
        </p>
        <p className="text-[10px] text-green-400 text-center font-medium">
          <span className="inline-flex items-center gap-1">
            {incomingCall.mediaType === 'video' ? <Video className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
            Calling...
          </span>
        </p>
      </div>
    </button>
  );
}
