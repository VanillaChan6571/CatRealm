import type { MouseEvent, ReactNode } from 'react';
import { AvatarImage } from '../ui/AvatarImage';

type VoiceParticipantTileProps = {
  name: string;
  avatarUrl: string | null;
  /** From getVoiceRingClass (voiceRing.ts). */
  ringClassName: string;
  /** Shown beside the name (Muted, Live, Calling…). */
  status?: ReactNode;
  /** Camera/video content that replaces the avatar. */
  media?: ReactNode;
  /** Layered over the avatar circle (native camera preview, ringing pulses). */
  avatarOverlay?: ReactNode;
  /** Extra classes on the avatar image wrapper (e.g. the ringing wiggle). */
  avatarClassName?: string;
  /** Replaces the default border + shadow (e.g. the audio-tap glow). */
  highlightClassName?: string;
  /** Square avatar, matching DM chat avatars; server tiles stay round. */
  square?: boolean;
  /** Greyed out: the participant is away (left a DM call that is still open). */
  dimmed?: boolean;
  title?: string;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
};

/**
 * One participant card, as in a server voice channel's gallery. Shared with DM
 * calls so both look the same.
 */
export function VoiceParticipantTile({
  name,
  avatarUrl,
  ringClassName,
  status,
  media,
  avatarOverlay,
  avatarClassName = '',
  highlightClassName,
  square = false,
  dimmed = false,
  title,
  onContextMenu,
}: VoiceParticipantTileProps) {
  const shape = square ? '' : 'rounded-full';
  return (
    <div
      onContextMenu={onContextMenu}
      className={`rounded-2xl border ${highlightClassName ?? 'border-white/10 shadow-[0_12px_30px_rgba(0,0,0,0.18)]'} bg-black/20 backdrop-blur-sm p-3 md:p-4 text-white`}
      title={title}
    >
      <div className={`aspect-video rounded-xl bg-black/20 border border-white/5 overflow-hidden flex items-center justify-center transition-[opacity,filter] ${dimmed ? 'opacity-45 grayscale' : ''}`}>
        {media ?? (
          <div className={`relative w-16 h-16 md:w-20 md:h-20 ${shape} ${ringClassName}`}>
            <div className={`w-full h-full ${shape} avatar-bg flex items-center justify-center text-white text-xl font-semibold overflow-hidden ${avatarClassName}`}>
              <AvatarImage
                src={avatarUrl}
                alt={name}
                size={80}
                className="w-full h-full object-cover"
                fallback={<span>{name.charAt(0).toUpperCase()}</span>}
              />
            </div>
            {avatarOverlay}
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-sm truncate text-white/90">{name}</span>
        {status}
      </div>
    </div>
  );
}
