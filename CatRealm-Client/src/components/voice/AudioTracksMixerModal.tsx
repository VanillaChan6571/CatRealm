import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, FlaskConical, Plus, Trash2, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { AvatarImage } from '../ui/AvatarImage';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useMediaStore } from '../../stores/mediaStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useTheaterStore } from '../../stores/theaterStore';
import { useCallStore } from '../../stores/callStore';
import { useAuthStore } from '../../stores/authStore';
import { useBlockedUsersStore } from '../../stores/blockedUsersStore';
import { useAudioTapStore, type AudioTapTrack } from '../../stores/audioTapStore';
import { useAudioOutputDevices } from '../../hooks/useAudioOutputDevices';
import { clearFailedSinksForTrack } from '../../lib/audioTapManager';
import { resolveAvatarUrl } from '../../utils/avatar';
import { AUTH_BASE } from '../../lib/authApi';

type RosterEntry = { userId: string; label: string; avatarUrl: string | null; isSelf: boolean };

function ParticipantChip({
  entry,
  selected,
  onToggle,
  selfLabel,
}: {
  entry: RosterEntry;
  selected: boolean;
  onToggle: () => void;
  selfLabel: string;
}) {
  const label = entry.isSelf ? selfLabel : entry.label;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={`w-full flex items-center gap-2.5 rounded-xl border-2 px-2.5 py-2 text-left transition-all ${
        selected
          ? 'border-success/80 bg-success/10 shadow-[0_0_10px_rgba(34,197,94,0.25)]'
          : 'border-border bg-bg-input/40 hover:border-border hover:bg-bg-hover/60'
      }`}
    >
      <div className={`h-9 w-9 shrink-0 overflow-hidden rounded-full border-2 ${selected ? 'border-success/80' : 'border-border'}`}>
        <AvatarImage
          src={entry.avatarUrl}
          alt={label}
          size={36}
          className="h-full w-full object-cover"
          fallback={(
            <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-600 to-gray-800 text-sm font-semibold text-white">
              {label.charAt(0).toUpperCase() || '?'}
            </span>
          )}
        />
      </div>
      <span className={`min-w-0 flex-1 truncate text-sm font-medium ${selected ? 'text-text-primary' : 'text-text-secondary'}`}>
        {label}
      </span>
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all ${
          selected ? 'bg-success text-white' : 'border border-border text-transparent'
        }`}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    </button>
  );
}

function TrackCard({
  track,
  roster,
  devices,
  mainOutputDeviceId,
}: {
  track: AudioTapTrack;
  roster: RosterEntry[];
  devices: MediaDeviceInfo[];
  mainOutputDeviceId: string;
}) {
  const { t } = useTranslation();
  const removeTrack = useAudioTapStore((s) => s.removeTrack);
  const renameTrack = useAudioTapStore((s) => s.renameTrack);
  const setTrackDevice = useAudioTapStore((s) => s.setTrackDevice);
  const toggleMember = useAudioTapStore((s) => s.toggleMember);
  const removeMember = useAudioTapStore((s) => s.removeMember);
  const tapError = useAudioTapStore((s) => s.tapErrors[track.id]);

  const deviceKnown = !track.outputDeviceId || devices.some((d) => d.deviceId === track.outputDeviceId);
  const sameAsMain = !!track.outputDeviceId && (track.outputDeviceId === mainOutputDeviceId
    || (mainOutputDeviceId === 'default' && track.outputDeviceId === 'default'));
  const rosterIds = new Set(roster.map((r) => r.userId));
  const offlineMembers = track.memberUserIds.filter((id) => !rosterIds.has(id));
  const live = !!track.outputDeviceId && deviceKnown && !tapError;

  return (
    <div className={`flex w-72 shrink-0 flex-col gap-3 rounded-xl border p-4 ${
      live ? 'border-purple-400/40 bg-purple-500/5' : 'border-border bg-bg-hover/30'
    }`}>
      <div className="flex items-center gap-2">
        <span
          className={`flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-[10px] font-semibold uppercase tracking-wide ${
            live ? 'bg-purple-500/20 text-purple-300' : 'bg-bg-input/60 text-text-muted'
          }`}
          title={live ? t('audioTracks.trackLive') : t('audioTracks.trackInactive')}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${live ? 'animate-pulse bg-purple-400 shadow-[0_0_6px_rgba(168,85,247,0.8)]' : 'bg-text-muted/50'}`} />
          {live ? t('audioTracks.trackLive') : t('audioTracks.trackInactive')}
        </span>
        <input
          type="text"
          value={track.name}
          onChange={(e) => renameTrack(track.id, e.target.value)}
          aria-label={t('audioTracks.trackName')}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold text-text-primary hover:border-border focus:border-purple-400/60 focus:bg-bg-input focus:outline-none"
        />
        <button
          type="button"
          onClick={() => removeTrack(track.id)}
          title={t('audioTracks.deleteTrack')}
          aria-label={t('audioTracks.deleteTrack')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div>
        <label className="mb-1 block text-xs text-text-muted">{t('audioTracks.outputDevice')}</label>
        <select
          value={track.outputDeviceId ?? ''}
          onChange={(e) => {
            clearFailedSinksForTrack(track.id);
            setTrackDevice(track.id, e.target.value || null);
          }}
          className="w-full rounded-md border border-border bg-bg-input px-2 py-1.5 text-sm text-text-primary focus:border-purple-400/60 focus:outline-none"
        >
          <option value="">{t('audioTracks.noDevice')}</option>
          {!deviceKnown && track.outputDeviceId && (
            <option value={track.outputDeviceId}>{t('audioTracks.deviceUnavailable')}</option>
          )}
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || d.deviceId}
            </option>
          ))}
        </select>
        {!deviceKnown && (
          <p className="mt-1 text-xs text-amber-400">{t('audioTracks.deviceUnavailableWarning')}</p>
        )}
        {sameAsMain && (
          <p className="mt-1 text-xs text-amber-400">{t('audioTracks.sameAsMainOutputWarning')}</p>
        )}
        {tapError && (
          <p className="mt-1 text-xs text-danger">{t('audioTracks.sinkError')}</p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <p className="mb-1.5 text-xs text-text-muted">{t('audioTracks.participants')}</p>
        {roster.length === 0 && offlineMembers.length === 0 ? (
          <p className="text-xs italic text-text-muted">{t('audioTracks.noParticipants')}</p>
        ) : (
          <div className="flex flex-col gap-1.5 overflow-y-auto pr-0.5">
            {roster.map((entry) => (
              <ParticipantChip
                key={entry.userId}
                entry={entry}
                selected={track.memberUserIds.includes(entry.userId)}
                onToggle={() => toggleMember(track.id, entry.userId)}
                selfLabel={t('audioTracks.you')}
              />
            ))}
            {offlineMembers.map((userId) => (
              <div
                key={userId}
                className="flex items-center gap-2 rounded-xl border-2 border-dashed border-border/60 px-2.5 py-1.5 text-xs text-text-muted"
              >
                <span className="min-w-0 flex-1 truncate">
                  {userId} · {t('audioTracks.notInCall')}
                </span>
                <button
                  type="button"
                  onClick={() => removeMember(track.id, userId)}
                  aria-label={`${t('audioTracks.notInCall')}: ${userId}`}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Cat Lab — per-person audio tracks mixer. */
export function AudioTracksMixerModal() {
  const { t } = useTranslation();
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const open = activeModal === 'audioTracksMixer';

  const tracks = useAudioTapStore((s) => s.tracks);
  const addTrack = useAudioTapStore((s) => s.addTrack);
  const participants = useMediaStore((s) => s.participants);
  const selfIdentity = useMediaStore((s) => s.activeSession?.identity ?? null);
  const blockedUsers = useBlockedUsersStore((s) => s.blockedUsers);
  const mainOutputDeviceId = useSettingsStore((s) => s.voiceOutputDeviceId) ?? 'default';
  const { devices, error, sinkSupported } = useAudioOutputDevices(open);

  // Avatar/name lookups from every call surface; whichever store knows the
  // user wins. The mediaStore roster stays the source of truth for who is
  // actually in the room.
  const voiceUsers = useVoiceStore((s) => s.users);
  const voiceServerUrl = useVoiceStore((s) => s.voiceServerUrl);
  const theaterUsers = useTheaterStore((s) => s.users);
  const activeDMCall = useCallStore((s) => s.activeDMCall);
  const activeGroupCall = useCallStore((s) => s.activeGroupCall);
  const authUser = useAuthStore((s) => s.user);
  const authServerUrl = useAuthStore((s) => s.serverUrl);

  const roster = useMemo<RosterEntry[]>(() => {
    const profiles = new Map<string, { label: string; avatarUrl: string | null }>();
    for (const u of Object.values(voiceUsers)) {
      profiles.set(u.id, {
        label: u.username,
        avatarUrl: resolveAvatarUrl(u.avatar, voiceServerUrl ?? authServerUrl, u.accountType) ?? null,
      });
    }
    for (const u of theaterUsers) {
      profiles.set(u.id, {
        label: u.username,
        avatarUrl: resolveAvatarUrl(u.avatar, u.accountType === 'central' ? null : authServerUrl, u.accountType) ?? null,
      });
    }
    if (activeDMCall) {
      profiles.set(activeDMCall.otherUserId, {
        label: activeDMCall.otherUsername,
        avatarUrl: resolveAvatarUrl(activeDMCall.otherAvatar, AUTH_BASE, 'central') ?? null,
      });
    }
    for (const p of activeGroupCall?.participants ?? []) {
      profiles.set(p.userId, {
        label: p.displayName || p.username,
        avatarUrl: resolveAvatarUrl(p.avatar, AUTH_BASE, 'central') ?? null,
      });
    }

    const entries: RosterEntry[] = [];
    if (selfIdentity) {
      entries.push({
        userId: selfIdentity,
        label: authUser?.displayName || authUser?.username || selfIdentity,
        avatarUrl: resolveAvatarUrl(
          authUser?.avatar ?? null,
          AUTH_BASE,
          authUser?.accountType === 'central' ? 'central' : undefined,
        ) ?? null,
        isSelf: true,
      });
    }
    for (const p of Object.values(participants)) {
      if (p.identity === selfIdentity) continue;
      if (blockedUsers.has(p.identity)) continue;
      const profile = profiles.get(p.identity);
      entries.push({
        userId: p.identity,
        label: profile?.label || p.name || p.identity,
        avatarUrl: profile?.avatarUrl ?? null,
        isSelf: false,
      });
    }
    return entries;
  }, [participants, selfIdentity, blockedUsers, voiceUsers, voiceServerUrl, theaterUsers, activeDMCall, activeGroupCall, authUser, authServerUrl]);

  return (
    <Modal
      open={open}
      onClose={closeModal}
      title={t('audioTracks.title')}
      className="!max-w-[min(64rem,95vw)]"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 text-xs text-text-muted">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-purple-300" />
          <p>{t('audioTracks.description')}</p>
        </div>

        {!sinkSupported && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
            {t('audioTracks.sinkUnsupported')}
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="flex items-stretch gap-4 overflow-x-auto pb-2">
          {tracks.map((track) => (
            <TrackCard
              key={track.id}
              track={track}
              roster={roster}
              devices={devices}
              mainOutputDeviceId={mainOutputDeviceId}
            />
          ))}

          <button
            type="button"
            onClick={addTrack}
            disabled={!sinkSupported}
            className={`flex shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-purple-400/40 bg-purple-500/10 text-purple-300 transition-colors hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-45 ${
              tracks.length === 0 ? 'w-72 py-10' : 'w-32 min-h-[16rem]'
            }`}
          >
            <Plus className="h-5 w-5" />
            <span className="text-sm font-medium">{t('audioTracks.addTrack')}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
