import { useEffect, useMemo, useState } from 'react';
import { getSocket } from '../../lib/socket';
import { writeClipboardText } from '../../lib/clipboard';
import { useAuthStore } from '../../stores/authStore';
import { useServerStore } from '../../stores/serverStore';
import { useTheaterStore } from '../../stores/theaterStore';
import { useMediaStore } from '../../stores/mediaStore';
import { useViewedChannels } from '../../hooks/useViewedChannels';

export function TheaterStatusPanel() {
  const user = useAuthStore((s) => s.user);
  const serverInfo = useAuthStore((s) => s.serverInfo);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const activeServerUrl = useServerStore((s) => s.activeServerUrl);
  const servers = useServerStore((s) => s.servers);
  const theaterChannelId = useTheaterStore((s) => s.activeChannelId);
  const theaterServerUrl = useTheaterStore((s) => s.theaterServerUrl);
  const theaterChannelName = useTheaterStore((s) => s.theaterChannelName);
  const roomStartedAtByChannel = useTheaterStore((s) => s.roomStartedAtByChannel);
  const users = useTheaterStore((s) => s.users);
  const statusLabel = useMediaStore((s) => s.statusLabel);
  const connectionState = useMediaStore((s) => s.connectionState);
  const cameraEnabled = useTheaterStore((s) => s.cameraEnabled);
  const micEnabled = useTheaterStore((s) => s.micEnabled);
  const selfDeafened = useTheaterStore((s) => s.selfDeafened);
  const hostUserId = useTheaterStore((s) => s.hostUserId);
  const selfUserId = useTheaterStore((s) => s.selfUserId);
  const playbackState = useTheaterStore((s) => s.state);
  const computeExpectedPositionMs = useTheaterStore((s) => s.computeExpectedPositionMs);
  const debugEvents = useTheaterStore((s) => s.debugEvents);
  const channels = useViewedChannels();
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<'all' | 'media' | null>(null);
  const [stats, setStats] = useState<{
    serverPingMs: number | null;
    serverAvgPingMs: number | null;
  }>({
    serverPingMs: null,
    serverAvgPingMs: null,
  });

  const channelName = useMemo(
    () => theaterChannelName ?? channels.find((c) => c.id === theaterChannelId)?.name ?? 'Theater',
    [channels, theaterChannelId, theaterChannelName],
  );
  const serverName = theaterServerUrl
    ? (servers.find((entry) => entry.url === theaterServerUrl)?.name ?? serverInfo?.name ?? 'CatRealm')
    : (serverInfo?.name ?? 'CatRealm');
  const startedAt = theaterChannelId ? (roomStartedAtByChannel[theaterChannelId] ?? null) : null;
  const hostName = hostUserId ? (users.find((entry) => entry.id === hostUserId)?.username ?? 'Unknown') : null;
  const selfUser = selfUserId ? (users.find((entry) => entry.id === selfUserId) ?? null) : null;
  const mediaBanner = statusLabel === 'Connected'
    ? 'Theater LiveKit Connected'
    : statusLabel === 'Reconnecting'
      ? 'Theater LiveKit Reconnecting...'
      : statusLabel === 'Connecting'
        ? 'Theater LiveKit Connecting...'
        : 'Theater LiveKit Disconnected';

  useEffect(() => {
    if (!theaterChannelId) {
      setExpanded(false);
      return;
    }
  }, [theaterChannelId]);

  useEffect(() => {
    if (!theaterChannelId) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [theaterChannelId]);

  useEffect(() => {
    if (!theaterChannelId) return;
    const socketUrl = theaterServerUrl ?? (user?.accountType === 'central' ? activeServerUrl : serverUrl);
    const socket = getSocket(socketUrl ?? undefined);
    if (!socket) return;

    let pingSamples: number[] = [];
    const interval = window.setInterval(() => {
      const start = Date.now();
      socket.emit('voice:ping', (resp: { ok?: boolean } | undefined) => {
        if (!resp?.ok) return;
        const rtt = Date.now() - start;
        pingSamples.push(rtt);
        if (pingSamples.length > 20) pingSamples.shift();
        setStats((prev) => ({
          ...prev,
          serverPingMs: rtt,
          serverAvgPingMs: Math.round(pingSamples.reduce((sum, sample) => sum + sample, 0) / pingSamples.length),
        }));
      });
    }, 2000);

    return () => window.clearInterval(interval);
  }, [theaterChannelId, theaterServerUrl, user?.accountType, activeServerUrl, serverUrl]);

  if (!theaterChannelId) return null;

  const elapsed = startedAt !== null ? Math.max(0, now - startedAt) : null;
  const pingTone = getPingTone(stats.serverPingMs, null);
  const pingToneClass = pingTone === 'good'
    ? 'text-emerald-400'
    : pingTone === 'ok'
      ? 'text-amber-400'
      : pingTone === 'bad'
        ? 'text-rose-400'
        : 'text-text-secondary';
  const peerSummary = `Media Path LiveKit SFU / ${connectionState}`;
  const debugText = [
    `${mediaBanner} - Server Ping ${stats.serverPingMs ?? '-'} ms`,
    `Media Path LiveKit SFU / ${connectionState}`,
    `${channelName} / ${serverName}`,
    `Viewers: ${users.length}`,
    `Remote Tracks: LiveKit`,
    `Host: ${hostName ?? '-'}`,
    `Self Mic: ${!micEnabled || selfDeafened ? 'Muted' : 'Live'}`,
    `Self Camera: ${cameraEnabled ? 'On' : 'Off'}`,
    `Self Audio: ${selfDeafened ? 'Deafened' : 'Listening'}`,
    `Playback: ${playbackState?.playing ? 'Playing' : 'Paused'}`,
    `Position: ${formatElapsed(playbackState?.position_ms ?? 0)}`,
    `Expected Position: ${formatElapsed(computeExpectedPositionMs())}`,
    `Duration: ${formatElapsed(playbackState?.duration_ms ?? 0)}`,
    `Current Item: ${playbackState?.current_item_id ?? '-'}`,
    `Video URL: ${playbackState?.videoUrl ?? '-'}`,
    '',
    '-- Media Path --',
    peerSummary || '-',
    '',
    '-- Theater Debug Events --',
    ...(debugEvents.length > 0
      ? debugEvents.slice(-12).map((event) => `${formatDebugStamp(event.at)} ${event.message}`)
      : ['-']),
  ].join('\n');

  const mediaDebugText = [
    '-- Media Path --',
    peerSummary || '-',
    '',
    '-- Theater Debug Events --',
    ...(debugEvents.length > 0
      ? debugEvents.slice(-50).map((event) => `${formatDebugStamp(event.at)} ${event.message}`)
      : ['-']),
  ].join('\n');

  const copyAll = async () => {
    const ok = await writeClipboardText(debugText);
    if (!ok) return;
    setCopied('all');
    window.setTimeout(() => setCopied(null), 1200);
  };

  const copyMedia = async () => {
    const ok = await writeClipboardText(mediaDebugText);
    if (!ok) return;
    setCopied('media');
    window.setTimeout(() => setCopied(null), 1200);
  };

  return (
    <div
      onDoubleClick={() => setExpanded(true)}
      data-debug-name="Theater Status Panel"
      data-debug-file="src/components/layout/TheaterStatusPanel.tsx"
      className={`bg-bg-elevated border-t border-border px-3 py-2 transition-all duration-300 ease-out overflow-hidden ${expanded ? 'max-h-[22rem]' : 'max-h-24'}`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          onDoubleClick={() => setExpanded(true)}
          className="min-w-0 flex-1 text-left"
        >
          <div className={`text-[10px] ${pingToneClass}`}>
            {mediaBanner}{elapsed !== null ? ` - ${formatElapsed(elapsed)}` : ''}
          </div>
          <div className={`text-[10px] ${pingToneClass}`}>
            Server Ping {stats.serverPingMs ?? '-'} ms - Media Path LiveKit SFU
          </div>
          <div className="text-sm text-text-primary font-medium truncate">{channelName} / {serverName}</div>
        </button>
        {expanded && (
          <div className="flex gap-1 shrink-0">
            <button
              type="button"
              onClick={() => { void copyMedia(); }}
              className="rounded border border-border bg-bg-tertiary px-2 py-1 text-[10px] text-text-primary hover:bg-bg-hover transition-colors"
              title="Copy media path and debug events"
            >
              {copied === 'media' ? 'Copied!' : 'Copy Media Debug'}
            </button>
            <button
              type="button"
              onClick={() => { void copyAll(); }}
              className="rounded border border-border bg-bg-tertiary px-2 py-1 text-[10px] text-text-primary hover:bg-bg-hover transition-colors"
              title="Copy all theater debug info"
            >
              {copied === 'all' ? 'Copied!' : 'Copy All'}
            </button>
          </div>
        )}
      </div>
      {expanded && (
        <div className="mt-3 max-h-64 overflow-y-auto pr-1 text-xs text-text-muted space-y-1">
          <div>Viewers: {users.length}</div>
          <div>Media Path: LiveKit SFU / {connectionState}</div>
          <div>Host: {hostName ?? '-'}</div>
          <div>Server Avg Ping: {stats.serverAvgPingMs ?? '-'} ms</div>
          <div>Self Microphone: {!micEnabled || selfDeafened ? 'Muted' : 'Live'}</div>
          <div>Self Camera: {cameraEnabled ? 'On' : 'Off'}</div>
          <div>Self Audio: {selfDeafened ? 'Deafened' : 'Listening'}</div>
          <div>Self User: {selfUser?.username ?? 'You'}</div>
          <div>Playback: {playbackState?.playing ? 'Playing' : 'Paused'}</div>
          <div>Playback Position: {formatElapsed(playbackState?.position_ms ?? 0)}</div>
          <div>Expected Position: {formatElapsed(computeExpectedPositionMs())}</div>
          <div>Duration: {formatElapsed(playbackState?.duration_ms ?? 0)}</div>
          <div>Current Item: {playbackState?.current_item_id ?? '-'}</div>
          <div>Video URL: {playbackState?.videoUrl ?? '-'}</div>
          <div className="pt-2 text-[11px] text-text-secondary">-- Media Path --</div>
          <div>LiveKit SFU / {connectionState}</div>
          <div className="pt-2 text-[11px] text-text-secondary">-- Theater Debug Events --</div>
          {debugEvents.length > 0 ? (
            debugEvents.slice(-12).map((event) => (
              <div key={event.id}>
                {formatDebugStamp(event.at)} {event.message}
              </div>
            ))
          ) : (
            <div>No Theater debug events yet.</div>
          )}
        </div>
      )}
    </div>
  );
}

function formatElapsed(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const seconds = totalSec % 60;
  const minutes = Math.floor(totalSec / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatDebugStamp(at: number) {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function getPingTone(serverPingMs: number | null, peerPingMs: number | null) {
  const samples = [serverPingMs, peerPingMs].filter((value): value is number => typeof value === 'number');
  if (samples.length === 0) return 'unknown';
  const worst = Math.max(...samples);
  if (worst < 125) return 'good';
  if (worst < 220) return 'ok';
  return 'bad';
}
