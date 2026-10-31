import {
  ArrowsPointingOutIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  LockOpenIcon,
  PhoneIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/outline';
import { DevicePhoneMobileIcon } from '@heroicons/react/24/solid';
import { AudioDeafenedIcon, MicrophoneMutedIcon } from '../voice/VoiceStateIcons';
import { useDMKeyHealthStore } from '../../messaging/crypto/dmKeyStore';

type DMConversationHeaderProps = {
  avatarUrl: string;
  avatarAlt: string;
  displayName: string;
  username: string;
  showUsernameSubline?: boolean;
  statusLabel: string;
  statusDotClassName: string;
  clients?: ('desktop' | 'mobile')[];
  isOnline?: boolean;
  peerKeyRecoveryPending?: boolean;
  onBackMobile: () => void;
  onOpenProfile: () => void;
  onShowEncryptionInfo: () => void;
  onShowRetentionSettings: () => void;
  encryptionState?: 'pending' | 'synced' | 'locked';
  onAudioCall?: () => void;
  onSearch?: () => void;
  hideCallButtons?: boolean;
  isInCall?: boolean;
  isRinging?: boolean;
  remoteCallState?: {
    muted?: boolean;
    deafened?: boolean;
    videoEnabled?: boolean;
    sharingScreen?: boolean;
  } | null;
};

export function DMConversationHeader({
  avatarUrl,
  avatarAlt,
  displayName,
  username,
  showUsernameSubline = false,
  statusLabel,
  statusDotClassName,
  clients,
  isOnline = false,
  peerKeyRecoveryPending = false,
  onBackMobile,
  onOpenProfile,
  onShowEncryptionInfo,
  onShowRetentionSettings,
  encryptionState,
  onAudioCall,
  onSearch,
  hideCallButtons = false,
  isInCall = false,
  isRinging = false,
  remoteCallState = null,
}: DMConversationHeaderProps) {
  const remoteRingClass = remoteCallState?.deafened
    ? 'ring-4 ring-warning/70'
    : remoteCallState?.muted
      ? 'ring-4 ring-danger/70'
      : '';

  const encryptionBadge = encryptionState === 'pending'
    ? {
        Icon: LockOpenIcon,
        className: 'text-amber-400 border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 hover:text-amber-300',
        title: 'Not yet end-to-end encrypted — encryption turns on once you both have a set-up device. Messages are still protected in transit.',
      }
    : encryptionState === 'locked'
      ? {
          Icon: ExclamationTriangleIcon,
          className: 'text-red-400 border-red-500/40 bg-red-500/10 hover:bg-red-500/20 hover:text-red-300',
          title: "This device can't read these messages yet. Check Account & Security or wait for key sync.",
        }
      : encryptionState === 'synced' ? {
          Icon: LockClosedIcon,
          className: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 hover:text-emerald-300',
          title: 'Messages are end-to-end encrypted.',
        } : {
          Icon: LockClosedIcon,
          className: 'text-text-muted border-border bg-bg-elevated',
          title: 'Checking encryption status…',
        };
  const proofRequired = useDMKeyHealthStore((s) => s.proofRequired);
  const showEncryptionWarning = encryptionState === 'pending' || encryptionState === 'locked' || proofRequired;
  const warningColorClass = encryptionState === 'locked' ? 'text-red-400' : 'text-amber-400';
  const warningTitle = encryptionState !== 'synced'
    ? encryptionBadge.title
    : 'This device holds encryption keys your other devices are waiting for, but needs a passkey / Windows Hello check before it may share them. Verify this device in Settings → Account & Security.';

  return (
    <div className="px-3 py-3 sm:px-6 sm:py-4 border-b border-border flex items-center gap-2 sm:gap-3">
      <button
        onClick={onBackMobile}
        className="md:hidden text-text-secondary hover:text-text-primary p-1 -ml-2"
        aria-label="Back to conversations"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
      </button>

      <img
        src={avatarUrl}
        alt={avatarAlt}
        className={`w-14 h-14 rounded-full transition-shadow ${remoteRingClass}`}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <h2
            className="font-semibold text-text-primary text-xl hover:underline cursor-pointer truncate"
            onClick={onOpenProfile}
          >
            {displayName}
          </h2>
          {showEncryptionWarning && (
            <ExclamationTriangleIcon
              className={`w-4 h-4 shrink-0 ${warningColorClass}`}
              title={warningTitle}
              aria-label="Encryption not synced"
            />
          )}
        </div>
        {showUsernameSubline && (
          <p className="text-sm text-text-secondary">@{username}</p>
        )}
        {isInCall ? (
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isRinging ? 'bg-green-400' : 'bg-cyan-400'}`} />
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isRinging ? 'bg-green-400' : 'bg-cyan-400'}`} />
            </span>
            <span
              className={`text-sm font-semibold ${isRinging ? 'text-green-300' : 'text-cyan-300'}`}
              style={isRinging
                ? { textShadow: '0 0 8px rgba(74,222,128,0.8), 0 0 20px rgba(74,222,128,0.4)' }
                : { textShadow: '0 0 8px rgba(34,211,238,0.8), 0 0 20px rgba(34,211,238,0.4)' }}
            >
              {isRinging ? 'Calling…' : 'Live Call'}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-base text-text-secondary">
            {peerKeyRecoveryPending && <LockClosedIcon className="h-4 w-4 text-red-400" title="This person requested DM key recovery" aria-label="DM key recovery requested" />}
            <span className={`w-2.5 h-2.5 rounded-full ${statusDotClassName}`} />
            {clients?.includes('mobile') && (
              <DevicePhoneMobileIcon
                className={`w-4 h-4 ${
                  statusDotClassName.includes('warning') || statusDotClassName.includes('yellow') ? 'text-warning'
                  : statusDotClassName.includes('sleeping') || statusDotClassName.includes('indigo') ? 'text-yellow-400'
                  : statusDotClassName.includes('muted') ? 'text-text-muted'
                  : 'text-success'
                }`}
                title={`${statusLabel} (mobile)`}
              />
            )}
            <span>{statusLabel}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-0.5 sm:gap-2 shrink-0">
        {remoteCallState && (
          <div className="flex items-center gap-1">
            {remoteCallState.muted && (
              <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-red-500/20 text-red-300" title="Remote muted">
                <MicrophoneMutedIcon className="w-3.5 h-3.5" />
              </span>
            )}
            {remoteCallState.deafened && (
              <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-amber-500/20 text-amber-300" title="Remote deafened">
                <AudioDeafenedIcon className="w-3.5 h-3.5" />
              </span>
            )}
            {remoteCallState.videoEnabled && (
              <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-sky-500/20 text-sky-300" title="Remote camera enabled">
                <VideoCameraIcon className="w-3.5 h-3.5" />
              </span>
            )}
            {remoteCallState.sharingScreen && (
              <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-fuchsia-500/20 text-fuchsia-300" title="Remote sharing screen">
                <ArrowsPointingOutIcon className="w-3.5 h-3.5" />
              </span>
            )}
          </div>
        )}

        {/* Call Buttons */}
        {!hideCallButtons && onAudioCall && (
          <button
            onClick={onAudioCall}
            disabled={!isOnline}
            className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg bg-bg-elevated hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={isOnline ? 'Start audio call' : 'User is offline'}
            aria-label="Start audio call"
          >
            <PhoneIcon className="w-5 h-5" />
          </button>
        )}

        {onSearch && (
          <button
            onClick={onSearch}
            className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg bg-bg-elevated hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            title="Search messages (Ctrl+F)"
            aria-label="Search messages"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </button>
        )}

        <button
          onClick={onShowEncryptionInfo}
          className={`flex items-center gap-1 text-base transition-colors cursor-help px-2 py-1 rounded-lg border ${encryptionBadge.className}`}
          title={encryptionBadge.title}
        >
          <encryptionBadge.Icon className="w-5 h-5 shrink-0" />
          <span className="hidden sm:inline">E2EE</span>
        </button>

        <button
          onClick={onShowRetentionSettings}
          className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-lg bg-bg-elevated hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
          title="Message retention settings"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </div>
  );
}
