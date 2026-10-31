import { startTransition, useEffect, useRef, useCallback, useLayoutEffect, useState, type JSX } from 'react';
import { ServerMentionProvider } from './mentions';
import { useMessageStore } from '../../stores/messageStore';
import { useChannelStore } from '../../stores/channelStore';
import { useAuthStore } from '../../stores/authStore';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import { MessageItem } from './MessageItem';
import { MediaBatch } from './MediaBatch';
import { Spinner } from '../ui/Spinner';
import type { Message } from '../../types';
import { PERMISSIONS, hasChannelPermission } from '../../utils/permissions';
import { useViewedChannels } from '../../hooks/useViewedChannels';
import { AnimatePresence, motion } from 'motion/react';
import { useMotionProfile } from '../../lib/motion';
import { scrollToBottom } from '../../utils/scroll';
import { isAppInBackground } from '../../lib/desktopNotifications';
import { shouldShowMessageHeader } from './messageGrouping';

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_SCHEDULED: Message[] = [];
// Rows mounted in the first frame after a channel switch. Enough to fill the
// viewport at the bottom; the older rows follow in an interruptible transition
// so the switch itself is one short frame instead of mounting the whole history.
const INITIAL_RENDER_COUNT = 20;

export function MessageList({ highlightedMessageId }: { highlightedMessageId?: string | null }) {
  const activeChannelId = useChannelStore((s) => s.activeChannelId);
  const channels = useViewedChannels();
  const userPermissions = useAuthStore((s) => s.user?.permissions);
  const messagesByChannel = useMessageStore((s) => s.messagesByChannel);
  const scheduledByChannel = useMessageStore((s) => s.scheduledByChannel);
  const scheduledMessages = activeChannelId ? (scheduledByChannel[activeChannelId] ?? EMPTY_SCHEDULED) : EMPTY_SCHEDULED;
  const messages = (activeChannelId ? messagesByChannel[activeChannelId] : undefined) ?? EMPTY_MESSAGES;
  const allHasMore = useMessageStore((s) => s.hasMore);
  const hasMore = activeChannelId ? (allHasMore[activeChannelId] ?? true) : false;
  const allLoadingMore = useMessageStore((s) => s.loadingMore);
  const loadingMore = activeChannelId ? (allLoadingMore[activeChannelId] ?? false) : false;
  const allLoadFailed = useMessageStore((s) => s.loadFailed);
  const loadFailed = activeChannelId ? (allLoadFailed[activeChannelId] ?? false) : false;
  const fetchMessages = useMessageStore((s) => s.fetchMessages);
  const clearLoadFailure = useMessageStore((s) => s.clearLoadFailure);
  const setAtBottom = useChannelStore((s) => s.setAtBottom);
  const setChannelPrefs = useChannelStore((s) => s.setChannelPrefs);
  const resetCounts = useChannelStore((s) => s.resetCounts);
  const activeChannel = channels.find((c) => c.id === activeChannelId);
  const canReadHistory = hasChannelPermission(
    userPermissions,
    activeChannel?.effective_permissions,
    PERMISSIONS.READ_CHAT_HISTORY
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const wasAtBottom = useRef(true);
  const lastScrollTop = useRef(0);
  const prevScrollHeight = useRef(0);
  const prevMessagesLen = useRef(0);
  const [newSinceRead, setNewSinceRead] = useState(0);
  const motionProfile = useMotionProfile();
  // Re-arm the partial first render on channel switch and when an empty
  // (uncached) channel's first page arrives.
  const renderKey = `${activeChannelId ?? ''}:${messages.length > 0}`;
  const [fullyRenderedKey, setFullyRenderedKey] = useState<string | null>(null);
  const renderAll = fullyRenderedKey === renderKey;

  // An older page arrives as one store update. Commit it with its rows still
  // hidden, then mount them in a transition so a fast scroll up never stalls
  // on 50 rows at once. Derived during render so the first commit is cheap.
  const firstMessageId = messages[0]?.id ?? null;
  const [prevFirst, setPrevFirst] = useState({ channelId: activeChannelId, messageId: firstMessageId });
  const [hiddenOlderCount, setHiddenOlderCount] = useState(0);
  if (prevFirst.channelId !== activeChannelId || prevFirst.messageId !== firstMessageId) {
    const previousFirstIndex = prevFirst.channelId === activeChannelId && prevFirst.messageId
      ? messages.findIndex((m) => m.id === prevFirst.messageId)
      : -1;
    setPrevFirst({ channelId: activeChannelId, messageId: firstMessageId });
    setHiddenOlderCount(renderAll && previousFirstIndex > 0 ? previousFirstIndex : 0);
  }

  // Track if user was at bottom before new messages arrive
  const checkAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const movedUp = el.scrollTop < lastScrollTop.current - 1;
    lastScrollTop.current = el.scrollTop;
    // Only a scroll upward leaves the bottom. Media growing under a pinned
    // view also fires scroll with a gap, and must not cancel the re-pin.
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50 || (wasAtBottom.current && !movedUp);
    // Scroll fires every frame; only touch the stores (and the read-state API)
    // when crossing the bottom threshold, not on every wheel tick.
    if (atBottom === wasAtBottom.current) return;
    wasAtBottom.current = atBottom;
    if (activeChannelId) setAtBottom(activeChannelId, atBottom);
    if (atBottom && activeChannelId && newSinceRead <= 20 && !isAppInBackground()) {
      setNewSinceRead(0);
      resetCounts(activeChannelId);
      void setChannelPrefs(activeChannelId, { lastReadAt: Math.floor(Date.now() / 1000) }).catch(() => {});
    }
  }, [activeChannelId, newSinceRead, resetCounts, setAtBottom, setChannelPrefs]);

  // Load more (older) messages
  const loadMore = useCallback(() => {
    if (!activeChannelId || messages.length === 0) return;
    prevScrollHeight.current = containerRef.current?.scrollHeight ?? 0;
    fetchMessages(activeChannelId, messages[0].created_at);
  }, [activeChannelId, messages, fetchMessages]);

  const retryLoadMore = useCallback(() => {
    if (!activeChannelId) return;
    clearLoadFailure(activeChannelId);
    loadMore();
  }, [activeChannelId, clearLoadFailure, loadMore]);

  // A failed fetch disarms auto-loading until the user retries or switches
  // channels — otherwise the sentinel keeps re-triggering against an error.
  const sentinelRef = useInfiniteScroll(containerRef, loadMore, hasMore && !loadFailed && renderAll && hiddenOlderCount === 0, loadingMore);

  // Fetch messages on first visit to a channel and when read-history permission is granted.
  useEffect(() => {
    if (!activeChannelId || !canReadHistory) return;
    const existing = useMessageStore.getState().messagesByChannel[activeChannelId];
    if (!existing || existing.length === 0) {
      fetchMessages(activeChannelId);
    }
  }, [activeChannelId, canReadHistory, fetchMessages]);

  // Scroll to bottom on initial load or new messages (if was at bottom)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const isNewMessage = messages.length > prevMessagesLen.current;
    prevMessagesLen.current = messages.length;

    if (isNewMessage && wasAtBottom.current) {
      scrollToBottom(el);
      if (activeChannelId && !isAppInBackground()) {
        setNewSinceRead(0);
        resetCounts(activeChannelId);
        void setChannelPrefs(activeChannelId, { lastReadAt: Math.floor(Date.now() / 1000) }).catch(() => {});
      }
    } else if (isNewMessage && prevScrollHeight.current === 0) {
      setNewSinceRead((c) => c + 1);
    }
  }, [messages]);

  // Preserve scroll position when older messages are prepended (once their
  // rows have actually mounted, not when the page lands in the store).
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || prevScrollHeight.current === 0 || hiddenOlderCount > 0) return;

    const newScrollHeight = el.scrollHeight;
    if (newScrollHeight > prevScrollHeight.current) {
      el.scrollTop = newScrollHeight - prevScrollHeight.current;
    }
    prevScrollHeight.current = 0;
  }, [messages, hiddenOlderCount]);

  useEffect(() => {
    if (hiddenOlderCount > 0) startTransition(() => setHiddenOlderCount(0));
  }, [hiddenOlderCount]);

  // Mount the rest of the history once the first frame has painted.
  useEffect(() => {
    if (renderAll) return undefined;
    let timeoutId: number | null = null;
    const frameId = requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        startTransition(() => setFullyRenderedKey(renderKey));
      }, 0);
    });
    return () => {
      cancelAnimationFrame(frameId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [renderAll, renderKey]);

  // Older rows landing above must not push a pinned view off the bottom.
  useLayoutEffect(() => {
    if (renderAll && wasAtBottom.current) scrollToBottom(containerRef.current);
  }, [renderAll]);

  // Scroll to highlighted (search match) message
  useEffect(() => {
    if (!highlightedMessageId || !renderAll) return;
    const el = document.getElementById(`msg-${highlightedMessageId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightedMessageId, renderAll]);

  // Auto-scroll to bottom on channel switch
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      requestAnimationFrame(() => {
        // Channel switch / initial load — jump instantly (smooth would scroll
        // through the entire history).
        scrollToBottom(el);
      });
    }
    wasAtBottom.current = true;
    prevMessagesLen.current = messages.length;
    setNewSinceRead(0);
    if (activeChannelId) {
      clearLoadFailure(activeChannelId);
      setAtBottom(activeChannelId, true);
      if (!isAppInBackground()) {
        void setChannelPrefs(activeChannelId, { lastReadAt: Math.floor(Date.now() / 1000) }).catch(() => {});
        resetCounts(activeChannelId);
      }
    }
  }, [activeChannelId]);

  useEffect(() => {
    if (!activeChannelId) return;
    const markVisibleChannelRead = () => {
      if (isAppInBackground() || !wasAtBottom.current) return;
      resetCounts(activeChannelId);
      void setChannelPrefs(activeChannelId, { lastReadAt: Math.floor(Date.now() / 1000) }).catch(() => {});
    };
    window.addEventListener('focus', markVisibleChannelRead);
    document.addEventListener('visibilitychange', markVisibleChannelRead);
    return () => {
      window.removeEventListener('focus', markVisibleChannelRead);
      document.removeEventListener('visibilitychange', markVisibleChannelRead);
    };
  }, [activeChannelId, resetCounts, setChannelPrefs]);

  // Images, stickers, embeds, and video metadata can change row height after the
  // initial message scroll. Stay pinned only when the user was already at the
  // bottom; an intentional scroll upward must never be overridden.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    let frameId: number | null = null;
    const keepPinnedAfterMediaLayout = (event: Event) => {
      if (!wasAtBottom.current) return;
      const target = event.target;
      if (!(target instanceof HTMLImageElement) && !(target instanceof HTMLVideoElement)) return;
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        frameId = null;
        if (wasAtBottom.current) scrollToBottom(el);
      });
    };

    // `load` does not bubble, so listen during capture. loadedmetadata covers
    // videos whose intrinsic aspect ratio arrives after the first render.
    el.addEventListener('load', keepPinnedAfterMediaLayout, true);
    el.addEventListener('loadedmetadata', keepPinnedAfterMediaLayout, true);
    return () => {
      el.removeEventListener('load', keepPinnedAfterMediaLayout, true);
      el.removeEventListener('loadedmetadata', keepPinnedAfterMediaLayout, true);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <ServerMentionProvider>
    <div
      ref={containerRef}
      className="flex-1 min-h-0 overflow-y-auto"
      onScroll={checkAtBottom}
    >
      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="h-1" />

      {loadingMore && (
        <div className="flex justify-center py-3">
          <Spinner size="sm" />
        </div>
      )}

      {loadFailed && !loadingMore && (
        <div className="flex flex-col items-center gap-2 py-3 text-text-muted text-sm">
          <span>Couldn't load older messages.</span>
          <button
            type="button"
            onClick={retryLoadMore}
            className="px-3 py-1 rounded-md bg-bg-tertiary hover:bg-bg-hover text-text-primary text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {!hasMore && !loadFailed && messages.length > 0 && (
        <div className="text-center py-6 text-text-muted text-sm">
          This is the beginning of the channel.
        </div>
      )}

      {messages.length === 0 && !loadingMore && (
        <div className="flex flex-col items-center justify-center h-full text-text-muted">
          <p className="text-lg mb-1">No messages yet</p>
          <p className="text-sm">Be the first to send a message!</p>
        </div>
      )}

      {(() => {
        const nodes: JSX.Element[] = [];
        const isAttachmentOnly = (m: Message) =>
          !!m.attachment_url &&
          (!m.content || m.content.trim().length === 0) &&
          m.message_type !== 'system';
        const canBatchWith = (base: Message, next: Message) =>
          isAttachmentOnly(next) &&
          base.user_id === next.user_id &&
          base.channel_id === next.channel_id &&
          Math.abs(next.created_at - base.created_at) <= 10;

        const startIndex = renderAll ? hiddenOlderCount : Math.max(0, messages.length - INITIAL_RENDER_COUNT);
        for (let i = startIndex; i < messages.length; i += 1) {
          const msg = messages[i];
          const prev = messages[i - 1];
          const showHeader = shouldShowMessageHeader(msg, prev);

          const next = messages[i + 1];
          if (isAttachmentOnly(msg) && next && canBatchWith(msg, next)) {
            const batch: Message[] = [msg];
            let j = i + 1;
            while (j < messages.length && canBatchWith(msg, messages[j])) {
              batch.push(messages[j]);
              j += 1;
            }
            nodes.push(
              <div key={`batch-${msg.id}`} className="chat-render-boundary">
                <MediaBatch messages={batch} showHeader={showHeader} highlightedMessageId={highlightedMessageId} />
              </div>
            );
            i = j - 1;
            continue;
          }

          nodes.push(
            <div key={msg.id} className="chat-render-boundary">
              <MessageItem message={msg} showHeader={showHeader} isHighlighted={msg.id === highlightedMessageId} />
            </div>
          );
        }

        return nodes;
      })()}

      <AnimatePresence>
        {newSinceRead > 20 && (
          <motion.div
            className="sticky bottom-2 flex justify-center"
            variants={motionProfile.slideUpVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <button
              className="bg-accent text-white text-xs px-3 py-1.5 rounded-full shadow transition-transform active:scale-95"
              onClick={() => {
                const el = containerRef.current;
                if (el) scrollToBottom(el);
                if (activeChannelId) {
                  setNewSinceRead(0);
                  resetCounts(activeChannelId);
                  void setChannelPrefs(activeChannelId, { lastReadAt: Math.floor(Date.now() / 1000) }).catch(() => {});
                }
              }}
            >
              Alright, I'm caught up
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {scheduledMessages.length > 0 && (
        <>
          <div className="mx-4 my-2 flex items-center gap-2 border-t border-dashed border-border/50 pt-2">
            <span className="text-xs text-text-muted">Scheduled</span>
          </div>
          {[...scheduledMessages]
            .sort((a, b) => (a.scheduled_at ?? 0) - (b.scheduled_at ?? 0))
            .map(msg => (
              <MessageItem key={msg.id} message={msg} showHeader isScheduled />
            ))}
        </>
      )}

      {/* Bottom padding */}
      <div className="h-2" />
    </div>
    </ServerMentionProvider>
  );
}
