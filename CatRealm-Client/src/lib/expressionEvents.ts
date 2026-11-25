import { useEffect, useRef } from 'react';
import { markExpressionLookupStale } from '../messaging/chatlib/messageTokenParser';

const EXPRESSIONS_CHANGED_EVENT = 'catrealm:expressions-changed';

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** A realm added, renamed or removed emotes/stickers: refresh every cached copy of its list. */
export function notifyExpressionsChanged(serverUrl: string): void {
  const origin = originOf(serverUrl);
  if (!origin) return;
  markExpressionLookupStale(origin);
  window.dispatchEvent(new CustomEvent(EXPRESSIONS_CHANGED_EVENT, { detail: { origin } }));
}

/** Drops cached manifests for the changed realm so the component's auto-load refetches them. */
export function useDropManifestsOnExpressionsChanged<T>(
  setStateByServer: (update: (prev: Record<string, T>) => Record<string, T>) => void,
): void {
  const setRef = useRef(setStateByServer);
  setRef.current = setStateByServer;
  useEffect(() => {
    const onChanged = (event: Event) => {
      const origin = (event as CustomEvent<{ origin?: string }>).detail?.origin;
      if (!origin) return;
      setRef.current((prev) => {
        const stale = Object.keys(prev).filter((url) => originOf(url) === origin);
        if (stale.length === 0) return prev;
        const next = { ...prev };
        for (const url of stale) delete next[url];
        return next;
      });
    };
    window.addEventListener(EXPRESSIONS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(EXPRESSIONS_CHANGED_EVENT, onChanged);
  }, []);
}
