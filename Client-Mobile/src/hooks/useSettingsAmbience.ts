import { useEffect, useRef } from 'react';
import { useAppForeground } from './useAppForeground';
import { useAmbienceFxStore } from '@/stores/ambienceFxStore';
import { setLoopingNotificationSoundVolume, startLoopingNotificationSound } from '@/lib/notificationSounds';

export function useSettingsAmbience(enabled: boolean, volume: number) {
  const foreground = useAppForeground();
  const active = enabled && foreground;
  const latestVolume = useRef(volume);
  useEffect(() => {
    latestVolume.current = volume;
    setLoopingNotificationSoundVolume('ambience', volume);
  }, [volume]);

  useEffect(() => {
    if (!active) return;
    const cancellation = new AbortController();
    useAmbienceFxStore.getState().startSpawning();
    void startLoopingNotificationSound('ambience', latestVolume.current, { signal: cancellation.signal }).then(() => {
      // Volume can change while native audio configuration is pending.
      if (!cancellation.signal.aborted) setLoopingNotificationSoundVolume('ambience', latestVolume.current);
    });
    return () => {
      cancellation.abort();
      useAmbienceFxStore.getState().stopSpawning();
    };
  }, [active]);
}
