import { useEffect } from 'react';
import { isAppInBackground } from '../lib/desktopNotifications';
import { useChannelStore } from '../stores/channelStore';
import { useThreadStore } from '../stores/threadStore';

/** Opening a post reads only that post. The forum list itself does not move any read position. */
export function useMarkForumPostReadWhileOpen(channelId: string, postId: string): void {
  useEffect(() => {
    const markIfVisible = () => {
      if (!isAppInBackground()) {
        void useThreadStore.getState().markForumPostRead(channelId, postId).catch(() => {});
      }
    };
    useChannelStore.getState().setAtBottom(channelId, false);
    useThreadStore.getState().setActiveForumPost(postId);
    markIfVisible();
    window.addEventListener('focus', markIfVisible);
    document.addEventListener('visibilitychange', markIfVisible);
    return () => {
      useThreadStore.getState().setActiveForumPost(null);
      window.removeEventListener('focus', markIfVisible);
      document.removeEventListener('visibilitychange', markIfVisible);
    };
  }, [channelId, postId]);
}
