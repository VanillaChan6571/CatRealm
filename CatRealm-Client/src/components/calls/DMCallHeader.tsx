import { useEffect, useState } from 'react';
import { defaultAvatarUrl } from '../../utils/avatar';
import { useCallStore } from '../../stores/callStore';
import { useUIStore } from '../../stores/uiStore';
import { useMediaStore } from '../../stores/mediaStore';
import { useAuthStore } from '../../stores/authStore';
import { VoiceParticipantTile } from '../voice/VoiceParticipantTile';
import { getVoiceRingClass } from '../voice/voiceRing';
import { PhoneIcon, PhoneXMarkIcon, XMarkIcon } from '@heroicons/react/24/solid';
import {
  MicrophoneLiveIcon,
  MicrophoneMutedIcon,
  AudioListeningIcon,
  AudioDeafenedIcon,
  CameraIcon,
  CameraOffIcon,
  ScreenShareIcon,
} from '../../voice/VoiceStateIcons';

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

type CtrlBtnProps = {
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  success?: boolean;
  title: string;
  children: React.ReactNode;
};

function CtrlBtn({ onClick, active = false, danger = false, success = false, title, children }: CtrlBtnProps) {
  const base = 'w-14 h-14 rounded-2xl flex items-center justify-center transition-colors';
  const color = danger
    ? 'bg-danger hover:bg-danger/90 text-white'
    : success
      ? 'bg-success hover:bg-success/90 text-white'
      : active
      ? 'bg-accent hover:bg-accent-hover text-white'
      : 'bg-bg-hover hover:bg-bg-input text-text-primary';
  return (
    <button type="button" onClick={onClick} title={title} className={`${base} ${color}`}>
      {children}
    </button>
  );
}

type DMCallHeaderProps = {
  selfAvatarUrl: string | null;
  otherAvatarUrl: string | null;
  selfName: string;
  otherName: string;
};

export function DMCallHeader({ selfAvatarUrl, otherAvatarUrl, selfName, otherName }: DMCallHeaderProps) {
  const activeDMCall = useCallStore((s) => s.activeDMCall);
  const isMuted = useCallStore((s) => s.isMuted);
  const isDeafened = useCallStore((s) => s.isDeafened);
  const isVideoEnabled = useCallStore((s) => s.isVideoEnabled);
  const isSharingScreen = useCallStore((s) => s.isSharingScreen);
  const toggleMute = useCallStore((s) => s.toggleMute);
  const toggleDeafen = useCallStore((s) => s.toggleDeafen);
  const toggleVideo = useCallStore((s) => s.toggleVideo);
  const toggleScreenShare = useCallStore((s) => s.toggleScreenShare);
  const endCall = useCallStore((s) => s.endCall);
  const openModal = useUIStore((s) => s.openModal);
  const statusLabel = useMediaStore((s) => s.statusLabel);
  const selfUserId = useAuthStore((s) => s.user?.id ?? null);
  const callSpeakingByUser = useCallStore((s) => s.callSpeakingByUser);
  const lastEndedDMCall = useCallStore((s) => s.lastEndedDMCall);
  const rejoinCall = useCallStore((s) => s.rejoinCall);
  const clearLastEndedCall = useCallStore((s) => s.clearLastEndedCall);

  const [callDuration, setCallDuration] = useState(0);

  useEffect(() => {
    if (!activeDMCall || activeDMCall.status !== 'active') { setCallDuration(0); return; }
    const iv = setInterval(() => setCallDuration(Math.floor((Date.now() - activeDMCall.startedAt) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [activeDMCall]);

  const iconSize = 'w-6 h-6';

  // You left a call that is still running (the server holds it for the other
  // person for up to 3 minutes). Keep the call pane up, Discord-style, with
  // you greyed out and a Rejoin button, instead of a Join row in the chat.
  if (!activeDMCall && lastEndedDMCall) {
    return (
      <div className="flex flex-col items-center gap-4 pt-8 pb-6 bg-gradient-to-b from-bg-secondary to-bg-primary border-b border-border">
        <div className="grid w-full max-w-xl grid-cols-2 gap-3 px-4 md:gap-4">
          <VoiceParticipantTile
            name={otherName}
            avatarUrl={otherAvatarUrl || defaultAvatarUrl()}
            ringClassName={getVoiceRingClass({ muted: false, deafened: false })}
            status={<span className="text-[10px] text-emerald-300">In call</span>}
            square
          />
          <VoiceParticipantTile
            name={selfName}
            avatarUrl={selfAvatarUrl || defaultAvatarUrl()}
            ringClassName={getVoiceRingClass({ muted: false, deafened: false })}
            status={<span className="text-[10px] text-white/55">{lastEndedDMCall.onOtherDevice ? 'On another device' : 'Not in call'}</span>}
            dimmed
            square
          />
        </div>
        <div className="text-xs text-text-muted">
          {lastEndedDMCall.onOtherDevice
            ? `You're in this call on another device`
            : `You left the ${lastEndedDMCall.mediaType} call · it stays open while ${otherName} is in it`}
        </div>
        <div className="flex items-center gap-4">
          <CtrlBtn onClick={() => void rejoinCall()} success title={lastEndedDMCall.onOtherDevice ? 'Join here' : 'Rejoin call'}>
            <PhoneIcon className={iconSize} />
          </CtrlBtn>
          <CtrlBtn onClick={clearLastEndedCall} title="Dismiss">
            <XMarkIcon className={iconSize} />
          </CtrlBtn>
        </div>
      </div>
    );
  }

  if (!activeDMCall || (activeDMCall.status !== 'active' && activeDMCall.status !== 'ringing')) return null;

  const isRinging = activeDMCall.status === 'ringing';
  const isVideoCall = activeDMCall.mediaType === 'video';

  const otherMuted = activeDMCall.otherMuted ?? false;
  const otherDeafened = activeDMCall.otherDeafened ?? false;
  // Status text styled like a server voice tile's (ChatArea renderParticipantStatus).
  // They left (or dropped) but the call stays open for them for 3 minutes.
  const otherAway = !isRinging && activeDMCall.otherConnected === false;
  const tileStatus = (muted: boolean, deafened: boolean, waiting?: string, away = false) => {
    if (waiting) return <span className="text-[10px] text-emerald-300 animate-pulse">{waiting}</span>;
    if (away) return <span className="text-[10px] text-white/55">Away · can rejoin</span>;
    if (muted || deafened) return <span className="text-[10px] text-amber-300">{deafened ? 'Deafened' : 'Muted'}</span>;
    return <span className="text-[10px] text-emerald-300">Connected</span>;
  };

  const handleCameraAction = () => {
    if (isVideoEnabled) { toggleVideo(); return; }
    openModal('screenSharePicker', { mode: 'camera', context: 'call' });
  };
  const handleScreenShareAction = () => {
    if (isSharingScreen) { void toggleScreenShare(); return; }
    openModal('screenSharePicker', { mode: 'pick', context: 'call' });
  };

  return (
    <>
      <div className="flex flex-col items-center gap-4 pt-8 pb-6 bg-gradient-to-b from-bg-secondary to-bg-primary border-b border-border">
        {/* The same participant tiles as a server voice channel, so DM calls
            and server calls look alike. */}
        <div className="grid w-full max-w-xl grid-cols-2 gap-3 px-4 md:gap-4">
          <VoiceParticipantTile
            name={otherName}
            avatarUrl={otherAvatarUrl || defaultAvatarUrl()}
            ringClassName={getVoiceRingClass(
              { muted: otherMuted, deafened: otherDeafened },
              !isRinging && !!callSpeakingByUser[activeDMCall.otherUserId],
            )}
            status={tileStatus(
              otherMuted,
              otherDeafened,
              isRinging ? 'Ringing…' : undefined,
              otherAway,
            )}
            dimmed={otherAway}
            square
            avatarClassName={isRinging ? 'call-avatar-wiggle' : ''}
            avatarOverlay={isRinging ? (
              <div className="pointer-events-none absolute inset-0">
                <div className="call-ring absolute inset-0 border-2 border-green-500/60" />
                <div className="call-ring call-ring-delayed absolute inset-0 border-2 border-green-500/60" />
              </div>
            ) : undefined}
          />
          <VoiceParticipantTile
            name={selfName}
            avatarUrl={selfAvatarUrl || defaultAvatarUrl()}
            ringClassName={getVoiceRingClass(
              { muted: isMuted, deafened: isDeafened },
              !!(selfUserId && callSpeakingByUser[selfUserId]),
            )}
            status={tileStatus(isMuted, isDeafened)}
            square
          />
        </div>

        {/* Call status / timer */}
        <div className="text-center">
          <div className="text-xs text-text-muted">
            {isRinging
              ? `Calling… · ${activeDMCall.mediaType} call`
              : activeDMCall.otherConnected === false
                ? `Waiting for ${otherName} to rejoin · up to 3 minutes`
                : `${statusLabel === 'Connected' ? formatDuration(callDuration) : statusLabel} · ${activeDMCall.mediaType} call`}
          </div>
        </div>

        {/* Controls */}
        {isRinging ? (
          /* Ringing: only cancel */
          <CtrlBtn onClick={() => endCall(activeDMCall.callId)} danger title="Cancel call">
            <PhoneXMarkIcon className={iconSize} />
          </CtrlBtn>
        ) : (
          /* Active: full controls */
          <div className="flex items-center gap-4">
            <CtrlBtn onClick={toggleMute} danger={isMuted} title={isMuted ? 'Unmute' : 'Mute'}>
              {isMuted ? <MicrophoneMutedIcon className={iconSize} /> : <MicrophoneLiveIcon className={iconSize} />}
            </CtrlBtn>
            <CtrlBtn onClick={toggleDeafen} active={isDeafened} title={isDeafened ? 'Undeafen' : 'Deafen'}>
              {isDeafened ? <AudioDeafenedIcon className={iconSize} /> : <AudioListeningIcon className={iconSize} />}
            </CtrlBtn>
            {isVideoCall && (
              <CtrlBtn onClick={handleCameraAction} active={isVideoEnabled} title={isVideoEnabled ? 'Turn camera off' : 'Turn camera on'}>
                {isVideoEnabled ? <CameraIcon className={iconSize} /> : <CameraOffIcon className={iconSize} />}
              </CtrlBtn>
            )}
            <CtrlBtn onClick={handleScreenShareAction} active={isSharingScreen} title={isSharingScreen ? 'Stop sharing' : 'Share screen'}>
              <ScreenShareIcon className={iconSize} />
            </CtrlBtn>
            <CtrlBtn onClick={() => endCall(activeDMCall.callId)} danger title="End call">
              <PhoneXMarkIcon className={iconSize} />
            </CtrlBtn>
          </div>
        )}
      </div>
    </>
  );
}
