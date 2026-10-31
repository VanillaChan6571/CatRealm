import { Smartphone } from 'lucide-react';
import { MicrophoneMutedIcon } from '../voice/VoiceStateIcons';
import type { TheaterUser } from '../../types';
import { isTheaterVoiceDisconnected } from '../../lib/theaterPresence';

export function TheaterPresenceBadge({ user }: { user: Pick<TheaterUser, 'clientType' | 'voiceConnected'> }) {
  const disconnected = isTheaterVoiceDisconnected(user);
  if (user.clientType !== 'mobile' && !disconnected) return null;
  return <span className="inline-flex shrink-0 items-center gap-1 text-[10px]" title={disconnected ? 'Watching theater without voice' : 'Mobile theater viewer'}>
    {user.clientType === 'mobile' && <Smartphone aria-label="Mobile" className="h-3 w-3" />}
    {disconnected && <span className="inline-flex items-center gap-1 text-orange-400">
      <MicrophoneMutedIcon aria-hidden="true" className="h-3 w-3" />
      <span>Not In Call</span>
    </span>}
  </span>;
}
