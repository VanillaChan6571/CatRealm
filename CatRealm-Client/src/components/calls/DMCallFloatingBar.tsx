import {
  AudioDeafenedIcon,
  AudioListeningIcon,
  CameraIcon,
  CameraOffIcon,
  MicrophoneLiveIcon,
  MicrophoneMutedIcon,
  ScreenShareIcon,
} from '../voice/VoiceStateIcons';
import { Phone } from 'lucide-react';
import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useCallStore } from '../../stores/callStore';
import { useUIStore } from '../../stores/uiStore';

type IconButtonProps = {
  label: string;
  title: string;
  active?: boolean;
  danger?: boolean;
  warning?: boolean;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>;

function IconButton({
  label,
  title,
  onClick,
  disabled = false,
  active = false,
  danger = false,
  warning = false,
  children,
  className = '',
  ...buttonProps
}: IconButtonProps) {
  const colorClass = danger
    ? 'bg-danger text-white hover:bg-danger/90'
    : warning
      ? 'bg-warning text-black hover:bg-warning/90'
      : active
        ? 'bg-accent text-white hover:bg-accent-hover'
        : 'bg-bg-hover text-text-primary hover:bg-bg-input';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${colorClass} ${className}`}
      title={title}
      aria-label={label}
      {...buttonProps}
    >
      {children}
    </button>
  );
}

type DMCallFloatingBarProps = {
  onReturnToCall: () => void;
  bottomOffset?: number;
  docked?: boolean;
};

export function DMCallFloatingBar({ onReturnToCall, bottomOffset = 20, docked = false }: DMCallFloatingBarProps) {
  const activeDMCall = useCallStore((s) => s.activeDMCall);
  const isMuted = useCallStore((s) => s.isMuted);
  const isDeafened = useCallStore((s) => s.isDeafened);
  const isSharingScreen = useCallStore((s) => s.isSharingScreen);
  const isVideoEnabled = useCallStore((s) => s.isVideoEnabled);
  const toggleMute = useCallStore((s) => s.toggleMute);
  const toggleDeafen = useCallStore((s) => s.toggleDeafen);
  const toggleScreenShare = useCallStore((s) => s.toggleScreenShare);
  const toggleVideo = useCallStore((s) => s.toggleVideo);
  const endCall = useCallStore((s) => s.endCall);
  const openModal = useUIStore((s) => s.openModal);

  if (!activeDMCall || activeDMCall.status !== 'active') return null;

  const isVideoCall = activeDMCall.mediaType === 'video';

  const handleScreenShareAction = () => {
    if (isSharingScreen) {
      void toggleScreenShare();
      return;
    }
    openModal('screenSharePicker', { mode: 'pick', context: 'call' });
  };

  const handleCameraAction = () => {
    if (isVideoEnabled) {
      toggleVideo();
      return;
    }
    openModal('screenSharePicker', { mode: 'camera', context: 'call' });
  };

  const pillClass = 'flex items-center gap-1 rounded-2xl border border-border bg-bg-elevated/95 px-3 py-2 shadow-2xl backdrop-blur-md';

  const controls = (
    <div className="flex items-center gap-2">
      {/* Group 1: call info + audio controls */}
      <div className={pillClass}>
        <button
          type="button"
          onClick={onReturnToCall}
          className="flex items-center gap-2 pr-2 mr-1 border-r border-border hover:opacity-80 transition-opacity"
          title="Return to call"
          aria-label="Return to call"
        >
          <Phone className="h-4 w-4 text-text-muted shrink-0" />
          <span className="text-sm font-semibold text-text-primary truncate max-w-[160px]">
            {activeDMCall.otherUsername}{activeDMCall.otherConnected === false ? ' · waiting' : ''}
          </span>
        </button>
        <IconButton
          onClick={toggleMute}
          active={isMuted}
          danger={isMuted}
          title={isMuted ? 'Unmute' : 'Mute'}
          label={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <MicrophoneMutedIcon className="h-4 w-4" /> : <MicrophoneLiveIcon className="h-4 w-4" />}
        </IconButton>
        <IconButton
          onClick={toggleDeafen}
          active={isDeafened}
          warning={isDeafened}
          title={isDeafened ? 'Undeafen' : 'Deafen'}
          label={isDeafened ? 'Undeafen' : 'Deafen'}
        >
          {isDeafened ? <AudioDeafenedIcon className="h-4 w-4" /> : <AudioListeningIcon className="h-4 w-4" />}
        </IconButton>
        {isVideoCall && (
          <IconButton
            onClick={handleCameraAction}
            active={isVideoEnabled}
            title={isVideoEnabled ? 'Turn camera off' : 'Turn camera on'}
            label={isVideoEnabled ? 'Turn camera off' : 'Turn camera on'}
          >
            {isVideoEnabled ? <CameraIcon className="h-4 w-4" /> : <CameraOffIcon className="h-4 w-4" />}
          </IconButton>
        )}
      </div>

      {/* Group 2: screen share */}
      <div className={pillClass}>
        <IconButton
          onClick={handleScreenShareAction}
          active={isSharingScreen}
          title={isSharingScreen ? 'Stop screen share' : 'Share screen'}
          label={isSharingScreen ? 'Stop screen share' : 'Share screen'}
        >
          <ScreenShareIcon className="h-4 w-4" />
        </IconButton>
      </div>

      {/* End call */}
      <button
        type="button"
        onClick={() => endCall(activeDMCall.callId)}
        className="h-9 rounded-xl bg-danger px-4 text-xs font-semibold text-white shadow-2xl transition-colors hover:bg-danger/90"
        title="End call"
        aria-label="End call"
      >
        End Call
      </button>
    </div>
  );

  if (docked) {
    return (
      <div className="flex items-center justify-center gap-2 border-t border-border bg-bg-elevated px-3 py-2">
        {controls}
      </div>
    );
  }

  return (
    <div className="fixed left-1/2 -translate-x-1/2 z-50" style={{ bottom: `calc(${bottomOffset}px + var(--mobile-dock-offset, 0px))` }}>
      {controls}
    </div>
  );
}
