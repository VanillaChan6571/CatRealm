import {
  AudioDeafenedIcon,
  AudioListeningIcon,
  CameraIcon,
  CameraOffIcon,
  MicrophoneLiveIcon,
  MicrophoneMutedIcon,
  ScreenShareIcon,
} from '../voice/VoiceStateIcons';
import { useTranslation } from 'react-i18next';
import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  ChatBubbleLeftRightIcon,
  Cog6ToothIcon,
  EyeIcon,
  EyeSlashIcon,
  SpeakerWaveIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { useUIStore } from '../../stores/uiStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useAuthStore } from '../../stores/authStore';
import { useCallStore } from '../../stores/callStore';
import { useMediaStore } from '../../stores/mediaStore';
import { PERMISSIONS, hasChannelPermission } from '../../utils/permissions';
import { useSettingsStore } from '../../stores/settingsStore';
import { useViewedChannels } from '../../hooks/useViewedChannels';

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

export function VoiceFloatingBar() {
  const { t } = useTranslation();
  const voiceChannelId = useVoiceStore((s) => s.activeChannelId);
  const voiceChannelName = useVoiceStore((s) => s.voiceChannelName);
  const voiceSelfMuted = useVoiceStore((s) => s.selfMuted);
  const voiceSelfDeafened = useVoiceStore((s) => s.selfDeafened);
  const toggleVoiceMute = useVoiceStore((s) => s.toggleMute);
  const toggleVoiceDeafen = useVoiceStore((s) => s.toggleDeafen);
  const callMuted = useCallStore((s) => s.isMuted);
  const callDeafened = useCallStore((s) => s.isDeafened);
  const toggleCallMute = useCallStore((s) => s.toggleMute);
  const toggleCallDeafen = useCallStore((s) => s.toggleDeafen);
  const callVideoEnabled = useCallStore((s) => s.isVideoEnabled);
  const toggleCallVideo = useCallStore((s) => s.toggleVideo);
  const leaveVoice = useVoiceStore((s) => s.leaveVoice);
  const pushToTalkPressed = useVoiceStore((s) => s.pushToTalkPressed);
  const pressPushToTalk = useVoiceStore((s) => s.pressPushToTalk);
  const releasePushToTalk = useVoiceStore((s) => s.releasePushToTalk);
  const isSharing = useVoiceStore((s) => s.isSharing);
  const channels = useViewedChannels();
  const memberListOpen = useUIStore((s) => s.memberListOpen);
  const voiceChatOpen = useUIStore((s) => s.voiceChatOpen);
  const voiceBarRetracted = useUIStore((s) => s.voiceBarRetracted);
  const toggleMemberList = useUIStore((s) => s.toggleMemberList);
  const toggleVoiceChat = useUIStore((s) => s.toggleVoiceChat);
  const toggleVoiceBarRetracted = useUIStore((s) => s.toggleVoiceBarRetracted);
  const openModal = useUIStore((s) => s.openModal);
  const user = useAuthStore((s) => s.user);
  const activeDMCall = useCallStore((s) => s.activeDMCall);
  const activeGroupCall = useCallStore((s) => s.activeGroupCall);
  const voiceInputMode = useSettingsStore((s) => s.voiceInputMode);
  const mediaVoiceChannelId = useMediaStore((s) => (
    s.activeSession?.context === 'voice' ? s.activeSession.channelId ?? null : null
  ));
  const voiceCameraEnabled = useMediaStore((s) => s.isCameraEnabled);
  const stopVoiceCamera = useMediaStore((s) => s.stopCamera);

  const barRef = useRef<HTMLDivElement | null>(null);
  const channel = channels.find((c) => c.id === voiceChannelId);
  const channelPermissions = channel?.effective_permissions;
  const canShareVideo = !!channel && (
    hasChannelPermission(user?.permissions, channelPermissions, PERMISSIONS.SCREENSHARE)
    || hasChannelPermission(user?.permissions, channelPermissions, PERMISSIONS.CAMERA)
  );
  const hasActiveCall = !!(
    (activeDMCall && activeDMCall.status === 'active')
    || (activeGroupCall && activeGroupCall.status === 'active')
  );
  const selfMuted = hasActiveCall ? callMuted : voiceSelfMuted;
  const selfDeafened = hasActiveCall ? callDeafened : voiceSelfDeafened;
  const handleToggleMute = hasActiveCall ? toggleCallMute : toggleVoiceMute;
  const handleToggleDeafen = hasActiveCall ? toggleCallDeafen : toggleVoiceDeafen;
  const showPushToTalk = !hasActiveCall && voiceInputMode === 'push_to_talk';
  const canUseVoiceCamera = !hasActiveCall && canShareVideo && !!voiceChannelId && mediaVoiceChannelId === voiceChannelId;
  const canUseCamera = hasActiveCall || canUseVoiceCamera;
  const cameraEnabled = hasActiveCall ? callVideoEnabled : voiceCameraEnabled;
  const channelLabel = voiceChannelName ?? channel?.name ?? 'Voice';
  const handleScreenShare = () => {
    if (!canShareVideo) return;
    openModal('screenSharePicker', { mode: isSharing ? 'manage' : 'pick' });
  };

  const handlePushToTalkPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pressPushToTalk();
  };

  useEffect(() => {
    if (!barRef.current) return;
  }, [voiceChannelId]);

  if (!voiceChannelId) return null;

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-50"
      style={{ bottom: 'calc(20px + var(--mobile-dock-offset, 0px))' }}
      data-debug-name="Voice Floating Bar"
      data-debug-file="src/components/layout/VoiceFloatingBar.tsx"
    >
      <div
        ref={barRef}
        className="flex max-w-[calc(100vw-24px)] flex-wrap items-center justify-center gap-2"
      >
        <div
          className="flex min-w-0 items-center gap-2 rounded-2xl border border-border bg-bg-elevated/95 px-3 py-2 shadow-2xl backdrop-blur-md"
          data-debug-name="Voice Floating Bar: Channel Controls"
          data-debug-file="src/components/layout/VoiceFloatingBar.tsx"
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center text-text-muted"
            data-debug-name="Voice Floating Bar: Channel Icon"
            data-debug-file="src/components/layout/VoiceFloatingBar.tsx"
          >
            <SpeakerWaveIcon className="h-4 w-4" />
          </span>
          <span
            className="max-w-[180px] truncate text-sm font-semibold text-text-primary"
            title={channelLabel}
            data-debug-name="Voice Floating Bar: Channel Name"
            data-debug-file="src/components/layout/VoiceFloatingBar.tsx"
          >
            {channelLabel}
          </span>
          <IconButton
            data-debug-name="Voice Floating Bar: Mute Toggle"
            data-debug-file="src/components/layout/VoiceFloatingBar.tsx"
            onClick={handleToggleMute}
            active={selfMuted}
            danger={selfMuted}
            title={selfMuted ? t('voice.unmuteMic') : t('voice.muteMic')}
            label={selfMuted ? t('voice.unmuteMic') : t('voice.muteMic')}
          >
            {selfMuted ? <MicrophoneMutedIcon className="h-4 w-4" /> : <MicrophoneLiveIcon className="h-4 w-4" />}
          </IconButton>
          <IconButton
            data-debug-name="Voice Floating Bar: Deafen Toggle"
            data-debug-file="src/components/layout/VoiceFloatingBar.tsx"
            onClick={handleToggleDeafen}
            active={selfDeafened}
            warning={selfDeafened}
            title={selfDeafened ? t('voice.undeafenAudio') : t('voice.deafenAudio')}
            label={selfDeafened ? t('voice.undeafenAudio') : t('voice.deafenAudio')}
          >
            {selfDeafened ? <AudioDeafenedIcon className="h-4 w-4" /> : <AudioListeningIcon className="h-4 w-4" />}
          </IconButton>
          <IconButton
            data-debug-name="Voice Floating Bar: Camera Toggle"
            data-debug-file="src/components/layout/VoiceFloatingBar.tsx"
            onClick={canUseCamera
              ? hasActiveCall
                ? toggleCallVideo
                : () => {
                    if (voiceCameraEnabled) {
                      void stopVoiceCamera();
                    } else {
                      openModal('screenSharePicker', { mode: 'camera', context: 'voice' });
                    }
                  }
              : undefined}
            disabled={!canUseCamera}
            active={cameraEnabled}
            title={canUseCamera ? (cameraEnabled ? 'Turn camera off' : 'Turn camera on') : 'Camera is available after LiveKit voice connects'}
            label={canUseCamera ? (cameraEnabled ? 'Turn camera off' : 'Turn camera on') : 'Camera unavailable'}
          >
            {cameraEnabled ? <CameraIcon className="h-4 w-4" /> : <CameraOffIcon className="h-4 w-4" />}
          </IconButton>
          <IconButton
            data-debug-name="Voice Floating Bar: Voice Settings"
            data-debug-file="src/components/layout/VoiceFloatingBar.tsx"
            onClick={() => openModal('profileSettings', { initialTab: 'voice' })}
            title="Voice settings"
            label="Open voice settings"
          >
            <Cog6ToothIcon className="h-4 w-4" />
          </IconButton>
        </div>

        {showPushToTalk && (
          <button
            type="button"
            data-debug-name="Voice Floating Bar: Push To Talk"
            data-debug-file="src/components/layout/VoiceFloatingBar.tsx"
            onPointerDown={handlePushToTalkPointerDown}
            onPointerUp={releasePushToTalk}
            onPointerCancel={releasePushToTalk}
            onLostPointerCapture={releasePushToTalk}
            className={`h-9 rounded-xl px-3 text-xs font-semibold transition-colors ${
              pushToTalkPressed ? 'bg-amber-400 text-black' : 'bg-fuchsia-500 text-white hover:bg-fuchsia-400'
            } shadow-2xl`}
            title={selfMuted || selfDeafened ? 'Unmute and undeafen to use push to talk.' : 'Hold to talk'}
            aria-label="Hold to talk"
          >
            PTT
          </button>
        )}

        <div
          className="flex items-center gap-1 rounded-2xl border border-border bg-bg-elevated/95 px-3 py-2 shadow-2xl backdrop-blur-md"
          data-debug-name="Voice Floating Bar: Utility Controls"
          data-debug-file="src/components/layout/VoiceFloatingBar.tsx"
        >
          <IconButton
            data-debug-name="Voice Floating Bar: Screen Share"
            data-debug-file="src/components/layout/VoiceFloatingBar.tsx"
            onClick={handleScreenShare}
            disabled={!canShareVideo}
            active={isSharing}
            title={!canShareVideo ? 'You do not have permission to share video' : (isSharing ? 'Manage screen share' : 'Share screen')}
            label={isSharing ? 'Manage screen share' : 'Share screen'}
          >
            <ScreenShareIcon className="h-4 w-4" />
          </IconButton>
          <IconButton
            data-debug-name="Voice Floating Bar: Member List Toggle"
            data-debug-file="src/components/layout/VoiceFloatingBar.tsx"
            onClick={toggleMemberList}
            active={memberListOpen}
            title={memberListOpen ? 'Hide member list' : 'Show member list'}
            label={memberListOpen ? 'Hide member list' : 'Show member list'}
          >
            <UserGroupIcon className="h-4 w-4" />
          </IconButton>
          <IconButton
            data-debug-name="Voice Floating Bar: Voice Chat Toggle"
            data-debug-file="src/components/layout/VoiceFloatingBar.tsx"
            onClick={toggleVoiceChat}
            active={voiceChatOpen}
            title={voiceChatOpen ? 'Hide voice chat' : 'Show voice chat'}
            label={voiceChatOpen ? 'Hide voice chat' : 'Show voice chat'}
          >
            <ChatBubbleLeftRightIcon className="h-4 w-4" />
          </IconButton>
          <IconButton
            data-debug-name="Voice Floating Bar: Hide"
            data-debug-file="src/components/layout/VoiceFloatingBar.tsx"
            onClick={toggleVoiceBarRetracted}
            title={voiceBarRetracted ? 'Show voice bar' : 'Hide voice bar'}
            label={voiceBarRetracted ? 'Show voice bar' : 'Hide voice bar'}
          >
            {voiceBarRetracted ? <EyeIcon className="h-4 w-4" /> : <EyeSlashIcon className="h-4 w-4" />}
          </IconButton>
        </div>

        <button
          data-debug-name="Voice Floating Bar: Leave"
          data-debug-file="src/components/layout/VoiceFloatingBar.tsx"
          onClick={leaveVoice}
          className="h-9 rounded-xl bg-danger px-4 text-xs font-semibold text-white shadow-2xl transition-colors hover:bg-danger/90"
          title="Disconnect from voice"
          aria-label="Disconnect from voice"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
