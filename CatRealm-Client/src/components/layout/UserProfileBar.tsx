import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { AvatarImage } from '../ui/AvatarImage';
import { AUTH_BASE } from '../../lib/authApi';
import { useCallStore } from '../../stores/callStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useTheaterStore } from '../../stores/theaterStore';
import { defaultAvatarUrl, resolveAvatarUrl } from '../../utils/avatar';
import { resolveDisplayName } from '../../utils/displayName';
import { VoiceStatusPanel } from './VoiceStatusPanel';
import { TheaterStatusPanel } from './TheaterStatusPanel';
import { DMCallStatusPanel } from './DMCallStatusPanel';
import { CallDockedControlBar } from './CallDockedControlBar';
import { DesktopUpdateBanner } from '../ui/DesktopUpdateBanner';
import { RadioStatusPanel } from './RadioStatusPanel';
import { useRadioStore } from '../../lib/catRealmRadio';
import { Radio } from 'lucide-react';
import { SettingsLogoutButton } from './SettingsLogoutButton';

type UserProfileBarProps = {
  showDMCallFloatingBar?: boolean;
  onReturnToDMCall?: () => void;
};

export function UserProfileBar({
  showDMCallFloatingBar = false,
  onReturnToDMCall,
}: UserProfileBarProps) {
  const user = useAuthStore((s) => s.user);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const openModal = useUIStore((s) => s.openModal);
  const activeDMCall = useCallStore((s) => s.activeDMCall);
  const activeGroupCall = useCallStore((s) => s.activeGroupCall);
  const isMuted = useCallStore((s) => s.isMuted);
  const isDeafened = useCallStore((s) => s.isDeafened);
  const activeVoiceChannelId = useVoiceStore((s) => s.activeChannelId);
  const selfVoiceMuted = useVoiceStore((s) => s.selfMuted);
  const selfVoiceDeafened = useVoiceStore((s) => s.selfDeafened);
  const activeTheaterChannelId = useTheaterStore((s) => s.activeChannelId);
  const theaterMicEnabled = useTheaterStore((s) => s.micEnabled);
  const theaterSelfDeafened = useTheaterStore((s) => s.selfDeafened);
  const radioStatus = useRadioStore((s) => s.status);
  const toggleRadio = useRadioStore((s) => s.toggle);
  const radioOn = radioStatus === 'playing' || radioStatus === 'loading';
  const avatarBase = user?.accountType === 'central' ? AUTH_BASE : serverUrl;
  const inActiveCall = !!(
    (activeDMCall && activeDMCall.status === 'active')
    || (activeGroupCall && activeGroupCall.status === 'active')
  );
  const inActiveVoice = !!activeVoiceChannelId;
  const inActiveTheater = !!activeTheaterChannelId;
  const ringMuted = inActiveCall
    ? isMuted
    : inActiveVoice
      ? selfVoiceMuted
      : inActiveTheater
        ? (!theaterMicEnabled || theaterSelfDeafened)
        : selfVoiceMuted;
  const ringDeafened = inActiveCall
    ? isDeafened
    : inActiveVoice
      ? selfVoiceDeafened
      : inActiveTheater
        ? theaterSelfDeafened
        : selfVoiceDeafened;
  const selfCallRingClass = (inActiveCall || inActiveVoice || inActiveTheater)
    ? (ringDeafened ? 'ring-2 ring-warning/80' : (ringMuted ? 'ring-2 ring-danger/80' : ''))
    : '';

  return (
    <div
      className="shrink-0"
      data-debug-name="User Profile Bar"
      data-debug-file="src/components/layout/UserProfileBar.tsx"
    >
      <VoiceStatusPanel />
      <TheaterStatusPanel />
      <DMCallStatusPanel />
      <CallDockedControlBar
        showReturnToCall={showDMCallFloatingBar}
        onReturnToCall={onReturnToDMCall}
      />
      <RadioStatusPanel />
      <DesktopUpdateBanner />
      <div className="h-[52px] bg-bg-elevated border-t border-border px-2 flex items-center gap-2">
        <div className={`w-8 h-8 rounded-full avatar-bg flex items-center justify-center text-white text-sm font-semibold shrink-0 overflow-hidden ${selfCallRingClass}`}>
        <AvatarImage
          src={resolveAvatarUrl(user?.avatar, avatarBase, user?.accountType)
            ?? (user?.accountType === 'central' ? defaultAvatarUrl() : null)}
          alt={user?.username ?? 'avatar'}
          size={32}
          className="w-8 h-8 object-cover"
          fallback={<span>{user?.username?.charAt(0).toUpperCase()}</span>}
        />
      </div>
      <button
        type="button"
        data-tour="profile"
        onClick={() => openModal('profileSettings')}
        className="flex-1 min-w-0 text-left rounded px-1 hover:bg-bg-hover/60 transition-colors"
        title="Profile"
      >
        <p className="text-sm text-text-primary font-medium truncate">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full mr-1 align-middle ${
              user?.status === 'away'
                ? 'bg-warning'
                : user?.status === 'sleeping'
                ? 'status-sleeping'
                : user?.status === 'invisible'
                ? 'bg-text-muted'
                : 'bg-success'
            }`}
            title={user?.status ?? 'online'}
          />
          {user ? resolveDisplayName(user.id, user.username, user.displayName) : ''}
        </p>
        <p className="text-xs text-text-muted">{user?.accountType}</p>
      </button>
      <button
        type="button"
        onClick={toggleRadio}
        className={`transition-colors shrink-0 p-1 ${radioOn ? 'text-accent hover:text-accent-hover' : 'text-text-muted hover:text-text-primary'}`}
        title={radioOn ? 'Stop CatRealm Radio' : 'Play CatRealm Radio'}
        aria-pressed={radioOn}
      >
        <Radio size={16} />
      </button>
      <SettingsLogoutButton />
      </div>
    </div>
  );
}
