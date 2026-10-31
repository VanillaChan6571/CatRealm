import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { getSocket } from '../../lib/socket';
import { useServerStore } from '../../stores/serverStore';
import { writeClipboardText } from '../../lib/clipboard';
import { useViewedChannels } from '../../hooks/useViewedChannels';
import { Lock } from 'lucide-react';

export function VoiceStatusPanel() {
  const serverInfo = useAuthStore((s) => s.serverInfo);
  const user = useAuthStore((s) => s.user);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const activeServerUrl = useServerStore((s) => s.activeServerUrl);
  const voiceChannelId = useVoiceStore((s) => s.activeChannelId);
  const storedVoiceChannelName = useVoiceStore((s) => s.voiceChannelName);
  const storedVoiceServerName = useVoiceStore((s) => s.voiceServerName);
  const peers = useVoiceStore((s) => s.peers);
  const e2eeSupported = useVoiceStore((s) => s.e2eeSupported);
  const e2eeByPeer = useVoiceStore((s) => s.e2eeByPeer);
  const localStream = useVoiceStore((s) => s.localStream);
  const channels = useViewedChannels();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState<{
    pingMs: number | null;
    avgPingMs: number | null;
    serverPingMs: number | null;
    serverAvgPingMs: number | null;
    peerPingMs: number | null;
    peerAvgPingMs: number | null;
    codec: string | null;
    sampleRate: number | null;
    audioLevelDb: number | null;
    bitrateKbps: number | null;
    bitrateTargetKbps: number | null;
    bytesSent: number | null;
    packetsSent: number | null;
    packetLoss: number | null;
    packetsReceived: number | null;
    bytesReceived: number | null;
  }>({
    pingMs: null,
    avgPingMs: null,
    serverPingMs: null,
    serverAvgPingMs: null,
    peerPingMs: null,
    peerAvgPingMs: null,
    codec: null,
    sampleRate: null,
    audioLevelDb: null,
    bitrateKbps: null,
    bitrateTargetKbps: null,
    bytesSent: null,
    packetsSent: null,
    packetLoss: null,
    packetsReceived: null,
    bytesReceived: null,
  });

  const voiceChannelName = useMemo(() => {
    if (!voiceChannelId) return null;
    return storedVoiceChannelName ?? channels.find((c) => c.id === voiceChannelId)?.name ?? null;
  }, [channels, voiceChannelId, storedVoiceChannelName]);

  const voiceServerName = storedVoiceServerName ?? serverInfo?.name ?? 'CatRealm';
  const rtcBanner = 'Voice Connected';

  useEffect(() => {
    if (!voiceChannelId) {
      setExpanded(false);
      return;
    }
  }, [voiceChannelId]);

  useEffect(() => {
    if (!voiceChannelId) return;
    const interval = window.setInterval(() => {
      const sampleRate = localStream?.getAudioTracks()?.[0]?.getSettings()?.sampleRate ?? null;
      setStats((prev) => ({
        ...prev,
        sampleRate: sampleRate ? Math.round(sampleRate / 1000) : null,
      }));
    }, 1000);
    return () => { window.clearInterval(interval); };
  }, [voiceChannelId, localStream]);

  useEffect(() => {
    if (!voiceChannelId) return;
    const isCentral = user?.accountType === 'central';
    const socketUrl = isCentral ? activeServerUrl : serverUrl;
    const socket = getSocket(socketUrl ?? undefined);
    if (!socket) return;
    let pingSamples: number[] = [];
    const interval = window.setInterval(() => {
      const start = Date.now();
      socket.emit('voice:ping', (resp: { ok?: boolean }) => {
        if (!resp?.ok) return;
        const rtt = Date.now() - start;
        pingSamples.push(rtt);
        if (pingSamples.length > 20) pingSamples.shift();
        setStats((s) => ({
          ...s,
          serverPingMs: rtt,
          serverAvgPingMs: Math.round(pingSamples.reduce((a, b) => a + b, 0) / pingSamples.length),
        }));
      });
    }, 2000);
    return () => window.clearInterval(interval);
  }, [voiceChannelId, user?.accountType, activeServerUrl, serverUrl]);

  if (!voiceChannelId) return null;

  const pingTone = getPingTone(stats.serverPingMs, stats.peerPingMs);
  const lossPct = getPacketLossPct(stats.packetLoss, stats.packetsSent);
  const pingToneClass =
    typeof lossPct === 'number' && lossPct > 6
      ? 'text-orange-400'
      : pingTone === 'good'
        ? 'text-emerald-400'
        : pingTone === 'ok'
          ? 'text-amber-400'
        : pingTone === 'bad'
          ? 'text-rose-400'
          : 'text-text-secondary';
  const e2eeStatus = getE2eeStatus(e2eeSupported, Object.keys(peers).length, e2eeByPeer);
  const e2eeTextClass =
    e2eeStatus === 'green'
      ? 'text-emerald-400'
      : e2eeStatus === 'yellow'
        ? 'text-amber-400'
        : e2eeStatus === 'gray'
          ? 'text-text-muted'
          : 'text-rose-400';
  const e2eeBorderClass =
    e2eeStatus === 'green'
      ? 'border-emerald-400/70'
      : e2eeStatus === 'yellow'
        ? 'border-amber-400/70'
        : e2eeStatus === 'gray'
          ? 'border-border'
          : 'border-rose-400/70';
  const e2eeDotClass =
    e2eeStatus === 'green'
      ? 'bg-emerald-400'
      : e2eeStatus === 'yellow'
        ? 'bg-amber-400'
        : e2eeStatus === 'gray'
          ? 'bg-text-muted'
          : 'bg-rose-400';
  const e2eeLabel = !e2eeSupported
    ? 'E2EE - Unsupported in this browser'
    : e2eeStatus === 'gray'
      ? (Object.keys(peers).length === 0 ? 'E2EE - Alone... Nothing to encrypt silly!' : 'E2EE - Disabled or unavailable')
      : 'E2EE';
  const debugText = [
    `${rtcBanner} - Server Ping ${stats.serverPingMs ?? '-'} ms`,
    `Peer Ping ${stats.peerPingMs ?? '-'} ms`,
    `${voiceChannelName ?? 'Voice'} / ${voiceServerName}`,
    '',
    '-- Outbound --',
    `Codec: ${stats.codec ?? '-'}`,
    `Current Sample Rate: ${stats.sampleRate ?? '-'} kHz`,
    `Audio Level: ${stats.audioLevelDb ?? '-'} dB`,
    `Bitrate: ${stats.bitrateKbps ?? '-'} Kbps`,
    `Bitrate Target: ${stats.bitrateTargetKbps ?? '-'} Kbps`,
    `Bytes Sent: ${formatBytes(stats.bytesSent)}`,
    `Packet Loss: ${stats.packetLoss ?? '-'}`,
    `Packets Sent: ${stats.packetsSent ?? '-'}`,
    '',
    '-- Transport --',
    `Peer Avg Ping: ${stats.peerAvgPingMs ?? '-'} ms`,
    `Peer Last Ping: ${stats.peerPingMs ?? '-'} ms`,
    `Server Avg Ping: ${stats.serverAvgPingMs ?? '-'} ms`,
    `Server Last Ping: ${stats.serverPingMs ?? '-'} ms`,
    `Packets Sent: ${stats.packetsSent ?? '-'}`,
    `Packets Received: ${stats.packetsReceived ?? '-'}`,
    `Bytes Received: ${formatBytes(stats.bytesReceived)}`,
    `Bytes Sent: ${formatBytes(stats.bytesSent)}`,
  ].join('\n');

  const copyDebug = async () => {
    const ok = await writeClipboardText(debugText);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      className={`bg-bg-elevated border-t border-border px-3 py-2 transition-[max-height] duration-300 ease-in-out overflow-hidden ${expanded ? 'max-h-[28rem]' : 'max-h-[6rem]'}`}
      data-debug-name="Voice Status Panel"
      data-debug-file="src/components/layout/VoiceStatusPanel.tsx"
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setExpanded((s) => !s)}
          className="min-w-0 flex-1 text-left"
        >
          <div className={`text-[10px] ${pingToneClass}`}>
            {rtcBanner} - Server Ping {stats.serverPingMs ?? '-'} ms
          </div>
          <div className={`text-[10px] ${pingToneClass}`}>
            Peer Ping {stats.peerPingMs ?? '-'} ms
          </div>
          <div className={`mt-1 flex items-center gap-1 text-[10px] ${e2eeTextClass}`}>
            <span className={`inline-flex items-center justify-center w-3 h-3 rounded-full border ${e2eeBorderClass}`}>
              <span className={`block w-1.5 h-1.5 rounded-full ${e2eeDotClass}`} />
            </span>
            <span className="flex items-center gap-1">
              <Lock className="h-3 w-3" aria-hidden="true" />
              {e2eeLabel}
            </span>
          </div>
          <div className="text-sm text-text-primary font-medium truncate">{voiceChannelName ?? 'Voice'} / {voiceServerName}</div>
        </button>
        <button
          type="button"
          onClick={() => { void copyDebug(); }}
          className={`shrink-0 rounded border border-border bg-bg-tertiary px-2 py-1 text-[10px] text-text-primary hover:bg-bg-hover transition-[opacity,visibility] duration-200 ${expanded ? 'opacity-100 visible' : 'opacity-0 invisible'}`}
          title="Copy voice debug text"
          tabIndex={expanded ? 0 : -1}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className={`mt-3 max-h-72 overflow-y-auto pr-1 text-xs text-text-muted space-y-1 transition-[opacity,visibility] duration-200 ${expanded ? 'opacity-100 visible' : 'opacity-0 invisible'}`}>
        <div className="text-[11px] text-text-secondary">-- Outbound --</div>
        <div>Codec: {stats.codec ?? '-'}</div>
        <div>Current Sample Rate: {stats.sampleRate ?? '-'} kHz</div>
        <div>Audio Level: {stats.audioLevelDb ?? '-'} dB</div>
        <div>Bitrate: {stats.bitrateKbps ?? '-'} Kbps</div>
        <div>Bitrate Target: {stats.bitrateTargetKbps ?? '-'} Kbps</div>
        <div>Bytes Sent: {formatBytes(stats.bytesSent)}</div>
        <div>Packet Loss: {stats.packetLoss ?? '-'}</div>
        <div>Packets Sent: {stats.packetsSent ?? '-'}</div>
        <div className="text-[11px] text-text-secondary mt-2">-- Transport --</div>
        <div>Peer Avg Ping: {stats.peerAvgPingMs ?? '-'} ms</div>
        <div>Peer Last Ping: {stats.peerPingMs ?? '-'} ms</div>
        <div>Server Avg Ping: {stats.serverAvgPingMs ?? '-'} ms</div>
        <div>Server Last Ping: {stats.serverPingMs ?? '-'} ms</div>
        <div>Packets Sent: {stats.packetsSent ?? '-'}</div>
        <div>Packets Received: {stats.packetsReceived ?? '-'}</div>
        <div>Bytes Received: {formatBytes(stats.bytesReceived)}</div>
        <div>Bytes Sent: {formatBytes(stats.bytesSent)}</div>
      </div>
    </div>
  );
}

function formatBytes(value: number | null) {
  if (value === null || Number.isNaN(value)) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = value;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

function getPingTone(serverPingMs: number | null, peerPingMs: number | null) {
  const samples = [serverPingMs, peerPingMs].filter((v): v is number => typeof v === 'number');
  if (samples.length === 0) return 'unknown';
  const worst = Math.max(...samples);
  if (worst < 125) return 'good';
  if (worst < 220) return 'ok';
  return 'bad';
}

function getPacketLossPct(packetsLost: number | null, packetsSent: number | null) {
  if (packetsLost === null || packetsSent === null) return null;
  const total = packetsLost + packetsSent;
  if (!Number.isFinite(total) || total <= 0) return null;
  return (packetsLost / total) * 100;
}

function getE2eeStatus(
  supported: boolean,
  peerCount: number,
  byPeer: Record<string, 'disabled' | 'unsupported' | 'pending' | 'active' | 'repairing' | 'downgraded' | 'failed'>,
) {
  if (!supported) return 'gray';
  if (peerCount === 0) return 'gray';
  const values = Object.values(byPeer);
  const activeCount = values.filter((v) => v === 'active').length;
  const degradedCount = values.filter((v) => v === 'downgraded' || v === 'failed').length;
  const pendingCount = values.filter((v) => v === 'pending' || v === 'repairing').length;
  const disabledCount = values.filter((v) => v === 'disabled' || v === 'unsupported').length;
  if (activeCount === peerCount) return 'green';
  if (activeCount > 0) return 'yellow';
  if (degradedCount > 0) return 'red';
  if (pendingCount > 0) return 'yellow';
  if (disabledCount === peerCount) return 'gray';
  return 'yellow';
}
