import { useCallback, useEffect, useRef } from 'react';

const DEFAULT_UNMUTE_PCT = 100;

/**
 * Remembers the most recent audible level so the mute button can restore what
 * the user was actually listening at. Toggling straight back to 100% blasts
 * anyone who had deliberately turned a stream down to 10%.
 *
 * Falls back to `fallbackPct` only when there is no audible level to return to
 * (muted before the volume was ever raised, e.g. a persisted 0 on mount).
 */
export function useLastAudibleVolume(volumePct: number, fallbackPct = DEFAULT_UNMUTE_PCT) {
  const lastAudibleRef = useRef(volumePct > 0 ? volumePct : fallbackPct);

  useEffect(() => {
    if (volumePct > 0) lastAudibleRef.current = volumePct;
  }, [volumePct]);

  return useCallback(
    () => (lastAudibleRef.current > 0 ? lastAudibleRef.current : fallbackPct),
    [fallbackPct]
  );
}
