/**
 * Persistent theater video — keeps SyncedVideoPlayer mounted at the AppLayout
 * level so the iframe never gets destroyed when navigating between channels or
 * servers. When the theater channel is in view, a slot div (rendered by
 * TheaterChannel) registers its DOMRect here and the video overlays it exactly
 * using position:fixed. When navigated away the container shrinks to 1×1 px
 * (NOT display:none) so YouTube/Vimeo/native iframes keep playing.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useTheaterStore } from '../../stores/theaterStore';
import { useAuthStore } from '../../stores/authStore';
import { PERMISSIONS, hasPermission } from '../../utils/permissions';
import { SyncedVideoPlayer } from './SyncedVideoPlayer';

// ── Slot registration ──────────────────────────────────────────────────────
// TheaterChannel calls setTheaterVideoSlot(el) on mount/unmount via a ref
// callback. TheaterVideoManager polls this to know where to overlay the video.

let _slotEl: HTMLElement | null = null;
const _slotListeners = new Set<() => void>();

export function setTheaterVideoSlot(el: HTMLElement | null) {
  if (_slotEl === el) return;
  _slotEl = el;
  _slotListeners.forEach((fn) => fn());
}

// ── Fullscreen signal ──────────────────────────────────────────────────────
// SyncedVideoPlayer calls setTheaterFullscreenActive(true/false) so the wrapper
// here can escape its own stacking context (z-10, overflow:hidden) and cover
// the whole viewport above the sidebar (z-20) and floating bar (z-50).

let _fullscreenActive = false;
const _fullscreenListeners = new Set<() => void>();

type PipFrame = {
  x: number;
  y: number;
  width: number;
};

const PIP_ASPECT_RATIO = 16 / 9;
const PIP_MIN_WIDTH = 220;
const PIP_MAX_WIDTH = 720;
const PIP_MARGIN = 8;
const PIP_STORAGE_KEY = 'catrealm.theaterPipFrame';

function clampPipFrame(frame: PipFrame): PipFrame {
  if (typeof window === 'undefined') return frame;
  const viewportWidth = Math.max(320, window.innerWidth);
  const viewportHeight = Math.max(240, window.innerHeight);
  const maxWidth = Math.max(PIP_MIN_WIDTH, Math.min(PIP_MAX_WIDTH, viewportWidth - PIP_MARGIN * 2));
  const width = Math.max(PIP_MIN_WIDTH, Math.min(maxWidth, frame.width));
  const height = width / PIP_ASPECT_RATIO;
  const x = Math.max(PIP_MARGIN, Math.min(frame.x, viewportWidth - width - PIP_MARGIN));
  const y = Math.max(PIP_MARGIN, Math.min(frame.y, viewportHeight - height - PIP_MARGIN));
  return { x, y, width };
}

function getInitialPipFrame(): PipFrame {
  if (typeof window === 'undefined') return { x: 16, y: 16, width: 360 };
  try {
    const raw = window.localStorage.getItem(PIP_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PipFrame>;
      if (
        typeof parsed.x === 'number'
        && typeof parsed.y === 'number'
        && typeof parsed.width === 'number'
      ) {
        return clampPipFrame({ x: parsed.x, y: parsed.y, width: parsed.width });
      }
    }
  } catch {
    // Ignore corrupt saved PiP bounds.
  }
  return clampPipFrame({ x: window.innerWidth - 376, y: 16, width: 360 });
}

export function setTheaterFullscreenActive(active: boolean) {
  if (_fullscreenActive === active) return;
  _fullscreenActive = active;
  _fullscreenListeners.forEach((fn) => fn());
}

function useSlotRect() {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const intervalRef = useRef<number>(0);

  useEffect(() => {
    // Notify immediately when the slot element changes
    const onSlotChange = () => {
      setRect(_slotEl ? _slotEl.getBoundingClientRect() : null);
    };
    _slotListeners.add(onSlotChange);

    // Poll at 10 fps to track scroll / resize without needing ResizeObserver
    intervalRef.current = window.setInterval(() => {
      setRect(_slotEl ? _slotEl.getBoundingClientRect() : null);
    }, 100);

    onSlotChange(); // sync immediately on mount

    return () => {
      _slotListeners.delete(onSlotChange);
      window.clearInterval(intervalRef.current);
    };
  }, []);

  return rect;
}

// ── Component ──────────────────────────────────────────────────────────────

function useTheaterFullscreenActive() {
  const [active, setActive] = useState(_fullscreenActive);
  useEffect(() => {
    const sync = () => setActive(_fullscreenActive);
    _fullscreenListeners.add(sync);
    sync();
    return () => {
      _fullscreenListeners.delete(sync);
    };
  }, []);
  return active;
}

export function TheaterVideoManager() {
  const activeChannelId = useTheaterStore((s) => s.activeChannelId);
  const state = useTheaterStore((s) => s.state);
  const queue = useTheaterStore((s) => s.queue);
  const hostUserId = useTheaterStore((s) => s.hostUserId);
  const selfUserId = useTheaterStore((s) => s.selfUserId);
  const user = useAuthStore((s) => s.user);
  const rect = useSlotRect();
  const fullscreenActive = useTheaterFullscreenActive();
  const [pipFrame, setPipFrame] = useState<PipFrame>(() => getInitialPipFrame());
  const pipDragRef = useRef<{
    mode: 'move' | 'resize';
    pointerId: number;
    startX: number;
    startY: number;
    startFrame: PipFrame;
  } | null>(null);

  const currentItem = state?.current_item_id
    ? (queue.find((item) => item.id === state.current_item_id) ?? null)
    : null;

  // canPlayInTheater requires channel permissions we don't have here, so we
  // cover the two most common cases: host and manage-channels.
  const canControl =
    (selfUserId !== null && selfUserId === hostUserId) ||
    hasPermission(user?.permissions, PERMISSIONS.MANAGE_CHANNELS);
  const slotVisible = !!rect && rect.width > 0 && rect.height > 0;
  const pipVisible = !!activeChannelId && !fullscreenActive && !slotVisible;

  useEffect(() => {
    if (!pipVisible) return;
    setPipFrame((frame) => clampPipFrame(frame));
  }, [pipVisible]);

  useEffect(() => {
    if (!pipVisible) return undefined;
    const onResize = () => setPipFrame((frame) => clampPipFrame(frame));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pipVisible]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PIP_STORAGE_KEY, JSON.stringify(pipFrame));
  }, [pipFrame]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = pipDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (drag.mode === 'move') {
        setPipFrame(clampPipFrame({
          ...drag.startFrame,
          x: drag.startFrame.x + dx,
          y: drag.startFrame.y + dy,
        }));
        return;
      }
      const widthDelta = Math.max(dx, dy * PIP_ASPECT_RATIO);
      setPipFrame(clampPipFrame({
        ...drag.startFrame,
        width: drag.startFrame.width + widthDelta,
      }));
    };
    const onPointerUp = (event: PointerEvent) => {
      const drag = pipDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      pipDragRef.current = null;
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  const beginPipDrag = useCallback((mode: 'move' | 'resize', event: ReactPointerEvent<HTMLElement>) => {
    if (!pipVisible || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pipDragRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startFrame: pipFrame,
    };
  }, [pipFrame, pipVisible]);

  if (!activeChannelId) return null;

  // Fullscreen covers the viewport. A visible theater slot gets the full-size
  // player; when there is no slot, keep playback alive as a mini PiP.
  const containerStyle: CSSProperties = fullscreenActive
    ? {
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        overflow: 'hidden',
        background: '#000',
      }
    : slotVisible && rect
    ? {
        position: 'fixed',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        zIndex: 10,
        overflow: 'hidden',
        borderRadius: '0.75rem', // rounded-xl to match the slot placeholder
      }
    : {
        position: 'fixed',
        left: pipFrame.x,
        top: pipFrame.y,
        width: pipFrame.width,
        height: pipFrame.width / PIP_ASPECT_RATIO,
        overflow: 'hidden',
        borderRadius: '0.75rem',
        boxShadow: '0 18px 48px rgba(0, 0, 0, 0.45)',
        zIndex: 60,
      };

  return (
    <div style={containerStyle}>
      {pipVisible && (
        <>
          <div
            className="absolute left-0 right-0 top-0 z-50 flex h-7 cursor-move items-center justify-center bg-black/35 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/75 opacity-0 transition-opacity hover:opacity-100"
            title="Drag Theater PiP"
            onPointerDown={(event) => beginPipDrag('move', event)}
          >
            Theater PiP
          </div>
          <div
            className="absolute bottom-0 right-0 z-50 h-6 w-6 cursor-nwse-resize rounded-tl-md bg-black/45 opacity-70 transition-opacity hover:opacity-100"
            title="Resize Theater PiP"
            onPointerDown={(event) => beginPipDrag('resize', event)}
          />
        </>
      )}
      <SyncedVideoPlayer
        channelId={activeChannelId}
        canControl={canControl}
        currentItem={currentItem}
      />
    </div>
  );
}
