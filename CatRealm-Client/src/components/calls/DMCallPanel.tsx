import { useEffect, useState } from 'react';
import { useCallStore } from '../../stores/callStore';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useUIStore } from '../../stores/uiStore';
import { useMediaStore } from '../../stores/mediaStore';
import { ParticipantTile } from '../../voice/ParticipantTile';
import { MediaControlBar } from '../../voice/MediaControlBar';
import { VideoStreamTile } from '../../voice/VideoStreamTile';
import { useSpeakingDetector } from '../../voice/hooks/useSpeakingDetector';
import { writeClipboardText } from '../../lib/clipboard';

type DMCallPanelProps = {
  messageChatOpen?: boolean;
  onToggleMessageChat?: () => void;
};

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function DMCallPanel({ messageChatOpen = false, onToggleMessageChat }: DMCallPanelProps) {
  const user = useAuthStore((s) => s.user);
  const activeDMCall = useCallStore((s) => s.activeDMCall);
  const localStream = useCallStore((s) => s.localStream);
  const isMuted = useCallStore((s) => s.isMuted);
  const isDeafened = useCallStore((s) => s.isDeafened);
  const isVideoEnabled = useCallStore((s) => s.isVideoEnabled);
  const isSharingScreen = useCallStore((s) => s.isSharingScreen);
  const callNotice = useCallStore((s) => s.notice);
  const toggleMute = useCallStore((s) => s.toggleMute);
  const toggleDeafen = useCallStore((s) => s.toggleDeafen);
  const toggleVideo = useCallStore((s) => s.toggleVideo);
  const toggleScreenShare = useCallStore((s) => s.toggleScreenShare);
  const endCall = useCallStore((s) => s.endCall);
  const debugCallingStates = useSettingsStore((s) => s.debugCallingStates);
  const peerVolumeByUser = useVoiceStore((s) => s.peerVolumeByUser);
  const setPeerVolume = useVoiceStore((s) => s.setPeerVolume);
  const loadCentralPeerVolumes = useVoiceStore((s) => s.loadCentralPeerVolumes);
  const callSpeakingByUser = useCallStore((s) => s.callSpeakingByUser);
  const setCallSpeaking = useCallStore((s) => s.setCallSpeaking);
  const openModal = useUIStore((s) => s.openModal);
  const remoteTracks = useMediaStore((s) => s.remoteTracks);
  const localCameraStream = useMediaStore((s) => s.localCameraStream);
  const connectionState = useMediaStore((s) => s.connectionState);
  const statusLabel = useMediaStore((s) => s.statusLabel);

  const [callDuration, setCallDuration] = useState(0);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [localRms, setLocalRms] = useState(0);
  const [watchingRemoteShare, setWatchingRemoteShare] = useState(false);
  const [debugCopied, setDebugCopied] = useState(false);

  useSpeakingDetector(localStream, !!activeDMCall && !isMuted, setLocalSpeaking, setLocalRms, 'local');

  useEffect(() => {
    if (!activeDMCall || !user?.id) return;
    setCallSpeaking(user.id, localSpeaking);
  }, [activeDMCall, localSpeaking, setCallSpeaking, user?.id]);

  useEffect(() => {
    if (!activeDMCall) {
      setCallDuration(0);
      return;
    }
    const interval = setInterval(() => {
      setCallDuration(Math.floor((Date.now() - activeDMCall.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [activeDMCall]);

  useEffect(() => {
    setWatchingRemoteShare(false);
  }, [activeDMCall?.otherUserId, activeDMCall?.callId]);

  useEffect(() => {
    if (user?.accountType !== 'central') return;
    void loadCentralPeerVolumes();
  }, [user?.accountType, user?.id, loadCentralPeerVolumes]);

  if (!activeDMCall || activeDMCall.status !== 'active') return null;

  const otherUserId = activeDMCall.otherUserId;
  const remoteVolumePct = peerVolumeByUser[otherUserId] ?? 50;

  const remoteScreenTrack = Object.values(remoteTracks).find(
    (t) => t.participantId === otherUserId && t.source === 'screen_share' && t.kind === 'video',
  );
  const remoteCameraTrack = Object.values(remoteTracks).find(
    (t) => t.participantId === otherUserId && t.source === 'camera' && t.kind === 'video',
  );
  const remoteScreenStream = remoteScreenTrack?.mediaStream ?? null;
  const remoteCameraStream = remoteCameraTrack?.mediaStream ?? null;

  const remoteSpeaking = callSpeakingByUser[otherUserId] ?? false;
  const remoteMuted = !!activeDMCall.otherMuted;
  const remoteDeafened = !!activeDMCall.otherDeafened;
  const remoteSharingScreen = !!activeDMCall.otherSharingScreen;
  const remoteVideoEnabled = activeDMCall.otherVideoEnabled ?? (activeDMCall.mediaType === 'video');

  const remoteShareAvailable = remoteSharingScreen && !!remoteScreenStream;
  const showRemoteSharePreview = remoteShareAvailable && watchingRemoteShare;
  const showRemoteCameraInBox = remoteVideoEnabled && !remoteSharingScreen && !!remoteCameraStream;
  const showLocalCameraInBox = isVideoEnabled && !isSharingScreen && !!localCameraStream;

  // Local share preview for the sharer
  const localScreenShareStream = useMediaStore((s) => s.localScreenShareStream);
  const showLocalSharePreview = isSharingScreen && !!localScreenShareStream;

  const handleEndCall = () => endCall(activeDMCall.callId);
  const handleScreenShareAction = () => {
    if (isSharingScreen) {
      void toggleScreenShare();
      return;
    }
    openModal('screenSharePicker', { mode: 'pick', context: 'call' });
  };
  const handleCameraAction = () => {
    if (isVideoEnabled) {
      toggleVideo();
      return;
    }
    openModal('screenSharePicker', { mode: 'camera', context: 'call' });
  };

  const debugText = [
    `DM Call - ${activeDMCall.callId} - ${activeDMCall.mediaType}`,
    `LiveKit: ${statusLabel} (${connectionState})`,
    `Local RMS: ${localRms.toFixed(4)} | Speaking: ${localSpeaking ? '1' : '0'}`,
    `Remote muted: ${remoteMuted ? '1' : '0'} deafened: ${remoteDeafened ? '1' : '0'} cam: ${remoteVideoEnabled ? '1' : '0'} ss: ${remoteSharingScreen ? '1' : '0'}`,
    `Remote speaking (LiveKit): ${remoteSpeaking ? '1' : '0'}`,
    `Remote camera track: ${remoteCameraTrack ? remoteCameraTrack.publicationSid : 'none'}`,
    `Remote screen track: ${remoteScreenTrack ? remoteScreenTrack.publicationSid : 'none'}`,
  ].join('\n');

  const handleCopyDebug = async () => {
    const ok = await writeClipboardText(debugText);
    if (!ok) return;
    setDebugCopied(true);
    window.setTimeout(() => setDebugCopied(false), 1200);
  };

  return (
    <div className="relative bg-bg-primary flex flex-col h-full overflow-hidden">
      {callNotice && (
        <div className="absolute top-4 left-4 right-4 z-30 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 shadow-lg backdrop-blur">
          {callNotice}
        </div>
      )}

      {debugCallingStates && (
        <div className={`absolute left-4 z-20 max-w-[min(420px,calc(100%-2rem))] rounded-md border border-border bg-bg-elevated/90 backdrop-blur px-2.5 py-1.5 text-[10px] text-text-muted shadow-lg ${callNotice ? 'top-24' : 'top-4'}`}>
          <div className="mb-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => { void handleCopyDebug(); }}
              className="shrink-0 rounded border border-border bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-primary hover:bg-bg-hover transition-colors"
            >
              {debugCopied ? 'Copied' : 'Copy'}
            </button>
            <div className="truncate">{statusLabel}</div>
          </div>
          {debugText.split('\n').slice(1).map((line, i) => (
            <div key={i} className="truncate">{line}</div>
          ))}
        </div>
      )}

      {/* Local screen share preview (for the sharer) */}
      {showLocalSharePreview && localScreenShareStream && (
        <div className="flex-1 min-h-0 flex items-center justify-center p-4 sm:p-6 bg-gradient-to-br from-bg-primary to-bg-secondary">
          <div className="w-full max-w-[960px]">
            <VideoStreamTile
              stream={localScreenShareStream}
              label="You are sharing your screen"
              isScreenShare
              actionLabel="Stop Sharing"
              onAction={() => void toggleScreenShare()}
            />
          </div>
        </div>
      )}

      {/* Remote screen share preview */}
      {showRemoteSharePreview && remoteScreenStream && (
        <div className="flex-1 min-h-0 flex items-center justify-center p-4 sm:p-6 bg-gradient-to-br from-bg-primary to-bg-secondary">
          <div className="w-full max-w-[960px]">
            <VideoStreamTile
              stream={remoteScreenStream}
              label={`${activeDMCall.otherUsername} is sharing their screen`}
              isScreenShare
              actionLabel="Stop Watching"
              onAction={() => setWatchingRemoteShare(false)}
            />
          </div>
        </div>
      )}

      {/* Screen share offer banner */}
      {remoteShareAvailable && !showRemoteSharePreview && (
        <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-bg-primary to-bg-secondary p-4">
          <div className="rounded-xl border border-white/15 bg-black/25 backdrop-blur-sm px-5 py-4 text-center text-white shadow-lg max-w-md w-full">
            <div className="text-sm font-semibold">{activeDMCall.otherUsername} is sharing their screen</div>
            <div className="mt-1 text-xs text-white/70">Stream playback is paused until you choose to watch.</div>
            <button
              type="button"
              onClick={() => setWatchingRemoteShare(true)}
              className="mt-3 px-3 py-1.5 rounded-lg bg-white text-black text-sm font-medium hover:bg-white/90"
            >
              Watch Stream
            </button>
          </div>
        </div>
      )}

      {/* Default state: connected banner */}
      {!showRemoteSharePreview && !remoteShareAvailable && (
        <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-bg-primary to-bg-secondary">
          <div className="text-center">
            <p className="text-lg text-emerald-300">{activeDMCall.otherConnected === false ? `Waiting for ${activeDMCall.otherUsername} to rejoin` : statusLabel}</p>
            <p className="text-text-muted mt-2">{activeDMCall.otherConnected === false ? 'Call stays open for up to 3 minutes' : `${formatDuration(callDuration)} • ${activeDMCall.mediaType} call`}</p>
          </div>
        </div>
      )}

      {/* Participant tiles */}
      <div className="p-4 bg-bg-secondary border-t border-border">
        <div className="flex items-center justify-center gap-4 max-w-5xl mx-auto">
          <div className="flex-1 max-w-sm">
            <ParticipantTile
              identity={otherUserId}
              displayName={activeDMCall.otherUsername}
              avatar={activeDMCall.otherAvatar}
              accountType="central"
              isSelf={false}
              isMuted={remoteMuted}
              isDeafened={remoteDeafened}
              isSpeaking={remoteSpeaking}
              videoStream={showRemoteCameraInBox ? remoteCameraStream : null}
              volumePct={remoteVolumePct}
              onVolumeChange={(vol) => setPeerVolume(otherUserId, vol)}
              context="dm"
              isSharing={remoteSharingScreen}
              isCameraEnabled={remoteVideoEnabled}
            />
          </div>

          <div className="flex-1 max-w-sm">
            <ParticipantTile
              identity={user?.id ?? ''}
              displayName={user?.displayName || user?.username || 'You'}
              avatar={user?.avatar ?? null}
              accountType={user?.accountType === 'central' ? 'central' : 'local'}
              isSelf
              isMuted={isMuted}
              isDeafened={isDeafened}
              isSpeaking={localSpeaking}
              videoStream={showLocalCameraInBox ? localCameraStream : null}
              context="dm"
              isSharing={isSharingScreen}
              isCameraEnabled={isVideoEnabled}
            />
          </div>
        </div>
      </div>

      {/* Control bar */}
      <div className="flex justify-center p-4">
        <MediaControlBar
          context="dm"
          variant="docked"
          isMuted={isMuted}
          isDeafened={isDeafened}
          isCameraEnabled={isVideoEnabled}
          isScreenSharing={isSharingScreen}
          onMute={toggleMute}
          onDeafen={toggleDeafen}
          onCamera={handleCameraAction}
          onScreenShare={handleScreenShareAction}
          onLeave={handleEndCall}
          onMessageChat={onToggleMessageChat}
          messageChatOpen={messageChatOpen}
        />
      </div>
    </div>
  );
}
