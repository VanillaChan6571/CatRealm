import { useEffect } from 'react';
import { useChannelStore } from '../stores/channelStore';
import { isAppInBackground } from '../lib/desktopNotifications';

/** Clears a channel's unread badge and saves "read up to now" on the realm. */
export function markChannelRead(channelId: string): void {
  const channelState = useChannelStore.getState();
  channelState.resetCounts(channelId);
  void channelState.setChannelPrefs(channelId, { lastReadAt: Math.floor(Date.now() / 1000) }).catch(() => {});
}

/**
 * Read tracking for channel views that have no MessageList (forums): MessageList is what
 * normally marks a channel read, so without this a forum's unread badge can never be cleared.
 * Marks the channel read when it opens and when the app returns to the foreground, and flags
 * it as "at the bottom" so activity arriving while it is on screen is read straight away.
 */
export function useMarkChannelReadWhileOpen(channelId: string): void {
  useEffect(() => {
    const markIfVisible = () => {
      if (!isAppInBackground()) markChannelRead(channelId);
    };
    useChannelStore.getState().setAtBottom(channelId, true);
    markIfVisible();
    window.addEventListener('focus', markIfVisible);
    document.addEventListener('visibilitychange', markIfVisible);
    return () => {
      window.removeEventListener('focus', markIfVisible);
      document.removeEventListener('visibilitychange', markIfVisible);
    };
  }, [channelId]);
}
