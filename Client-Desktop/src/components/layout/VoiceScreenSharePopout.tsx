import { useEffect, useRef } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useAuthStore } from '../../stores/authStore';
import { useChannelStore } from '../../stores/channelStore';
import { useMediaStore } from '../../stores/mediaStore';
import { useServerStore } from '../../stores/serverStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useVoiceStageStore } from '../../stores/voiceStageStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useViewedChannels } from '../../hooks/useViewedChannels';
import {
  buildLiveKitScreenCandidates,
  LiveKitScreenTile,
  ScreenShareAudioMixer,
} from '../chat/LiveKitScreenShare';

type PopoutStageTile = {
  id: string;
  stream: MediaStream;
  title: string;
  isRemote: boolean;
  liveKitVideoTrack: NonNullable<ReturnType<typeof buildLiveKitScreenCandidates>[number]['liveKitVideoTrack']>;
  remotePublication?: ReturnType<typeof buildLiveKitScreenCandidates>[number]['remotePublication'];
  audioStatus?: ReturnType<typeof buildLiveKitScreenCandidates>[number]['audioStatus'];
  videoTarget?: ReturnType<typeof buildLiveKitScreenCandidates>[number]['videoTarget'];
};

export function VoiceScreenSharePopout() {
  const user = useAuthStore((s) => s.user);
  const activeChannelId = useChannelStore((s) => s.activeChannelId);
  const setActiveChannel = useChannelStore((s) => s.setActiveChannel);
  const channels = useViewedChannels();
  const activeServerUrl = useServerStore((s) => s.activeServerUrl);
  const switchServer = useServerStore((s) => s.switchServer);
  const activeVoiceChannelId = useVoiceStore((s) => s.activeChannelId);
  const voiceServerUrl = useVoiceStore((s) => s.voiceServerUrl);
  const selfVoiceUserId = useVoiceStore((s) => s.selfVoiceUserId);
  const voiceUsers = useVoiceStore((s) => s.users);
  const liveUserIdsByChannel = useVoiceStore((s) => s.liveUserIdsByChannel);
  const mediaVoiceChannelId = useMediaStore((s) => (
    s.activeSession?.context === 'voice' ? s.activeSession.channelId ?? null : null
  ));
  const mediaLocalIdentity = useMediaStore((s) => (
    s.activeSession?.context === 'voice' ? s.activeSession.identity : null
  ));
  const mediaParticipants = useMediaStore((s) => s.participants);
  const mediaRemoteTracks = useMediaStore((s) => s.remoteTracks);
  const setWatchingScreenShare = useMediaStore((s) => s.setWatchingScreenShare);
  const screenshareFps = useSettingsStore((s) => s.screenshareFps);
  const screenshareResolution = useSettingsStore((s) => s.screenshareResolution);
  const joinedRemoteStreamIds = useVoiceStageStore((s) => s.joinedRemoteStreamIds);
  const selectedStageStreamId = useVoiceStageStore((s) => s.selectedStageStreamId);
  const streamAudioVolumeById = useVoiceStageStore((s) => s.streamAudioVolumeById);
  const setJoinedRemoteStreamIds = useVoiceStageStore((s) => s.setJoinedRemoteStreamIds);
  const setSelectedStageStreamId = useVoiceStageStore((s) => s.setSelectedStageStreamId);
  const setStreamAudioVolume = useVoiceStageStore((s) => s.setStreamAudioVolume);
  const clearVoiceStage = useVoiceStageStore((s) => s.clearVoiceStage);
  const previousJoinedRemoteStreamIdsRef = useRef<string[]>([]);

  useEffect(() => {
    if (activeVoiceChannelId) return;
    clearVoiceStage();
  }, [activeVoiceChannelId, clearVoiceStage]);

  useEffect(() => {
    if (!activeVoiceChannelId) return;
    const authoritativeLiveIds = new Set(liveUserIdsByChannel[activeVoiceChannelId] ?? []);
    setJoinedRemoteStreamIds((current) => current.filter((id) => authoritativeLiveIds.has(id)));
    setSelectedStageStreamId((current) => {
      if (!current || current === 'local-screen') return current;
      return authoritativeLiveIds.has(current) ? current : null;
    });
  }, [activeVoiceChannelId, liveUserIdsByChannel, setJoinedRemoteStreamIds, setSelectedStageStreamId]);

  useEffect(() => {
    const previousIds = previousJoinedRemoteStreamIdsRef.current;
    const previousSet = new Set(previousIds);
    const nextSet = new Set(joinedRemoteStreamIds);
    joinedRemoteStreamIds.forEach((id) => {
      if (!previousSet.has(id)) setWatchingScreenShare(id, true);
    });
    previousIds.forEach((id) => {
      if (!nextSet.has(id)) setWatchingScreenShare(id, false);
    });
    previousJoinedRemoteStreamIdsRef.current = joinedRemoteStreamIds;
  }, [joinedRemoteStreamIds, setWatchingScreenShare]);

  useEffect(() => () => {
    previousJoinedRemoteStreamIdsRef.current.forEach((id) => setWatchingScreenShare(id, false));
    previousJoinedRemoteStreamIdsRef.current = [];
  }, [setWatchingScreenShare]);

  if (!activeVoiceChannelId || mediaVoiceChannelId !== activeVoiceChannelId) return null;

  const activeChannel = channels.find((channel) => channel.id === activeChannelId);
  const isCentral = user?.accountType === 'central';
  const viewingServer = !isCentral || !!activeServerUrl;
  const viewingActiveVoiceChannel = viewingServer
    && activeChannelId === activeVoiceChannelId
    && activeChannel?.type === 'voice';
  const selfIdentitySet = new Set(
    [user?.id, selfVoiceUserId, mediaLocalIdentity]
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
  );
  const isSelfIdentity = (id: string | null | undefined) => !!id && selfIdentitySet.has(id);
  const liveKitScreenCandidates = buildLiveKitScreenCandidates({
    active: true,
    tracks: mediaRemoteTracks,
    participants: mediaParticipants,
    voiceUsers,
    selfUserId: mediaLocalIdentity ?? selfVoiceUserId ?? user?.id,
    includeSelf: true,
    audibleParticipantIds: new Set(joinedRemoteStreamIds),
  });
  const liveKitSelfScreenCandidate = liveKitScreenCandidates.find((tile) => isSelfIdentity(tile.id)) ?? null;
  const liveKitRemoteScreenCandidates = liveKitScreenCandidates.filter((tile) => !isSelfIdentity(tile.id));
  const activeRemoteScreenTiles = joinedRemoteStreamIds
    .map((id) => liveKitRemoteScreenCandidates.find((tile) => tile.id === id) ?? null)
    .filter((tile): tile is NonNullable<typeof tile> => Boolean(tile));
  const localScreenShareTarget = { height: screenshareResolution, fps: screenshareFps };
  const stageScreenTiles: PopoutStageTile[] = [
    ...(liveKitSelfScreenCandidate ? [{
      id: 'local-screen',
      stream: liveKitSelfScreenCandidate.stream,
      title: 'Your Screen',
      isRemote: false,
      liveKitVideoTrack: liveKitSelfScreenCandidate.liveKitVideoTrack,
      remotePublication: liveKitSelfScreenCandidate.remotePublication,
      audioStatus: liveKitSelfScreenCandidate.audioStatus,
      videoTarget: liveKitSelfScreenCandidate.videoTarget ?? localScreenShareTarget,
    }] : []),
    ...activeRemoteScreenTiles.map((tile) => ({
      id: tile.id,
      stream: tile.stream,
      title: tile.title,
      isRemote: true,
      liveKitVideoTrack: tile.liveKitVideoTrack,
      remotePublication: tile.remotePublication,
      audioStatus: tile.audioStatus,
      videoTarget: tile.videoTarget,
    })),
  ];
  const primaryStageTile = stageScreenTiles.find((tile) => tile.id === selectedStageStreamId) ?? stageScreenTiles[0] ?? null;

  if (!primaryStageTile || viewingActiveVoiceChannel) return null;

  const getStreamAudioVolumePct = (streamId: string) => streamAudioVolumeById[streamId] ?? 100;
  const secondaryStageAudioSources = stageScreenTiles
    .filter((tile) => (
      tile.isRemote
      && tile.id !== primaryStageTile.id
      && tile.stream.getAudioTracks().length > 0
    ))
    .map((tile) => ({
      id: tile.id,
      stream: tile.stream,
      volumePct: getStreamAudioVolumePct(tile.id),
    }));

  const returnToVoice = () => {
    if (isCentral && voiceServerUrl && activeServerUrl !== voiceServerUrl) {
      switchServer(voiceServerUrl);
    }
    setActiveChannel(activeVoiceChannelId);
  };

  return (
    <div className="fixed bottom-24 right-4 z-40 w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-white/15 bg-[#101322]/95 p-2 shadow-2xl backdrop-blur-md">
      <ScreenShareAudioMixer sources={secondaryStageAudioSources} />
      <div className="mb-2 flex items-center justify-between gap-2 px-1 text-white">
        <button
          type="button"
          onClick={returnToVoice}
          className="min-w-0 truncate text-left text-xs font-semibold text-white/85 hover:text-white"
          title="Return to voice channel"
        >
          {primaryStageTile.title}
        </button>
        <button
          type="button"
          onClick={() => {
            if (primaryStageTile.isRemote) {
              setJoinedRemoteStreamIds((current) => current.filter((id) => id !== primaryStageTile.id));
            } else {
              setSelectedStageStreamId(null);
            }
          }}
          className="shrink-0 rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white"
          title={primaryStageTile.isRemote ? 'Stop watching stream' : 'Hide stream popout'}
          aria-label={primaryStageTile.isRemote ? 'Stop watching stream' : 'Hide stream popout'}
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
      <LiveKitScreenTile
        stream={primaryStageTile.stream}
        title={primaryStageTile.title}
        liveKitVideoTrack={primaryStageTile.liveKitVideoTrack}
        remotePublication={primaryStageTile.remotePublication}
        audioStatus={primaryStageTile.audioStatus}
        videoTarget={primaryStageTile.videoTarget}
        volumePct={primaryStageTile.isRemote ? getStreamAudioVolumePct(primaryStageTile.id) : undefined}
        onVolumePctChange={primaryStageTile.isRemote
          ? (volumePct) => setStreamAudioVolume(primaryStageTile.id, volumePct)
          : undefined}
        onLeave={primaryStageTile.isRemote
          ? () => {
              setJoinedRemoteStreamIds((current) => current.filter((id) => id !== primaryStageTile.id));
              setSelectedStageStreamId((current) => (current === primaryStageTile.id ? null : current));
            }
          : undefined}
        peerId={primaryStageTile.isRemote ? primaryStageTile.id : undefined}
      />
    </div>
  );
}
