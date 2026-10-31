import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Clapperboard, GripVertical, Hash, Image as ImageIcon, Megaphone, MessageSquare, Users, Volume2, X } from 'lucide-react';
import { usePinnedStore, pinKey, type DockSide, type PinnedItem } from '../../stores/pinnedStore';
import { useServerStore } from '../../stores/serverStore';
import { useChannelStore } from '../../stores/channelStore';
import { useDMStore } from '../../stores/dmStore';
import { useGroupChatStore } from '../../stores/groupChatStore';
import { AvatarImage } from '../ui/AvatarImage';
import { AUTH_BASE } from '../../lib/authApi';
import { resolveAvatarUrl } from '../../utils/avatar';
import { groupChatFallbackBackground } from '../../utils/groupChatAvatar';
import { navigateToPinned } from '../../lib/pinnedNavigation';
import type { Tab } from '../home/HomeNav';
import type { Channel } from '../../types';

function channelTypeIcon(type: Channel['type']): ReactNode {
  switch (type) {
    case 'voice':
      return <Volume2 className="h-3.5 w-3.5" />;
    case 'media':
      return <ImageIcon className="h-3.5 w-3.5" />;
    case 'announcement':
      return <Megaphone className="h-3.5 w-3.5" />;
    case 'forum':
      return <MessageSquare className="h-3.5 w-3.5" />;
    case 'theater':
      return <Clapperboard className="h-3.5 w-3.5" />;
    default:
      return <Hash className="h-3.5 w-3.5" />;
  }
}

// Pick the nearest window edge for a drop point (used by the reposition handle).
function sideFromPoint(x: number, y: number): DockSide {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dist: Record<DockSide, number> = { left: x, right: w - x, top: y, bottom: h - y };
  return (Object.keys(dist) as DockSide[]).reduce((best, side) => (dist[side] < dist[best] ? side : best), 'bottom');
}

const ENTER_KEYFRAMES: Record<DockSide, string> = {
  bottom: 'pinbarInBottom',
  top: 'pinbarInTop',
  left: 'pinbarInLeft',
  right: 'pinbarInRight',
};
const LEAVE_KEYFRAMES: Record<DockSide, string> = {
  bottom: 'pinbarOutBottom',
  top: 'pinbarOutTop',
  left: 'pinbarOutLeft',
  right: 'pinbarOutRight',
};
const EDGE_BORDER: Record<DockSide, string> = {
  bottom: 'border-t',
  top: 'border-b',
  left: 'border-r',
  right: 'border-l',
};

interface PinnedTaskbarProps {
  onNavigateHomeTab?: (tab: Tab) => void;
}

// Windows-taskbar-style strip docked to a window edge. Auto-hides when nothing is
// pinned, animates in/out on the first/last pin, and can be dragged to another edge.
export function PinnedTaskbar({ onNavigateHomeTab }: PinnedTaskbarProps) {
  const pinnedItems = usePinnedStore((s) => s.pinnedItems);
  const requestTogglePin = usePinnedStore((s) => s.requestTogglePin);
  const reorderPins = usePinnedStore((s) => s.reorderPins);
  const dockSide = usePinnedStore((s) => s.dockSide);
  const setDockSide = usePinnedStore((s) => s.setDockSide);
  const locked = usePinnedStore((s) => s.locked);
  const rotated = usePinnedStore((s) => s.rotated);
  const toggleLocked = usePinnedStore((s) => s.toggleLocked);
  const toggleRotated = usePinnedStore((s) => s.toggleRotated);

  const activeServerUrl = useServerStore((s) => s.activeServerUrl);
  const servers = useServerStore((s) => s.servers);
  const activeChannelId = useChannelStore((s) => s.activeChannelId);
  const unreadByChannel = useChannelStore((s) => s.unreadByChannel);
  const mentionByChannel = useChannelStore((s) => s.mentionByChannel);
  const conversations = useDMStore((s) => s.conversations);
  const activeConversationId = useDMStore((s) => s.activeConversationId);
  const groups = useGroupChatStore((s) => s.groups);
  const activeGroupId = useGroupChatStore((s) => s.activeGroupId);

  const [dragKey, setDragKey] = useState<string | null>(null);
  const [anim, setAnim] = useState<'enter' | 'leave' | 'move' | null>(null);
  const [repositioning, setRepositioning] = useState(false);
  const [hoverSide, setHoverSide] = useState<DockSide>(dockSide);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const prevLen = useRef(pinnedItems.length);
  const prevDock = useRef(dockSide);
  const lastItems = useRef<PinnedItem[]>(pinnedItems);
  const menuRef = useRef<HTMLDivElement>(null);

  // Keep the context menu inside the viewport (it opens at the cursor, which on a
  // bottom/right dock sits near the edge and would otherwise overflow off-screen).
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const pad = 8;
    const x = Math.max(pad, Math.min(menu.x, window.innerWidth - rect.width - pad));
    const y = Math.max(pad, Math.min(menu.y, window.innerHeight - rect.height - pad));
    if (x !== menu.x || y !== menu.y) setMenu({ x, y });
  }, [menu]);

  // Keep the last non-empty snapshot so the leave animation can render the chips
  // that were just removed instead of an empty bar.
  useEffect(() => {
    if (pinnedItems.length > 0) lastItems.current = pinnedItems;
  }, [pinnedItems]);

  // Trigger enter (slide-in + first-pin shake) on 0→>0 and leave (slide-out) on >0→0.
  // useLayoutEffect so the animation is applied before paint (no at-rest flash frame).
  useLayoutEffect(() => {
    const prev = prevLen.current;
    const len = pinnedItems.length;
    prevLen.current = len;
    if (prev === 0 && len > 0) {
      setAnim('enter');
      const t = setTimeout(() => setAnim(null), 760);
      return () => clearTimeout(t);
    }
    if (prev > 0 && len === 0) {
      setAnim('leave');
      const t = setTimeout(() => setAnim(null), 250);
      return () => clearTimeout(t);
    }
  }, [pinnedItems.length]);

  // Re-dock: slide the bar in from its new edge so the move reads as motion.
  useLayoutEffect(() => {
    if (prevDock.current === dockSide) return;
    prevDock.current = dockSide;
    if (pinnedItems.length === 0) return;
    setAnim('move');
    const t = setTimeout(() => setAnim(null), 300);
    return () => clearTimeout(t);
  }, [dockSide]);

  const isRow = dockSide === 'left' || dockSide === 'right';
  const isLeaving = anim === 'leave';

  if (pinnedItems.length === 0 && !isLeaving) return null;

  const itemsToRender = isLeaving ? lastItems.current : pinnedItems;

  const animStyle: CSSProperties = {};
  if (anim === 'enter') {
    animStyle.animation = `${ENTER_KEYFRAMES[dockSide]} 320ms cubic-bezier(.2,.8,.2,1), ${isRow ? 'pinbarShakeY' : 'pinbarShakeX'} 420ms ease-in-out 340ms`;
  } else if (anim === 'move') {
    animStyle.animation = `${ENTER_KEYFRAMES[dockSide]} 280ms cubic-bezier(.2,.8,.2,1)`;
  } else if (anim === 'leave') {
    animStyle.animation = `${LEAVE_KEYFRAMES[dockSide]} 240ms ease-in forwards`;
    animStyle.pointerEvents = 'none';
  }

  const handleDrop = (targetKey: string) => {
    if (!dragKey || dragKey === targetKey) {
      setDragKey(null);
      return;
    }
    const keys = itemsToRender.map(pinKey);
    const from = keys.indexOf(dragKey);
    const to = keys.indexOf(targetKey);
    if (from === -1 || to === -1) {
      setDragKey(null);
      return;
    }
    keys.splice(from, 1);
    keys.splice(to, 0, dragKey);
    reorderPins(keys);
    setDragKey(null);
  };

  const countBadge = (count: number, tone: 'mention' | 'unread' | 'accent'): ReactNode => {
    if (count <= 0) return null;
    const cls =
      tone === 'mention'
        ? 'bg-danger text-white'
        : tone === 'unread'
          ? 'bg-white text-black'
          : 'bg-accent text-white';
    return (
      <span className={`ml-0.5 shrink-0 ${cls} text-[10px] leading-none px-1.5 py-0.5 rounded-full font-semibold`}>
        {count}
      </span>
    );
  };

  // "Rotate" only applies on a side dock: chips become slim vertical-text columns.
  const rotatedActive = isRow && rotated;
  const containerClass = !isRow
    ? `flex items-center gap-1 h-11 px-2 overflow-x-auto ${EDGE_BORDER[dockSide]}`
    : rotatedActive
      ? `flex flex-col items-center gap-1 w-12 h-full py-2 px-1 overflow-y-auto ${EDGE_BORDER[dockSide]}`
      : `flex flex-col gap-1 w-44 h-full py-2 px-1.5 overflow-y-auto ${EDGE_BORDER[dockSide]}`;

  return (
    <>
    <div
      className={`shrink-0 bg-bg-sidebar border-border ${containerClass} ${anim ? 'pinbar-animated' : ''}`}
      style={animStyle}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <span
        onPointerDown={(e: ReactPointerEvent) => {
          if (locked) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setHoverSide(dockSide);
          setRepositioning(true);
        }}
        onPointerMove={(e: ReactPointerEvent) => {
          if (!repositioning) return;
          setHoverSide(sideFromPoint(e.clientX, e.clientY));
        }}
        onPointerUp={(e: ReactPointerEvent) => {
          if (!repositioning) return;
          (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
          setRepositioning(false);
          const target = sideFromPoint(e.clientX, e.clientY);
          if (target !== dockSide) setDockSide(target);
        }}
        className={`shrink-0 flex items-center justify-center text-text-muted touch-none ${
          locked ? 'opacity-40 cursor-default' : 'hover:text-text-secondary cursor-move'
        } ${isRow ? 'w-full h-5' : 'h-full px-0.5'}`}
        title={locked ? 'Taskbar locked (right-click to unlock)' : 'Drag to move the taskbar to another edge'}
      >
        <GripVertical className="h-4 w-4" />
      </span>
      {itemsToRender.map((item) => {
        const key = pinKey(item);
        let label = '';
        let icon: ReactNode = null;
        let badge: ReactNode = null;
        let active = false;

        if (item.type === 'channel') {
          label = item.name;
          const onActiveServer = activeServerUrl === item.serverUrl;
          const server = servers.find((s) => s.url === item.serverUrl);
          const serverIcon = server?.icon ?? item.serverIcon;
          icon = serverIcon ? (
            <img src={serverIcon} alt={item.serverName} className="w-5 h-5 rounded object-cover shrink-0" />
          ) : (
            <span className="w-5 h-5 rounded bg-bg-hover flex items-center justify-center text-[9px] font-bold text-text-secondary shrink-0">
              {item.serverName.charAt(0).toUpperCase()}
            </span>
          );
          active = onActiveServer && activeChannelId === item.channelId;
          const mentions = onActiveServer ? mentionByChannel[item.channelId] ?? 0 : 0;
          const unread = onActiveServer ? unreadByChannel[item.channelId] ?? 0 : 0;
          badge = mentions > 0 ? countBadge(mentions, 'mention') : countBadge(unread, 'unread');
        } else if (item.type === 'dm') {
          const conv = conversations.find((c) => c.otherUserId === item.otherUserId);
          label = conv ? conv.otherDisplayName || conv.otherUsername : item.username;
          const avatar = resolveAvatarUrl((conv?.otherAvatar ?? item.avatar) ?? undefined, AUTH_BASE, 'central');
          icon = (
            <AvatarImage
              src={avatar}
              alt={label}
              size={20}
              className="w-5 h-5 rounded-full object-cover shrink-0"
              fallback={<span>{label.charAt(0).toUpperCase()}</span>}
            />
          );
          active = !activeServerUrl && conv != null && activeConversationId === conv.id;
          badge = countBadge(conv?.unreadCount ?? 0, 'accent');
        } else {
          const group = groups.find((g) => g.id === item.groupId);
          label = group?.name ?? item.name;
          const avatar = resolveAvatarUrl((group?.avatar ?? item.avatar) ?? undefined, AUTH_BASE, 'central');
          const bg = groupChatFallbackBackground(item.groupId || label || 'group-chat');
          icon = (
            <AvatarImage
              src={avatar}
              alt={label}
              size={20}
              className="w-5 h-5 rounded-full object-cover shrink-0"
              fallback={(
                <span
                  className="w-full h-full rounded-full flex items-center justify-center"
                  style={{ backgroundColor: bg }}
                >
                  <Users className="h-3 w-3" />
                </span>
              )}
            />
          );
          active = !activeServerUrl && activeGroupId === item.groupId;
          badge = countBadge(group?.unreadCount ?? 0, 'accent');
        }

        return (
          <div
            key={key}
            draggable
            onDragStart={() => setDragKey(key)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(key)}
            onDragEnd={() => setDragKey(null)}
            onClick={() => navigateToPinned(item, onNavigateHomeTab)}
            className={`group/chip shrink-0 rounded-md cursor-pointer transition-colors ${
              rotatedActive
                ? 'flex flex-col items-center gap-1 w-full py-1.5 px-0.5'
                : `flex items-center gap-1.5 h-8 pl-1.5 pr-1 ${isRow ? 'w-full' : 'max-w-[200px]'}`
            } ${
              active
                ? 'bg-bg-hover text-text-primary'
                : 'bg-bg-elevated/60 text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary'
            }`}
            title={label}
          >
            {icon}
            {item.type === 'channel' && (
              <span className="text-text-muted shrink-0">{channelTypeIcon(item.channelType)}</span>
            )}
            <span
              className={
                rotatedActive
                  ? 'text-xs font-medium [writing-mode:vertical-rl] max-h-[120px] overflow-hidden'
                  : 'truncate text-xs font-medium flex-1'
              }
            >
              {label}
            </span>
            {badge}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                requestTogglePin(item, e.shiftKey);
              }}
              className="shrink-0 opacity-0 group-hover/chip:opacity-100 text-text-muted hover:text-danger transition-opacity"
              title="Unpin (Shift to skip confirmation)"
              aria-label={`Unpin ${label}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
    {repositioning && createPortal(
      <div className="fixed inset-0 z-[9997] pointer-events-none">
        {(['top', 'bottom', 'left', 'right'] as DockSide[]).map((side) => {
          const isTarget = hoverSide === side;
          const vertical = side === 'left' || side === 'right';
          const pos = {
            top: 'top-0 left-0 right-0',
            bottom: 'bottom-0 left-0 right-0',
            left: 'top-0 bottom-0 left-0',
            right: 'top-0 bottom-0 right-0',
          }[side];
          const size = isTarget
            ? (vertical ? 'w-44' : 'h-11')
            : (vertical ? 'w-1.5' : 'h-1.5');
          return (
            <div
              key={side}
              className={`absolute bg-accent transition-all duration-150 ease-out ${pos} ${size} ${isTarget ? 'opacity-30' : 'opacity-15'}`}
            />
          );
        })}
      </div>,
      document.body
    )}
    {menu && createPortal(
      <>
        <div
          className="fixed inset-0 z-[9998]"
          onClick={() => setMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}
        />
        <div
          ref={menuRef}
          className="fixed z-[9999] bg-bg-elevated border border-border rounded shadow-lg text-sm py-1 w-56 max-w-[calc(100vw-2rem)]"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
            onClick={() => { toggleLocked(); setMenu(null); }}
          >
            <Check className={`h-3.5 w-3.5 shrink-0 ${locked ? 'opacity-100' : 'opacity-0'}`} />
            Lock Bar In Position
          </button>
          <button
            className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50"
            onClick={() => { setLocationModalOpen(true); setMenu(null); }}
          >
            <span className="w-3.5 shrink-0" />
            Set Location…
          </button>
          <button
            disabled={!isRow}
            className={`w-full flex items-center gap-2 text-left px-3 py-1.5 ${
              isRow ? 'text-text-secondary hover:bg-bg-hover/50' : 'text-text-muted opacity-50 cursor-not-allowed'
            }`}
            title={isRow ? 'Render pins vertically' : 'Only available when docked left or right'}
            onClick={() => { if (isRow) { toggleRotated(); setMenu(null); } }}
          >
            <Check className={`h-3.5 w-3.5 shrink-0 ${rotated && isRow ? 'opacity-100' : 'opacity-0'}`} />
            Rotate
          </button>
        </div>
      </>,
      document.body
    )}
    {locationModalOpen && createPortal(
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
        onClick={() => setLocationModalOpen(false)}
      >
        <div className="bg-bg-elevated rounded-lg shadow-xl w-full mx-4 max-w-xs" onClick={(e) => e.stopPropagation()}>
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-lg font-semibold text-text-primary">Taskbar Location</h2>
          </div>
          <div className="p-4 grid grid-cols-2 gap-2">
            {([
              { side: 'bottom' as DockSide, label: 'Bottom' },
              { side: 'top' as DockSide, label: 'Top' },
              { side: 'left' as DockSide, label: 'Left' },
              { side: 'right' as DockSide, label: 'Right' },
            ]).map(({ side, label }) => (
              <button
                key={side}
                onClick={() => { setDockSide(side); setLocationModalOpen(false); }}
                className={`px-3 py-2 rounded text-sm font-medium border transition-colors ${
                  dockSide === side
                    ? 'border-accent bg-accent/15 text-text-primary'
                    : 'border-border text-text-secondary hover:bg-bg-hover/50 hover:text-text-primary'
                }`}
              >
                {label}{side === 'bottom' ? ' (default)' : ''}
              </button>
            ))}
          </div>
          <div className="px-5 py-3 bg-bg-secondary rounded-b-lg flex justify-end">
            <button
              onClick={() => setLocationModalOpen(false)}
              className="text-sm text-text-secondary hover:text-text-primary px-3 py-1.5"
            >
              Close
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}
    </>
  );
}
