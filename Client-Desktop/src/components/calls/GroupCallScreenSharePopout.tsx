import { useEffect, useRef, useState } from 'react';
import { useCallStore } from '../../stores/callStore';
import { useMediaStore } from '../../stores/mediaStore';

type GroupCallScreenSharePopoutProps = {
  visible: boolean;
  onReturnToCall: () => void;
};

type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type ResizeDirection = 'bottom-left' | 'top-left';

const MIN_WIDTH = 280;
const MIN_HEIGHT = 180;

function hasLiveVideo(stream: MediaStream | null) {
  return !!stream?.getVideoTracks().some((track) => track.readyState === 'live' && track.enabled);
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

export function GroupCallScreenSharePopout({ visible, onReturnToCall }: GroupCallScreenSharePopoutProps) {
  const activeGroupCall = useCallStore((s) => s.activeGroupCall);
  const isSharingScreen = useCallStore((s) => s.isSharingScreen);
  const remoteTracks = useMediaStore((s) => s.remoteTracks);
  const localScreenShareStream = useMediaStore((s) => s.localScreenShareStream);

  const remoteShareParticipant = (activeGroupCall?.participants || []).find((participant) => (
    participant.userId !== (localStorage.getItem('userId') || '')
    && participant.sharingScreen
    && hasLiveVideo(Object.values(remoteTracks).find((track) => (
      track.participantId === participant.userId
      && track.source === 'screen_share'
      && track.kind === 'video'
    ))?.mediaStream ?? null)
  )) || null;

  const remoteShareStream = remoteShareParticipant
    ? Object.values(remoteTracks).find((track) => (
      track.participantId === remoteShareParticipant.userId
      && track.source === 'screen_share'
      && track.kind === 'video'
    ))?.mediaStream ?? null
    : null;
  const hasRemoteShare = !!remoteShareParticipant && hasLiveVideo(remoteShareStream);
  const hasLocalShare = isSharingScreen && hasLiveVideo(localScreenShareStream);
  const show = visible && !!activeGroupCall && activeGroupCall.status === 'active' && (hasRemoteShare || hasLocalShare);

  const selectedStream = hasRemoteShare ? remoteShareStream : (hasLocalShare ? localScreenShareStream : null);
  const title = hasRemoteShare
    ? `${remoteShareParticipant?.displayName || remoteShareParticipant?.username || 'Member'} is sharing`
    : 'You are sharing';

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [rect, setRect] = useState<Rect>(() => {
    if (typeof window === 'undefined') {
      return { left: 24, top: 96, width: 360, height: 220 };
    }
    return {
      left: Math.max(24, window.innerWidth - 384),
      top: 96,
      width: 360,
      height: 220,
    };
  });
  const rectRef = useRef<Rect>(rect);
  const dragRef = useRef<{ active: boolean; offsetX: number; offsetY: number }>({
    active: false,
    offsetX: 0,
    offsetY: 0,
  });
  const resizeRef = useRef<{
    active: boolean;
    direction: ResizeDirection;
    startX: number;
    startY: number;
    startRect: Rect;
  }>({
    active: false,
    direction: 'bottom-left',
    startX: 0,
    startY: 0,
    startRect: { left: 0, top: 0, width: 0, height: 0 },
  });

  useEffect(() => {
    if (!show || !videoRef.current || !selectedStream) return;
    videoRef.current.srcObject = selectedStream;
    void videoRef.current.play().catch(() => {});
  }, [show, selectedStream]);

  useEffect(() => {
    rectRef.current = rect;
  }, [rect]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (dragRef.current.active) {
        const currentRect = rectRef.current;
        const nextLeft = event.clientX - dragRef.current.offsetX;
        const nextTop = event.clientY - dragRef.current.offsetY;
        const maxLeft = Math.max(0, window.innerWidth - currentRect.width);
        const maxTop = Math.max(0, window.innerHeight - currentRect.height);
        setRect((prev) => ({
          ...prev,
          left: clamp(nextLeft, 0, maxLeft),
          top: clamp(nextTop, 0, maxTop),
        }));
        return;
      }

      if (!resizeRef.current.active) return;

      const { direction, startX, startY, startRect } = resizeRef.current;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const rightEdge = startRect.left + startRect.width;
      const bottomEdge = startRect.top + startRect.height;

      let nextLeft = startRect.left;
      let nextTop = startRect.top;
      let nextWidth = startRect.width;
      let nextHeight = startRect.height;

      const maxWidthFromLeftDrag = Math.min(rightEdge, viewportWidth);
      nextWidth = clamp(startRect.width - dx, MIN_WIDTH, maxWidthFromLeftDrag);
      nextLeft = clamp(rightEdge - nextWidth, 0, Math.max(0, viewportWidth - nextWidth));

      if (direction === 'bottom-left') {
        nextHeight = clamp(startRect.height + dy, MIN_HEIGHT, Math.max(MIN_HEIGHT, viewportHeight - startRect.top));
      } else {
        const maxHeightFromTopDrag = Math.min(bottomEdge, viewportHeight);
        nextHeight = clamp(startRect.height - dy, MIN_HEIGHT, maxHeightFromTopDrag);
        nextTop = clamp(bottomEdge - nextHeight, 0, Math.max(0, viewportHeight - nextHeight));
      }

      setRect({
        left: nextLeft,
        top: nextTop,
        width: nextWidth,
        height: nextHeight,
      });
    };

    const onUp = () => {
      dragRef.current.active = false;
      resizeRef.current.active = false;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startResize = (direction: ResizeDirection) => (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    resizeRef.current = {
      active: true,
      direction,
      startX: event.clientX,
      startY: event.clientY,
      startRect: {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
    };
    setRect((prev) => ({
      ...prev,
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    }));
  };

  if (!show || !selectedStream) return null;

  return (
    <div
      ref={containerRef}
      className="fixed z-50 rounded-lg border border-border bg-bg-elevated shadow-2xl overflow-hidden min-w-[280px] min-h-[180px]"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        resize: 'both',
      }}
    >
      <div
        className="h-8 px-3 bg-bg-sidebar border-b border-border flex items-center justify-between cursor-move select-none"
        onMouseDown={(event) => {
          const bounds = containerRef.current?.getBoundingClientRect();
          if (!bounds) return;
          dragRef.current.active = true;
          dragRef.current.offsetX = event.clientX - bounds.left;
          dragRef.current.offsetY = event.clientY - bounds.top;
          setRect((prev) => ({ ...prev, width: bounds.width, height: bounds.height }));
        }}
      >
        <span className="text-xs text-text-primary truncate">{title}</span>
        <button
          onClick={onReturnToCall}
          onMouseDown={(event) => event.stopPropagation()}
          className="text-[11px] px-2 py-0.5 rounded bg-bg-hover text-text-primary"
          title="Return to call"
        >
          Open Call
        </button>
      </div>
      <div className="w-full h-[calc(100%-2rem)] bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={!hasRemoteShare}
          className="w-full h-full object-contain"
        />
      </div>
      <div
        className="absolute left-0 bottom-0 z-30 w-4 h-4 cursor-nesw-resize"
        onMouseDown={startResize('bottom-left')}
        title="Resize"
      />
      <div
        className="absolute left-0 top-0 z-30 w-4 h-4 cursor-nwse-resize"
        onMouseDown={startResize('top-left')}
        title="Resize"
      />
    </div>
  );
}
