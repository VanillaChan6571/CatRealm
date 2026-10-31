import { AudioDeafenedIcon, AudioListeningIcon, MicrophoneLiveIcon, MicrophoneMutedIcon } from '../voice/VoiceStateIcons';
import { useTranslation } from 'react-i18next';
import {
  ComputerDesktopIcon,
  Cog6ToothIcon,
  ArrowUturnLeftIcon,
  VideoCameraIcon as VideoCameraIconOutline,
} from '@heroicons/react/24/outline';
import {
  MicrophoneIcon,
  PhoneXMarkIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/solid';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useCallStore } from '../../stores/callStore';
import { useUIStore } from '../../stores/uiStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useTheaterStore } from '../../stores/theaterStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useViewedChannels } from '../../hooks/useViewedChannels';
import { AvatarImage } from '../ui/AvatarImage';
import { ScrollText, Shield, Users } from 'lucide-react';
import { resolveAvatarUrl } from '../../utils/avatar';
import { AUTH_BASE } from '../../lib/authApi';
import { PERMISSIONS, hasChannelPermission } from '../../utils/permissions';
import { AudioTracksButton } from '../voice/AudioTracksButton';

type CallDockedControlBarProps = {
  showReturnToCall?: boolean;
  onReturnToCall?: () => void;
};

export function CallDockedControlBar({
  showReturnToCall = false,
  onReturnToCall,
}: CallDockedControlBarProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const openModal = useUIStore((s) => s.openModal);
  const voiceBarRetracted = useUIStore((s) => s.voiceBarRetracted);
  const voiceStreamListRestorable = useUIStore((s) => s.voiceStreamListRestorable);
  const setVoiceStreamListCollapsed = useUIStore((s) => s.setVoiceStreamListCollapsed);
  const toggleVoiceBarRetracted = useUIStore((s) => s.toggleVoiceBarRetracted);

  const activeDMCall = useCallStore((s) => s.activeDMCall);
  const activeGroupCall = useCallStore((s) => s.activeGroupCall);
  const isMuted = useCallStore((s) => s.isMuted);
  const isDeafened = useCallStore((s) => s.isDeafened);
  const isSharingScreen = useCallStore((s) => s.isSharingScreen);
  const toggleMute = useCallStore((s) => s.toggleMute);
  const toggleDeafen = useCallStore((s) => s.toggleDeafen);
  const toggleScreenShare = useCallStore((s) => s.toggleScreenShare);
  const endCall = useCallStore((s) => s.endCall);
  const activeVoiceChannelId = useVoiceStore((s) => s.activeChannelId);
  const voiceMuted = useVoiceStore((s) => s.selfMuted);
  const voiceDeafened = useVoiceStore((s) => s.selfDeafened);
  const toggleVoiceMute = useVoiceStore((s) => s.toggleMute);
  const toggleVoiceDeafen = useVoiceStore((s) => s.toggleDeafen);
  const leaveVoice = useVoiceStore((s) => s.leaveVoice);
  const pushToTalkPressed = useVoiceStore((s) => s.pushToTalkPressed);
  const pressPushToTalk = useVoiceStore((s) => s.pressPushToTalk);
  const releasePushToTalk = useVoiceStore((s) => s.releasePushToTalk);
  const activeTheaterChannelId = useTheaterStore((s) => s.activeChannelId);
  const theaterMicEnabled = useTheaterStore((s) => s.micEnabled);
  const theaterSelfDeafened = useTheaterStore((s) => s.selfDeafened);
  const theaterCameraEnabled = useTheaterStore((s) => s.cameraEnabled);
  const toggleTheaterMic = useTheaterStore((s) => s.toggleMic);
  const toggleTheaterDeafen = useTheaterStore((s) => s.toggleDeafen);
  const toggleTheaterCamera = useTheaterStore((s) => s.toggleCamera);
  const leaveTheater = useTheaterStore((s) => s.leaveTheater);
  const voiceInputMode = useSettingsStore((s) => s.voiceInputMode);
  const channels = useViewedChannels();

  const hasActiveDMCall = !!activeDMCall && activeDMCall.status === 'active';
  const hasActiveGroupCall = !!activeGroupCall && activeGroupCall.status === 'active';
  const hasActiveCall = hasActiveDMCall || hasActiveGroupCall;
  const hasActiveVoice = !!activeVoiceChannelId;
  const hasActiveTheater = !!activeTheaterChannelId;
  const activeCallId = hasActiveDMCall ? activeDMCall.callId : (hasActiveGroupCall ? activeGroupCall.callId : null);
  const theaterMuted = !theaterMicEnabled || theaterSelfDeafened;
  const resolvedMuted = hasActiveCall ? isMuted : hasActiveVoice ? voiceMuted : hasActiveTheater ? theaterMuted : voiceMuted;
  const resolvedDeafened = hasActiveCall ? isDeafened : hasActiveVoice ? voiceDeafened : hasActiveTheater ? theaterSelfDeafened : voiceDeafened;
  const useLargeVoiceButtons = !hasActiveCall && !hasActiveVoice && !hasActiveTheater;
  const showPushToTalk = hasActiveVoice && !hasActiveCall && voiceInputMode === 'push_to_talk';
  const activeTheaterChannel = channels.find((channel) => channel.id === activeTheaterChannelId);
  const canUseTheaterCamera = !!activeTheaterChannel && hasChannelPermission(
    user?.permissions,
    activeTheaterChannel.effective_permissions,
    PERMISSIONS.CAMERA,
  );

  const selfAvatarUrl = resolveAvatarUrl(
    user?.avatar ?? undefined,
    AUTH_BASE,
    user?.accountType === 'central' ? 'central' : undefined,
  );
  const dmAvatarUrl = hasActiveDMCall
    ? resolveAvatarUrl(activeDMCall?.otherAvatar ?? undefined, AUTH_BASE, 'central')
    : null;
  const groupAvatarUrl = hasActiveGroupCall
    ? resolveAvatarUrl(activeGroupCall?.groupAvatar ?? undefined, AUTH_BASE, 'central')
    : null;
  const remoteAvatarUrl = dmAvatarUrl || groupAvatarUrl;
  const remoteLabel = hasActiveDMCall
    ? activeDMCall?.otherUsername
    : (hasActiveGroupCall ? activeGroupCall?.groupName : '');
  const canReturnToCall = hasActiveCall && showReturnToCall && typeof onReturnToCall === 'function';

  const handleScreenShareAction = () => {
    if (!hasActiveCall) return;
    if (isSharingScreen) {
      void toggleScreenShare();
      return;
    }
    openModal('screenSharePicker', { mode: 'pick', context: 'call' });
  };

  const handleToggleMute = () => {
    if (hasActiveCall) {
      toggleMute();
      return;
    }
    if (hasActiveTheater && !hasActiveVoice) {
      void toggleTheaterMic();
      return;
    }
    toggleVoiceMute();
  };

  const handleToggleDeafen = () => {
    if (hasActiveCall) {
      toggleDeafen();
      return;
    }
    if (hasActiveTheater && !hasActiveVoice) {
      toggleTheaterDeafen();
      return;
    }
    toggleVoiceDeafen();
  };

  const handleLeave = () => {
    if (activeCallId) {
      endCall(activeCallId);
      return;
    }
    if (hasActiveVoice) {
      leaveVoice();
      return;
    }
    if (hasActiveTheater) {
      leaveTheater();
    }
  };

  const handleToggleTheaterCamera = () => {
    if (!hasActiveTheater || !canUseTheaterCamera) return;
    void toggleTheaterCamera();
  };

  const openVoiceSettings = () => {
    openModal('profileSettings', { initialTab: 'voice' });
  };

  const handlePushToTalkPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pressPushToTalk();
  };

  return (
    <div
      className="bg-bg-elevated border-t border-border px-2 py-2"
      data-debug-name="Call Docked Control Bar"
      data-debug-file="src/components/layout/CallDockedControlBar.tsx"
    >
      <div className="flex items-center gap-1" data-tour="voice-controls">
        {useLargeVoiceButtons ? (
          <>
            <button
              onClick={handleToggleMute}
              className={`h-9 px-3 rounded-xl flex items-center justify-center gap-2 transition-colors ${
                resolvedMuted ? 'bg-danger text-white' : 'bg-bg-hover text-text-primary hover:bg-bg-input'
              }`}
              title={resolvedMuted ? t('voice.unmuteMic') : t('voice.muteMic')}
              aria-label={resolvedMuted ? t('voice.unmuteMic') : t('voice.muteMic')}
            >
              {resolvedMuted ? <MicrophoneMutedIcon className="w-4 h-4" /> : <MicrophoneLiveIcon className="w-4 h-4" />}
              <span className="text-xs font-medium">{resolvedMuted ? t('voice.muted') : t('voice.muteMicShort')}</span>
            </button>

            <button
              onClick={handleToggleDeafen}
              className={`h-9 px-3 rounded-xl flex items-center justify-center gap-2 transition-colors ${
                resolvedDeafened ? 'bg-danger text-white' : 'bg-bg-hover text-text-primary hover:bg-bg-input'
              }`}
              title={resolvedDeafened ? t('voice.undeafen') : t('voice.deafen')}
              aria-label={resolvedDeafened ? t('voice.undeafenAudio') : t('voice.deafenAudio')}
            >
              {resolvedDeafened ? <AudioDeafenedIcon className="w-4 h-4" /> : <AudioListeningIcon className="w-4 h-4" />}
              <span className="text-xs font-medium">{resolvedDeafened ? t('voice.deafened') : t('voice.deafen')}</span>
            </button>

            {showPushToTalk && (
              <button
                onPointerDown={handlePushToTalkPointerDown}
                onPointerUp={releasePushToTalk}
                onPointerCancel={releasePushToTalk}
                onLostPointerCapture={releasePushToTalk}
                className={`h-9 px-3 rounded-xl flex items-center justify-center gap-2 transition-colors ${
                  pushToTalkPressed ? 'bg-amber-400 text-black' : 'bg-fuchsia-500 text-white hover:bg-fuchsia-400'
                }`}
                title={voiceMuted || voiceDeafened ? 'Unmute and undeafen to use push to talk.' : 'Hold to talk'}
                aria-label="Hold to talk"
              >
                <MicrophoneIcon className="w-4 h-4" />
                <span className="text-xs font-medium">{pushToTalkPressed ? 'Talking' : 'Hold to Talk'}</span>
              </button>
            )}

            <button
              onClick={() => openModal('privacySummary')}
              className="w-9 h-9 rounded-xl flex items-center justify-center bg-bg-hover text-text-primary hover:bg-bg-input transition-colors"
              title="Privacy Summary"
              aria-label="Open privacy summary"
            >
              <Shield className="w-4 h-4" />
            </button>

            <button
              onClick={() => openModal('changelog')}
              className="w-9 h-9 rounded-xl flex items-center justify-center bg-bg-hover text-text-primary hover:bg-bg-input transition-colors"
              title="Changelog"
              aria-label="Open changelog"
            >
              <ScrollText className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleToggleMute}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                resolvedMuted ? 'bg-danger text-white' : 'bg-bg-hover text-text-primary hover:bg-bg-input'
              }`}
              title={resolvedMuted ? t('voice.unmuteMic') : t('voice.muteMic')}
              aria-label={resolvedMuted ? t('voice.unmuteMic') : t('voice.muteMic')}
            >
              {resolvedMuted ? <MicrophoneMutedIcon className="w-4 h-4" /> : <MicrophoneLiveIcon className="w-4 h-4" />}
            </button>

            <button
              onClick={handleToggleDeafen}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                resolvedDeafened ? 'bg-danger text-white' : 'bg-bg-hover text-text-primary hover:bg-bg-input'
              }`}
              title={resolvedDeafened ? t('voice.undeafen') : t('voice.deafen')}
              aria-label={resolvedDeafened ? t('voice.undeafenAudio') : t('voice.deafenAudio')}
            >
              {resolvedDeafened ? <AudioDeafenedIcon className="w-4 h-4" /> : <AudioListeningIcon className="w-4 h-4" />}
            </button>

            {showPushToTalk && (
              <button
                onPointerDown={handlePushToTalkPointerDown}
                onPointerUp={releasePushToTalk}
                onPointerCancel={releasePushToTalk}
                onLostPointerCapture={releasePushToTalk}
                className={`h-9 px-2.5 rounded-full flex items-center justify-center text-[11px] font-semibold transition-colors ${
                  pushToTalkPressed ? 'bg-amber-400 text-black' : 'bg-fuchsia-500 text-white hover:bg-fuchsia-400'
                }`}
                title={voiceMuted || voiceDeafened ? 'Unmute and undeafen to use push to talk.' : 'Hold to talk'}
                aria-label="Hold to talk"
              >
                PTT
              </button>
            )}

            {hasActiveTheater && canUseTheaterCamera && (
              <button
                onClick={handleToggleTheaterCamera}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                  theaterCameraEnabled ? 'bg-accent text-white' : 'bg-bg-hover text-text-primary hover:bg-bg-input'
                }`}
                title={theaterCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
                aria-label={theaterCameraEnabled ? 'Turn theater camera off' : 'Turn theater camera on'}
              >
                {theaterCameraEnabled ? <VideoCameraIcon className="w-4 h-4" /> : <VideoCameraIconOutline className="w-4 h-4" />}
              </button>
            )}

            {hasActiveTheater && (
              <button
                onClick={openVoiceSettings}
                className="w-9 h-9 rounded-full flex items-center justify-center bg-bg-hover text-text-primary hover:bg-bg-input transition-colors"
                title="Voice settings"
                aria-label="Open voice settings"
              >
                <Cog6ToothIcon className="w-4 h-4" />
              </button>
            )}

            <AudioTracksButton className="rounded-full" />
          </>
        )}

        {hasActiveCall && (
          <>
            <button
              onClick={handleScreenShareAction}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                isSharingScreen ? 'bg-success text-white' : 'bg-bg-hover text-text-primary hover:bg-bg-input'
              }`}
              title={isSharingScreen ? 'Stop screen share' : 'Share screen'}
              aria-label={isSharingScreen ? 'Stop screen share' : 'Share screen'}
            >
              <ComputerDesktopIcon className="w-4 h-4" />
            </button>

            {canReturnToCall && (
              <button
                onClick={onReturnToCall}
                className="h-9 px-2 rounded-full bg-bg-hover hover:bg-bg-input text-text-primary transition-colors flex items-center gap-1.5"
                title="Return to call"
                aria-label="Return to call"
              >
                <AvatarImage
                  src={remoteAvatarUrl}
                  alt={remoteLabel || 'Call'}
                  size={22}
                  className="w-[22px] h-[22px] rounded-full object-cover"
                  fallback={(
                    <span className="w-full h-full rounded-full bg-bg-input flex items-center justify-center text-[11px] font-semibold">
                      {remoteLabel?.charAt(0)?.toUpperCase() || (hasActiveGroupCall ? <Users className="h-3 w-3" /> : '?')}
                    </span>
                  )}
                />
                <AvatarImage
                  src={selfAvatarUrl}
                  alt={user?.displayName || user?.username || 'You'}
                  size={22}
                  className="w-[22px] h-[22px] rounded-full object-cover ring-1 ring-accent/70 animate-[pulse_2.4s_ease-in-out_infinite]"
                  fallback={(
                    <span className="w-full h-full rounded-full bg-bg-input flex items-center justify-center text-[11px] font-semibold">
                      {(user?.displayName || user?.username || 'Y').charAt(0).toUpperCase()}
                    </span>
                  )}
                />
                <ArrowUturnLeftIcon className="w-4 h-4" />
              </button>
            )}

            {activeCallId && (
              <button
                onClick={handleLeave}
                className="w-9 h-9 rounded-full flex items-center justify-center bg-danger text-white hover:bg-danger/90 transition-colors"
                title="Leave call"
                aria-label="Leave call"
              >
                <PhoneXMarkIcon className="w-4 h-4" />
              </button>
            )}
          </>
        )}

        {hasActiveVoice && (
          <>
            {voiceStreamListRestorable && (
              <button
                onClick={() => setVoiceStreamListCollapsed(false)}
                className="relative h-9 px-3 rounded-full flex items-center justify-center gap-2 bg-sky-500 text-white shadow-[0_0_12px_rgba(56,189,248,0.45)] hover:bg-sky-400 transition-colors"
                title="Show stream list"
                aria-label="Show stream list"
              >
                <span className="absolute left-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white animate-pulse" />
                <ComputerDesktopIcon className="w-4 h-4" />
                <span className="text-xs font-semibold">Streams</span>
              </button>
            )}
            <button
              data-debug-name="Call Docked Bar: Hide Voice Bar"
              data-debug-file="src/components/layout/CallDockedControlBar.tsx"
              onClick={toggleVoiceBarRetracted}
              className={`h-9 px-3 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                voiceBarRetracted
                  ? 'bg-yellow-400 text-black hover:bg-yellow-300'
                  : 'bg-fuchsia-500 text-white shadow-[0_0_12px_rgba(217,70,239,0.45)] hover:bg-fuchsia-400'
              }`}
              title={voiceBarRetracted ? 'Show voice bar' : 'Hide voice bar'}
              aria-label={voiceBarRetracted ? 'Show voice bar' : 'Hide voice bar'}
            >
              {voiceBarRetracted ? 'Show Bar' : 'Hide Bar'}
            </button>
            {!hasActiveCall && (
              <button
                onClick={handleLeave}
                className="w-9 h-9 rounded-full flex items-center justify-center bg-danger text-white hover:bg-danger/90 transition-colors"
                title="Leave voice"
                aria-label="Leave voice"
              >
                <PhoneXMarkIcon className="w-4 h-4" />
              </button>
            )}
          </>
        )}

        {!hasActiveCall && !hasActiveVoice && hasActiveTheater && (
          <button
            onClick={handleLeave}
            className="w-9 h-9 rounded-full flex items-center justify-center bg-danger text-white hover:bg-danger/90 transition-colors"
            title="Leave theater"
            aria-label="Leave theater"
          >
            <PhoneXMarkIcon className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
