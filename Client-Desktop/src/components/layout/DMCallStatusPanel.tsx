import { useEffect, useState } from 'react';
import { AUTH_BASE } from '../../lib/authApi';
import { getCallSocket, useCallStore } from '../../stores/callStore';
import { useMediaStore } from '../../stores/mediaStore';
import { useVoiceStore } from '../../stores/voiceStore';

export function DMCallStatusPanel() {
  const activeDMCall = useCallStore((s) => s.activeDMCall);
  const activeGroupCall = useCallStore((s) => s.activeGroupCall);
  const statusLabel = useMediaStore((s) => s.statusLabel);
  const connectionState = useMediaStore((s) => s.connectionState);
  const voiceChannelId = useVoiceStore((s) => s.activeChannelId);
  const [serverPingMs, setServerPingMs] = useState<number | null>(null);

  const hasActiveDM = !!activeDMCall && activeDMCall.status === 'active';
  const hasActiveGroup = !!activeGroupCall && activeGroupCall.status === 'active';
  const active = hasActiveDM || hasActiveGroup;

  useEffect(() => {
    if (!active) {
      setServerPingMs(null);
      return;
    }
    let cancelled = false;

    const pingViaSocketAck = async (): Promise<number | null> => {
      const socket = getCallSocket();
      if (!socket?.connected) return null;
      return new Promise<number | null>((resolve) => {
        const started = performance.now();
        let finished = false;
        const timeoutId = window.setTimeout(() => {
          if (finished) return;
          finished = true;
          resolve(null);
        }, 1500);

        socket.emit('call:ping', (resp: { ok?: boolean } | undefined) => {
          if (finished) return;
          finished = true;
          window.clearTimeout(timeoutId);
          if (!resp?.ok) {
            resolve(null);
            return;
          }
          resolve(Math.max(1, Math.round(performance.now() - started)));
        });
      });
    };

    const pingViaHealth = async (): Promise<number | null> => {
      const started = performance.now();
      try {
        const response = await fetch(`${AUTH_BASE}/health?ts=${Date.now()}`, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'omit',
        });
        if (!response.ok) return null;
        return Math.max(1, Math.round(performance.now() - started));
      } catch {
        return null;
      }
    };

    const pingServer = async () => {
      if (cancelled) return;
      const ackPing = await pingViaSocketAck();
      if (cancelled) return;
      if (ackPing !== null) {
        setServerPingMs(ackPing);
        return;
      }
      const healthPing = await pingViaHealth();
      if (!cancelled && healthPing !== null) {
        setServerPingMs(healthPing);
      }
    };

    const socket = getCallSocket();
    const manager = (socket as any)?.io;
    const onPong = (latency: number) => {
      if (cancelled) return;
      if (typeof latency === 'number' && Number.isFinite(latency)) {
        setServerPingMs(Math.round(latency));
      }
    };
    manager?.on?.('pong', onPong);

    void pingServer();
    const interval = window.setInterval(() => { void pingServer(); }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      manager?.off?.('pong', onPong);
    };
  }, [active]);

  if (!active || voiceChannelId) return null;

  const mediaBanner = statusLabel === 'Connected'
    ? 'LiveKit Connected'
    : statusLabel === 'Reconnecting'
      ? 'LiveKit Reconnecting...'
      : statusLabel === 'Connecting'
        ? 'LiveKit Connecting...'
        : 'LiveKit Disconnected';
  const tone = getPingTone(serverPingMs);
  const pingToneClass =
    tone === 'good'
      ? 'text-emerald-400'
      : tone === 'ok'
        ? 'text-amber-400'
        : tone === 'bad'
          ? 'text-rose-400'
          : (statusLabel === 'Connected' ? 'text-emerald-400' : 'text-amber-400');
  const bannerClass = statusLabel === 'Connected' ? 'text-emerald-400' : 'text-amber-400';
  const serverPingLabel = serverPingMs !== null ? `${serverPingMs} ms` : 'measuring...';
  const callLabel = hasActiveDM
    ? `DM Call / ${activeDMCall?.otherUsername ?? 'Unknown'}`
    : `Group Call / ${activeGroupCall?.groupName ?? 'Group Chat'}`;

  return (
    <div className="bg-bg-elevated border-t border-border px-3 py-2">
      <div className={`text-[10px] ${bannerClass}`}>
        {mediaBanner} - Server Ping {serverPingLabel}
      </div>
      <div className={`text-[10px] ${pingToneClass}`}>
        Media Path LiveKit SFU / {connectionState}
      </div>
      <div className="text-sm text-text-primary font-medium truncate">
        {callLabel}
      </div>
    </div>
  );
}

function getPingTone(serverPingMs: number | null) {
  if (serverPingMs === null) return 'unknown';
  if (serverPingMs < 125) return 'good';
  if (serverPingMs < 220) return 'ok';
  return 'bad';
}
