import type { ReactNode, PointerEvent as ReactPointerEvent, ButtonHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import {
  AudioDeafenedIcon,
  AudioListeningIcon,
  CameraIcon,
  CameraOffIcon,
  MicrophoneLiveIcon,
  MicrophoneMutedIcon,
  ScreenShareIcon,
  VoiceSettingsIcon,
} from './VoiceStateIcons';
import { AudioTracksButton } from '../components/voice/AudioTracksButton';

type MediaContext = 'voice' | 'dm' | 'group' | 'theater';
type Variant = 'floating' | 'docked' | 'inline';

type MediaControlBarProps = {
  context: MediaContext;
  isMuted: boolean;
  isDeafened: boolean;
  isCameraEnabled?: boolean;
  isScreenSharing?: boolean;
  isPushToTalkMode?: boolean;
  pushToTalkPressed?: boolean;
  onMute: () => void;
  onDeafen: () => void;
  onCamera?: () => void;
  onScreenShare?: () => void;
  onLeave: () => void;
  onVoiceSettings?: () => void;
  onPushToTalk?: (active: boolean) => void;
  onMessageChat?: () => void;
  messageChatOpen?: boolean;
  variant?: Variant;
  /** Optional extra slot rendered between screen share and end buttons */
  extraSlot?: ReactNode;
  /** Slot for audio device dropdown (rendered next to mute button) */
  audioDropdownSlot?: ReactNode;
  /** Slot for video device dropdown (rendered next to camera button) */
  videoDropdownSlot?: ReactNode;
};

type IconButtonProps = {
  label: string;
  title: string;
  active?: boolean;
  danger?: boolean;
  warning?: boolean;
  success?: boolean;
  disabled?: boolean;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>;

function IconButton({
  label,
  title,
  active = false,
  danger = false,
  warning = false,
  success = false,
  disabled = false,
  children,
  className = '',
  onClick,
  ...rest
}: IconButtonProps) {
  const colorClass = danger
    ? 'bg-danger text-white hover:bg-danger/90'
    : warning
      ? 'bg-warning text-black hover:bg-warning/90'
      : success
        ? 'bg-success text-white hover:bg-success/90'
        : active
          ? 'bg-accent text-white hover:bg-accent-hover'
          : 'bg-bg-hover text-text-primary hover:bg-bg-input';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${colorClass} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

const pillClass = 'flex items-center gap-1 rounded-2xl border border-border bg-bg-elevated/95 px-3 py-2 shadow-2xl backdrop-blur-md';
const iconSize = 'w-5 h-5';

export function MediaControlBar({
  context,
  isMuted,
  isDeafened,
  isCameraEnabled = false,
  isScreenSharing = false,
  isPushToTalkMode = false,
  pushToTalkPressed = false,
  onMute,
  onDeafen,
  onCamera,
  onScreenShare,
  onLeave,
  onVoiceSettings,
  onPushToTalk,
  onMessageChat,
  messageChatOpen = false,
  variant = 'docked',
  extraSlot,
  audioDropdownSlot,
  videoDropdownSlot,
}: MediaControlBarProps) {
  const { t } = useTranslation();
  const showCamera = !!onCamera;
  const showScreenShare = !!onScreenShare;
  const showMessageChat = (context === 'dm' || context === 'group') && !!onMessageChat;
  const showVoiceSettings = !!onVoiceSettings;
  const showPtt = isPushToTalkMode && !!onPushToTalk;

  const handlePttPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onPushToTalk?.(true);
  };
  const handlePttPointerUp = () => onPushToTalk?.(false);

  // ── Floating variant: single pill ──────────────────────────────────────────
  if (variant === 'floating') {
    return (
      <div className={pillClass}>
        <IconButton
          onClick={onMute}
          danger={isMuted}
          label={isMuted ? t('voice.unmuteMic') : t('voice.muteMic')}
          title={isMuted ? t('voice.unmuteMic') : t('voice.muteMic')}
        >
          {isMuted ? <MicrophoneMutedIcon className={iconSize} /> : <MicrophoneLiveIcon className={iconSize} />}
        </IconButton>
        {audioDropdownSlot}
        <IconButton
          onClick={onDeafen}
          warning={isDeafened}
          label={isDeafened ? t('voice.undeafenAudio') : t('voice.deafenAudio')}
          title={isDeafened ? t('voice.undeafenAudio') : t('voice.deafenAudio')}
        >
          {isDeafened ? <AudioDeafenedIcon className={iconSize} /> : <AudioListeningIcon className={iconSize} />}
        </IconButton>
        {showCamera && onCamera && (
          <>
            <IconButton
              onClick={onCamera}
              active={isCameraEnabled}
              label={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
              title={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
            >
              {isCameraEnabled ? <CameraIcon className={iconSize} /> : <CameraOffIcon className={iconSize} />}
            </IconButton>
            {videoDropdownSlot}
          </>
        )}
        {showScreenShare && (
          <IconButton
            onClick={onScreenShare}
            active={isScreenSharing}
            label={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
            title={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
          >
            <ScreenShareIcon className={iconSize} />
          </IconButton>
        )}
        {showPtt && (
          <button
            type="button"
            onPointerDown={handlePttPointerDown}
            onPointerUp={handlePttPointerUp}
            onPointerCancel={handlePttPointerUp}
            onLostPointerCapture={handlePttPointerUp}
            className={`h-9 rounded-xl px-3 text-xs font-semibold transition-colors ${
              pushToTalkPressed ? 'bg-amber-400 text-black' : 'bg-fuchsia-500 text-white hover:bg-fuchsia-400'
            }`}
            title="Hold to talk"
            aria-label="Push to talk"
          >
            PTT
          </button>
        )}
        {showVoiceSettings && (
          <IconButton onClick={onVoiceSettings} label="Voice settings" title="Open voice settings">
            <VoiceSettingsIcon className={iconSize} />
          </IconButton>
        )}
        {showMessageChat && (
          <IconButton
            onClick={onMessageChat}
            active={messageChatOpen}
            label={messageChatOpen ? 'Hide chat' : 'Show chat'}
            title={messageChatOpen ? 'Hide chat' : 'Show chat'}
          >
            <ChatBubbleLeftRightIcon className={iconSize} />
          </IconButton>
        )}
        <AudioTracksButton />
        {extraSlot}
        <button
          type="button"
          onClick={onLeave}
          className="h-9 rounded-xl bg-danger px-4 text-xs font-semibold text-white shadow-2xl transition-colors hover:bg-danger/90 ml-1"
          title={context === 'voice' ? 'Disconnect' : 'End call'}
          aria-label={context === 'voice' ? 'Disconnect from voice' : 'End call'}
        >
          {context === 'voice' ? 'Disconnect' : 'End Call'}
        </button>
      </div>
    );
  }

  // ── Docked / inline variant: grouped pills matching VoiceFloatingBar ───────
  return (
    <div className="flex items-center gap-2">
      {/* Group 1: audio + camera controls */}
      <div className={pillClass}>
        <IconButton
          onClick={onMute}
          danger={isMuted}
          label={isMuted ? t('voice.unmuteMic') : t('voice.muteMic')}
          title={isMuted ? t('voice.unmuteMic') : t('voice.muteMic')}
        >
          {isMuted ? <MicrophoneMutedIcon className={iconSize} /> : <MicrophoneLiveIcon className={iconSize} />}
        </IconButton>
        {audioDropdownSlot}
        <IconButton
          onClick={onDeafen}
          warning={isDeafened}
          label={isDeafened ? t('voice.undeafenAudio') : t('voice.deafenAudio')}
          title={isDeafened ? t('voice.undeafenAudio') : t('voice.deafenAudio')}
        >
          {isDeafened ? <AudioDeafenedIcon className={iconSize} /> : <AudioListeningIcon className={iconSize} />}
        </IconButton>
        {showCamera && onCamera && (
          <>
            <IconButton
              onClick={onCamera}
              active={isCameraEnabled}
              label={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
              title={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
            >
              {isCameraEnabled ? <CameraIcon className={iconSize} /> : <CameraOffIcon className={iconSize} />}
            </IconButton>
            {videoDropdownSlot}
          </>
        )}
        {showVoiceSettings && (
          <IconButton onClick={onVoiceSettings} label="Voice settings" title="Open voice settings">
            <VoiceSettingsIcon className={iconSize} />
          </IconButton>
        )}
        {showPtt && (
          <button
            type="button"
            onPointerDown={handlePttPointerDown}
            onPointerUp={handlePttPointerUp}
            onPointerCancel={handlePttPointerUp}
            onLostPointerCapture={handlePttPointerUp}
            className={`h-9 rounded-xl px-3 text-xs font-semibold transition-colors ${
              pushToTalkPressed ? 'bg-amber-400 text-black' : 'bg-fuchsia-500 text-white hover:bg-fuchsia-400'
            }`}
            title="Hold to talk"
            aria-label="Push to talk"
          >
            PTT
          </button>
        )}
      </div>

      {/* Group 2: utilities (screen share, chat) */}
      {(showScreenShare || showMessageChat || extraSlot) && (
        <div className={pillClass}>
          {showScreenShare && (
            <IconButton
              onClick={onScreenShare}
              active={isScreenSharing}
              label={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
              title={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
            >
              <ScreenShareIcon className={iconSize} />
            </IconButton>
          )}
          {showMessageChat && (
            <IconButton
              onClick={onMessageChat}
              active={messageChatOpen}
              label={messageChatOpen ? 'Hide chat' : 'Show chat'}
              title={messageChatOpen ? 'Hide chat' : 'Show chat'}
            >
              <ChatBubbleLeftRightIcon className={iconSize} />
            </IconButton>
          )}
          <AudioTracksButton />
          {extraSlot}
        </div>
      )}

      {/* End call */}
      <button
        type="button"
        onClick={onLeave}
        className="h-9 rounded-xl bg-danger px-4 text-xs font-semibold text-white shadow-2xl transition-colors hover:bg-danger/90"
        title={context === 'voice' ? 'Disconnect' : 'End call'}
        aria-label={context === 'voice' ? 'Disconnect from voice' : 'End call'}
      >
        {context === 'voice' ? 'Disconnect' : 'End Call'}
      </button>
    </div>
  );
}
