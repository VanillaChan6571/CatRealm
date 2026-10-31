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

type GroupCallPanelProps = {
  messageChatOpen?: boolean;
  onToggleMessageChat?: () => void;
};

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function GroupCallPanel({ messageChatOpen = false, onToggleMessageChat }: GroupCallPanelProps) {
  const user = useAuthStore((s) => s.user);
  const debugCallingStates = useSettingsStore((s) => s.debugCallingStates);
  const peerVolumeByUser = useVoiceStore((s) => s.peerVolumeByUser);
  const setPeerVolume = useVoiceStore((s) => s.setPeerVolume);
  const loadCentralPeerVolumes = useVoiceStore((s) => s.loadCentralPeerVolumes);
  const activeGroupCall = useCallStore((s) => s.activeGroupCall);
  const callSpeakingByUser = useCallStore((s) => s.callSpeakingByUser);
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
  const setCallSpeaking = useCallStore((s) => s.setCallSpeaking);
  const openModal = useUIStore((s) => s.openModal);
  const remoteTracks = useMediaStore((s) => s.remoteTracks);
  const localCameraStream = useMediaStore((s) => s.localCameraStream);
  const localScreenShareStream = useMediaStore((s) => s.localScreenShareStream);
  const statusLabel = useMediaStore((s) => s.statusLabel);
  const connectionState = useMediaStore((s) => s.connectionState);

  const [durationSec, setDurationSec] = useState(0);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [watchedShareIds, setWatchedShareIds] = useState<string[]>([]);
  const [debugCopied, setDebugCopied] = useState(false);

  useSpeakingDetector(localStream, !!activeGroupCall && !isMuted, setLocalSpeaking);

  useEffect(() => {
    if (!activeGroupCall || !user?.id) return;
    setCallSpeaking(user.id, localSpeaking);
  }, [activeGroupCall, localSpeaking, setCallSpeaking, user?.id]);

  useEffect(() => {
    if (user?.accountType !== 'central') return;
    void loadCentralPeerVolumes();
  }, [user?.accountType, user?.id, loadCentralPeerVolumes]);

  useEffect(() => {
    if (!activeGroupCall) {
      setDurationSec(0);
      setWatchedShareIds([]);
      return;
    }
    const timer = window.setInterval(() => {
      setDurationSec(Math.max(0, Math.floor((Date.now() - activeGroupCall.startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeGroupCall]);

  if (!activeGroupCall || activeGroupCall.status !== 'active') return null;

  const selfUserId = user?.id ?? '';
  const remoteParticipants = (activeGroupCall.participants ?? []).filter((p) => p.userId !== selfUserId);

  const getRemoteCameraStream = (userId: string): MediaStream | null => {
    const track = Object.values(remoteTracks).find(
      (t) => t.participantId === userId && t.source === 'camera' && t.kind === 'video',
    );
    return track?.mediaStream ?? null;
  };

  const getRemoteScreenStream = (userId: string): MediaStream | null => {
    const track = Object.values(remoteTracks).find(
      (t) => t.participantId === userId && t.source === 'screen_share' && t.kind === 'video',
    );
    return track?.mediaStream ?? null;
  };

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

  // Build screen share / camera visual entries
  const visualEntries: Array<{
    key: string;
    stream: MediaStream | null;
    label: string;
    subtitle?: string;
    isScreenShare: boolean;
    actionLabel?: string;
    onAction?: () => void;
  }> = [];

  const sharingParticipants = remoteParticipants.filter((p) => p.sharingScreen);
  const watchedSharers = sharingParticipants.filter((p) => watchedShareIds.includes(p.userId));
  const unwatchedSharers = sharingParticipants.filter((p) => !watchedShareIds.includes(p.userId));

  // Add local screen share first if active
  if (isSharingScreen && localScreenShareStream) {
    visualEntries.push({
      key: 'ss-local',
      stream: localScreenShareStream,
      label: 'You are sharing your screen',
      isScreenShare: true,
      actionLabel: 'Stop Sharing',
      onAction: () => void toggleScreenShare(),
    });
  }

  for (const p of watchedSharers) {
    const stream = getRemoteScreenStream(p.userId);
    const name = p.displayName || p.username;
    if (stream) {
      visualEntries.push({
        key: `ss-${p.userId}`,
        stream,
        label: `${name} is sharing their screen`,
        isScreenShare: true,
        actionLabel: 'Stop Watching',
        onAction: () => setWatchedShareIds((prev) => prev.filter((id) => id !== p.userId)),
      });
    }
  }

  for (const p of unwatchedSharers) {
    const name = p.displayName || p.username;
    visualEntries.push({
      key: `ss-offer-${p.userId}`,
      stream: null,
      label: `${name} is sharing their screen`,
      subtitle: 'Stream paused until you choose to watch.',
      isScreenShare: true,
      actionLabel: 'Watch Stream',
      onAction: () => setWatchedShareIds((prev) => (prev.includes(p.userId) ? prev : [...prev, p.userId])),
    });
  }

  if (visualEntries.length === 0) {
    for (const p of remoteParticipants) {
      if (!p.videoEnabled || p.sharingScreen) continue;
      const stream = getRemoteCameraStream(p.userId);
      if (stream) {
        const name = p.displayName || p.username;
        visualEntries.push({ key: `cam-${p.userId}`, stream, label: `${name}'s camera`, isScreenShare: false });
      }
    }
    if (isVideoEnabled && localCameraStream) {
      visualEntries.push({ key: 'cam-local', stream: localCameraStream, label: 'Your camera', isScreenShare: false });
    }
  }

  const showVisual = visualEntries.length > 0;

  const debugText = [
    `Group Call - ${activeGroupCall.callId} - ${activeGroupCall.mediaType}`,
    `LiveKit: ${statusLabel} (${connectionState})`,
    `local m:${isMuted ? '1' : '0'} d:${isDeafened ? '1' : '0'} cam:${isVideoEnabled ? '1' : '0'} ss:${isSharingScreen ? '1' : '0'} speaking:${localSpeaking ? '1' : '0'}`,
    `remote members:${remoteParticipants.length}`,
    `remote tracks:${Object.keys(remoteTracks).length}`,
  ].join('\n');

  const handleCopyDebug = async () => {
    const ok = await writeClipboardText(debugText);
    if (!ok) return;
    setDebugCopied(true);
    window.setTimeout(() => setDebugCopied(false), 1500);
  };

  return (
    <div className="relative h-full bg-bg-primary flex flex-col overflow-hidden">
      {callNotice && (
        <div className="absolute top-4 left-4 right-4 z-30 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 shadow-lg backdrop-blur">
          {callNotice}
        </div>
      )}

      {debugCallingStates && (
        <div className={`absolute left-4 z-20 max-w-[min(460px,calc(100%-2rem))] rounded-md border border-border bg-bg-elevated/90 backdrop-blur px-2.5 py-1.5 text-[10px] text-text-muted shadow-lg ${callNotice ? 'top-24' : 'top-16'}`}>
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="font-semibold text-text-primary">Group Call Debug</div>
            <button
              type="button"
              onClick={() => { void handleCopyDebug(); }}
              className="px-2 py-0.5 rounded bg-bg-hover text-text-primary hover:bg-bg-input transition-colors"
            >
              {debugCopied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {debugText.split('\n').map((line, i) => <div key={i} className="truncate">{line}</div>)}
        </div>
      )}

      {/* Status banner */}
      <div className={`absolute left-4 z-20 rounded-md border border-border bg-bg-elevated/85 px-3 py-1.5 text-xs shadow ${callNotice ? 'top-20' : 'top-4'}`}>
        <span className="text-emerald-300">{statusLabel}</span>
        <span className="text-text-muted"> • {formatDuration(durationSec)} • {activeGroupCall.mediaType} call</span>
      </div>

      <div className={`flex-1 min-h-0 flex flex-col px-6 pb-24 ${showVisual ? '' : 'items-center justify-center'}`}>
        {/* Video/screen share grid */}
        {showVisual && (
          <div className="absolute inset-0 z-0 flex items-start justify-center pt-8 sm:pt-10 px-4 sm:px-6 bg-gradient-to-br from-bg-primary to-bg-secondary">
            <div className={`w-full ${visualEntries.length > 1 ? 'max-w-[1400px] grid grid-cols-1 md:grid-cols-2 gap-4' : 'max-w-[960px] xl:max-w-[1040px]'}`}>
              {visualEntries.map((entry) => (
                <VideoStreamTile
                  key={entry.key}
                  stream={entry.stream}
                  label={entry.label}
                  subtitle={entry.subtitle}
                  isScreenShare={entry.isScreenShare}
                  actionLabel={entry.actionLabel}
                  onAction={entry.onAction}
                />
              ))}
            </div>
          </div>
        )}

        {/* Participant tiles */}
        <div className={`w-full max-w-6xl ${showVisual ? 'relative z-10 mt-auto rounded-xl border border-border/70 bg-bg-secondary/85 backdrop-blur-sm p-3' : ''}`}>
          {!showVisual && (
            <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-bg-primary to-bg-secondary rounded-lg border border-border/70 mb-4 min-h-[180px]">
              <div className="text-center">
                <p className="text-lg text-emerald-300">{statusLabel}</p>
                <p className="text-text-muted mt-2">{formatDuration(durationSec)} • {activeGroupCall.mediaType} call</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {/* Self tile */}
            <ParticipantTile
              identity={selfUserId}
              displayName={user?.displayName || user?.username || 'You'}
              avatar={user?.avatar ?? null}
              accountType={user?.accountType === 'central' ? 'central' : 'local'}
              isSelf
              isMuted={isMuted}
              isDeafened={isDeafened}
              isSpeaking={localSpeaking}
              videoStream={isVideoEnabled && !isSharingScreen && localCameraStream ? localCameraStream : null}
              context="group"
              isSharing={isSharingScreen}
              isCameraEnabled={isVideoEnabled}
            />

            {/* Remote tiles */}
            {remoteParticipants.map((p) => {
              const isSpeaking = callSpeakingByUser[p.userId] ?? false;
              const cameraStream = (p.videoEnabled && !p.sharingScreen) ? getRemoteCameraStream(p.userId) : null;
              return (
                <ParticipantTile
                  key={p.userId}
                  identity={p.userId}
                  displayName={p.displayName || p.username}
                  avatar={p.avatar ?? null}
                  accountType="central"
                  isSelf={false}
                  isMuted={!!p.muted}
                  isDeafened={!!p.deafened}
                  isSpeaking={isSpeaking}
                  videoStream={cameraStream}
                  volumePct={peerVolumeByUser[p.userId] ?? 50}
                  onVolumeChange={(vol) => setPeerVolume(p.userId, vol)}
                  context="group"
                  isSharing={!!p.sharingScreen}
                  isCameraEnabled={!!p.videoEnabled}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Control bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
        <MediaControlBar
          context="group"
          variant="docked"
          isMuted={isMuted}
          isDeafened={isDeafened}
          isCameraEnabled={isVideoEnabled}
          isScreenSharing={isSharingScreen}
          onMute={toggleMute}
          onDeafen={toggleDeafen}
          onCamera={handleCameraAction}
          onScreenShare={handleScreenShareAction}
          onLeave={() => endCall(activeGroupCall.callId)}
          onMessageChat={onToggleMessageChat}
          messageChatOpen={messageChatOpen}
        />
      </div>
    </div>
  );
}
