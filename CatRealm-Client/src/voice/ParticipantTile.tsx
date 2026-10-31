import { useEffect, useRef, useState } from 'react';
import { ReactiveAvatarBadge } from '../components/voice/ReactiveAvatarBadge';
import { SpeakerWaveIcon } from '@heroicons/react/24/solid';
import { resolveAvatarUrl } from '../utils/avatar';
import { AUTH_BASE } from '../lib/authApi';
import {
  AudioDeafenedIcon,
  CameraIcon,
  MicrophoneMutedIcon,
  ScreenShareIcon,
} from './VoiceStateIcons';
import { useIsUserTapped, AUDIO_TAP_GLOW_CLASS } from '../stores/audioTapStore';

type RtcState = 'pending' | 'connecting' | 'connected' | 'failed';

type ParticipantTileProps = {
  identity: string;
  displayName: string;
  avatar: string | null;
  accountType?: 'local' | 'central';
  roleColor?: string | null;
  isSelf?: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaking: boolean;
  videoStream?: MediaStream | null;
  volumePct?: number;
  onVolumeChange?: (vol: number) => void;
  rtcState?: RtcState;
  context: 'voice' | 'dm' | 'group' | 'theater';
  isHost?: boolean;
  isSharing?: boolean;
  isCameraEnabled?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
};

function getTileBorderClass(isSpeaking: boolean, isMuted: boolean, isDeafened: boolean) {
  if (isDeafened) return 'border-warning/80 ring-2 ring-warning/50';
  if (isMuted) return 'border-danger/80 ring-2 ring-danger/50';
  if (isSpeaking) return 'border-success/80 ring-2 ring-success/60';
  return 'border-border';
}

function getAvatarRingClass(isSpeaking: boolean, isMuted: boolean, isDeafened: boolean) {
  if (isDeafened) return 'border-warning ring-4 ring-warning/70';
  if (isMuted) return 'border-danger ring-4 ring-danger/70';
  if (isSpeaking) return 'border-success ring-4 ring-success/80';
  return 'border-border';
}

function getStatusLabel(
  isSpeaking: boolean,
  isMuted: boolean,
  isDeafened: boolean,
  isSharing: boolean,
  rtcState: RtcState,
  _context: string,
): { label: string; className: string } {
  if (isSharing) return { label: 'Live', className: 'text-fuchsia-300' };
  if (isDeafened) return { label: 'Deafened', className: 'text-amber-300' };
  if (isMuted) return { label: 'Muted', className: 'text-amber-300' };
  if (rtcState === 'failed') return { label: 'Failed', className: 'text-rose-300' };
  if (rtcState === 'connecting' || rtcState === 'pending') return { label: 'Connecting…', className: 'text-sky-300' };
  if (isSpeaking) return { label: 'Speaking', className: 'text-emerald-300' };
  return { label: 'Connected', className: 'text-emerald-300' };
}

export function ParticipantTile({
  identity,
  displayName,
  avatar,
  accountType,
  isSelf = false,
  isMuted,
  isDeafened,
  isSpeaking,
  videoStream,
  volumePct = 100,
  onVolumeChange,
  rtcState = 'connected',
  context: _context,
  isHost = false,
  isSharing = false,
  isCameraEnabled = false,
  onContextMenu,
}: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [volumeHover, setVolumeHover] = useState(false);
  const [volumePinned, setVolumePinned] = useState(false);
  const showVolumeSlider = (volumeHover || volumePinned) && !!onVolumeChange && !isSelf;

  const avatarUrl = avatar
    ? resolveAvatarUrl(avatar, AUTH_BASE, accountType === 'central' ? 'central' : 'local')
    : null;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (videoStream) {
      el.srcObject = videoStream;
      void el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [videoStream]);

  const isTapped = useIsUserTapped(identity);
  const baseTileBorderClass = getTileBorderClass(isSpeaking, isMuted, isDeafened);
  // Cat Lab audio-tap glow replaces only the neutral border; speaking/muted/
  // deafened states keep precedence, with the glow shadow layered on top.
  const tileBorderClass = isTapped
    ? (baseTileBorderClass === 'border-border'
      ? AUDIO_TAP_GLOW_CLASS
      : `${baseTileBorderClass} shadow-[0_0_14px_rgba(168,85,247,0.55)]`)
    : baseTileBorderClass;
  const avatarRingClass = getAvatarRingClass(isSpeaking, isMuted, isDeafened);
  const status = getStatusLabel(isSpeaking, isMuted, isDeafened, isSharing, rtcState, _context);

  return (
    <div
      className={`relative aspect-video rounded-lg overflow-hidden bg-bg-tertiary border-2 shadow-lg ${tileBorderClass}`}
      data-participant={identity}
      onContextMenu={onContextMenu}
    >
      {videoStream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isSelf}
          className={`w-full h-full object-cover ${isSelf ? 'transform scale-x-[-1]' : ''}`}
        />
      ) : (
        <div className="w-full h-full flex items-start justify-center pt-6">
          <div className={`w-24 h-24 rounded-full overflow-hidden border-4 shadow-lg transition-all ${avatarRingClass} ${isMuted ? 'opacity-70' : ''}`}>
            {avatarUrl && !avatarFailed ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="w-full h-full object-cover"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-gray-600 to-gray-800 flex items-center justify-center text-3xl font-bold text-white">
                {displayName[0]?.toUpperCase() || '?'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Name + status + volume overlay */}
      <div
        className="absolute bottom-2 left-2 right-2 px-2 py-1.5 rounded bg-black/70 backdrop-blur-sm"
        onMouseEnter={() => setVolumeHover(true)}
        onMouseLeave={() => setVolumeHover(false)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              {!isSelf && <ReactiveAvatarBadge identity={identity} name={displayName} />}
              <span className="text-sm text-white font-medium truncate">{isSelf ? 'You' : displayName}</span>
              {isHost && (
                <span className="ml-1 text-[10px] px-1 rounded bg-amber-500/30 text-amber-300 font-medium shrink-0">HOST</span>
              )}
            </div>
            <div className={`text-[10px] ${status.className}`}>{status.label}</div>
          </div>

          <div className="ml-2 shrink-0 flex items-center gap-1.5">
            {!isSelf && onVolumeChange && (
              <button
                type="button"
                className={`inline-flex items-center justify-center w-5 h-5 rounded transition-colors ${
                  showVolumeSlider ? 'bg-emerald-500/30 text-emerald-200' : 'bg-white/10 text-white/80 hover:bg-white/20'
                }`}
                onClick={() => setVolumePinned((p) => !p)}
                title={showVolumeSlider ? 'Hide volume slider' : 'Show volume slider'}
                aria-label={showVolumeSlider ? 'Hide volume slider' : 'Show volume slider'}
              >
                <SpeakerWaveIcon className="w-3.5 h-3.5" />
              </button>
            )}

            {isMuted && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-red-500/20 text-red-300" title="Muted">
                <MicrophoneMutedIcon className="w-3.5 h-3.5" />
              </span>
            )}
            {isDeafened && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-amber-500/20 text-amber-300" title="Deafened">
                <AudioDeafenedIcon className="w-3.5 h-3.5" />
              </span>
            )}
            {isCameraEnabled && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-sky-500/20 text-sky-300" title="Camera on">
                <CameraIcon className="w-3.5 h-3.5" />
              </span>
            )}
            {isSharing && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-fuchsia-500/20 text-fuchsia-300" title="Sharing screen">
                <ScreenShareIcon className="w-3.5 h-3.5" />
              </span>
            )}
            {isSpeaking && !isMuted && (
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" title="Speaking" />
            )}
          </div>
        </div>

        {onVolumeChange && !isSelf && (
          <label
            className={`mt-1.5 flex items-center gap-2 text-[10px] text-white/80 overflow-hidden transition-all duration-150 ${
              showVolumeSlider ? 'max-h-10 opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
            }`}
          >
            <span className="w-8 shrink-0 text-right">{volumePct}%</span>
            <input
              type="range"
              min={0}
              max={300}
              step={5}
              value={volumePct}
              onChange={(e) => onVolumeChange(Number(e.target.value) || 0)}
              className="flex-1 accent-emerald-400"
              aria-label={`Volume for ${displayName}`}
            />
          </label>
        )}
      </div>

      {/* RTC state badge when not connected */}
      {(rtcState === 'failed' || rtcState === 'connecting' || rtcState === 'pending') && (
        <div className="absolute top-2 left-2 z-10">
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            rtcState === 'failed' ? 'bg-rose-500/80 text-white' : 'bg-sky-500/80 text-white'
          }`}>
            {rtcState === 'failed' ? 'Failed' : 'Connecting…'}
          </span>
        </div>
      )}
    </div>
  );
}
