import { useCallback, useEffect, useState } from 'react';

/**
 * Enumerates audio output devices while `active` is true, re-enumerating on
 * OS device changes. Mirrors the Voice-tab flow in ProfileSettingsModal: a
 * short-lived getUserMedia permission stream unlocks device labels, then is
 * stopped immediately so the mic doesn't stay hot.
 */
export function useAudioOutputDevices(active: boolean) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const sinkSupported =
    typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

  const refresh = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return;
    setLoading(true);
    setError(null);
    let permissionStream: MediaStream | null = null;
    try {
      permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === 'audiooutput'));
    } catch {
      setError('Microphone access denied');
    } finally {
      permissionStream?.getTracks().forEach((track) => track.stop());
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) return;
    const onDeviceChange = () => void refresh();
    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
  }, [active, refresh]);

  return { devices, error, loading, refresh, sinkSupported };
}
