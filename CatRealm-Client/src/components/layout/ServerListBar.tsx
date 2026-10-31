import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useServerStore, normalizeServerPrefs } from '../../stores/serverStore';
import type { ServerEntry, ServerFolder } from '../../stores/serverStore';
import { resolveServerIcon } from '../../lib/serverIcon';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useDMStore } from '../../stores/dmStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useNotificationStore } from '../../messaging/notifications/notificationStore';
import { isServerOwnerToken } from '../../utils/serverOwnership';
import { writeClipboardText } from '../../lib/clipboard';
import { ServerFolderSettingsModal } from './ServerFolderSettingsModal';
import homeLogo from '/favicon-96x96.png';
import { CallingIndicator } from '../calls/CallingIndicator';
import { IncomingCallModal } from '../calls/IncomingCallModal';
import { CallDeclinedToast } from '../calls/CallDeclinedToast';
import { Check } from 'lucide-react';
import { isHttpGatewayCandidateUrl } from '../../lib/httpRealmGateway';
import { getSocket } from '../../lib/socket';

type HomeTab = 'dms' | 'groupChats' | 'friends' | 'pending' | 'add' | 'discover';

// Extract first letter from server name, skipping emojis and special characters
function getServerInitial(name: string): string {
  const cleaned = name.replace(/[\p{Emoji}\p{Emoji_Component}\s]/gu, '');
  if (cleaned.length > 0) {
    return cleaned.charAt(0).toUpperCase();
  }
  return Array.from(name)[0] || '?';
}

// Animated folder icon: shows a folder SVG when open, or an animated 2×2 server grid when closed.
// When > 4 servers exist, the grid slots cycle through all servers every 5 seconds.
interface FolderGridIconProps {
  serverUrls: string[];
  servers: ServerEntry[];
  color: string;
  isOpen: boolean;
}

function FolderGridIcon({ serverUrls, servers, color, isOpen }: FolderGridIconProps) {
  const serverMap = useMemo(() => new Map(servers.map((s) => [s.url, s])), [servers]);

  const [slots, setSlots] = useState<string[]>(() => serverUrls.slice(0, 4));
  const [fadingSlot, setFadingSlot] = useState<number | null>(null);

  const slotsRef = useRef<string[]>(slots);
  const serverUrlsRef = useRef<string[]>(serverUrls);
  useEffect(() => { slotsRef.current = slots; }, [slots]);
  useEffect(() => { serverUrlsRef.current = serverUrls; }, [serverUrls]);

  // Sync slots when the folder membership changes
  useEffect(() => {
    setSlots((prev) => {
      const valid = prev.filter((url) => serverUrls.includes(url));
      const toAdd = serverUrls.filter((url) => !valid.includes(url));
      return [...valid, ...toAdd].slice(0, 4);
    });
  }, [serverUrls]);

  // Cycle icons when > 4 servers and folder is closed
  useEffect(() => {
    if (serverUrls.length <= 4 || isOpen) return;
    const id = setInterval(() => {
      const current = slotsRef.current;
      const currentSet = new Set(current);
      const candidates = serverUrlsRef.current.filter((url) => !currentSet.has(url));
      if (candidates.length === 0) return;
      const incoming = candidates[Math.floor(Math.random() * candidates.length)];
      const slotIdx = Math.floor(Math.random() * 4);
      setFadingSlot(slotIdx);
      setTimeout(() => {
        setSlots((prev) => {
          const next = [...prev];
          next[slotIdx] = incoming;
          return next;
        });
        setFadingSlot(null);
      }, 300);
    }, 5000);
    return () => clearInterval(id);
  }, [serverUrls.length, isOpen]);

  if (isOpen) {
    return (
      <svg
        width="28" height="28" viewBox="0 0 24 24" fill="none"
        strokeLinecap="round" strokeLinejoin="round"
      >
        <path
          d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
          fill={`${color}55`}
          stroke={color}
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  return (
    <div className="w-9 h-9 grid grid-cols-2 gap-0.5 p-0.5">
      {slots.slice(0, 4).map((url, idx) => {
        const server = serverMap.get(url);
        if (!server) return <div key={`empty-${idx}`} className="w-4 h-4 rounded-sm bg-bg-sidebar/50" />;
        const icon = resolveServerIcon(server);
        const isFading = fadingSlot === idx;
        return (
          <div
            key={url}
            className="w-4 h-4 rounded-sm overflow-hidden bg-bg-sidebar flex items-center justify-center text-[8px] font-bold text-text-secondary"
            style={{ opacity: isFading ? 0 : 1, transition: 'opacity 0.3s ease' }}
          >
            {icon
              ? <img src={icon} alt={server.name} className="w-full h-full object-cover" />
              : getServerInitial(server.name)
            }
          </div>
        );
      })}
      {Array.from({ length: Math.max(0, 4 - slots.length) }).map((_, i) => (
        <div key={`empty-${i}`} className="w-4 h-4 rounded-sm bg-bg-sidebar/50" />
      ))}
    </div>
  );
}

type ServerListBarProps = {
  onNavigateToHomeTab?: (tab: HomeTab) => void;
};

type DragState = { type: 'server'; id: string; fromFolderId?: string } | { type: 'folder'; id: string };

export function ServerListBar({ onNavigateToHomeTab }: ServerListBarProps) {
  const servers = useServerStore((s) => s.servers);
  const activeServerUrl = useServerStore((s) => s.activeServerUrl);
  const switchServer = useServerStore((s) => s.switchServer);
  const goHome = useServerStore((s) => s.goHome);
  const openModal = useUIStore((s) => s.openModal);
  const serverListOpen = useUIStore((s) => s.serverListOpen);
  const serverStatus = useServerStore((s) => s.serverStatus);
  const setServerPrefs = useServerStore((s) => s.setServerPrefs);
  const getServerPrefs = useServerStore((s) => s.getServerPrefs);
  const markServerAsRead = useServerStore((s) => s.markServerAsRead);
  const user = useAuthStore((s) => s.user);
  const isCentral = user?.accountType === 'central';
  const debugServerStates = useSettingsStore((s) => s.debugServerStates);
  const conversations = useDMStore((s) => s.conversations);
  const homeUnread = conversations.reduce((sum, conv) => sum + (conv.unreadCount || 0), 0);

  const serverLayout = useServerStore((s) => s.serverLayout);
  const serverFolders = useServerStore((s) => s.serverFolders);
  const reorderLayout = useServerStore((s) => s.reorderLayout);
  const createFolder = useServerStore((s) => s.createFolder);
  const deleteFolder = useServerStore((s) => s.deleteFolder);
  const updateFolder = useServerStore((s) => s.updateFolder);
  const addServerToFolder = useServerStore((s) => s.addServerToFolder);
  const removeServerFromFolder = useServerStore((s) => s.removeServerFromFolder);
  const toggleFolder = useServerStore((s) => s.toggleFolder);
  const collapseAllFolders = useServerStore((s) => s.collapseAllFolders);
  const markFolderAsRead = useServerStore((s) => s.markFolderAsRead);

  // Snapshots for unread counts
  const snapshots = useServerStore((s) => s.snapshots);
  const notificationSummary = useNotificationStore((s) => s.summary);

  // Offline / visible split
  const offlineServers = servers.filter((s) => {
    const status = serverStatus[s.url] ?? 'idle';
    return status === 'disconnected' && !getSocket(s.url)?.connected;
  });
  const offlineUrlSet = new Set(offlineServers.map((s) => s.url));
  const hasHttpBlockedServers = offlineServers.some((server) => isHttpGatewayCandidateUrl(server.url)
    && (server.url.startsWith('http://') || serverStatus[server.url] === 'disconnected'));

  // Drag state
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null); // insert-before index in serverLayout
  const [folderDropIndicator, setFolderDropIndicator] = useState<{ folderId: string; serverUrl: string; position: 'before' | 'after' } | null>(null);
  const [hoverMergeTarget, setHoverMergeTarget] = useState<string | null>(null); // 'server:<url>' | 'folder:<id>'

  // Menu state
  const [serverMenu, setServerMenu] = useState<{ server: ServerEntry; x: number; y: number } | null>(null);
  const [serverMenuNotificationsOpen, setServerMenuNotificationsOpen] = useState(false);
  const [folderMenu, setFolderMenu] = useState<{ folder: ServerFolder; x: number; y: number } | null>(null);
  const [emptyAreaMenu, setEmptyAreaMenu] = useState<{ x: number; y: number } | null>(null);
  const [folderSettingsTarget, setFolderSettingsTarget] = useState<ServerFolder | null>(null);

  // Mobile long-press
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressPointRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNextServerClickRef = useRef(false);

  // Close menus on outside click / Escape
  useEffect(() => {
    if (!serverMenu) return;
    setServerMenuNotificationsOpen(false);
    const handleClick = () => setServerMenu(null);
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setServerMenu(null); };
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [serverMenu]);

  useEffect(() => {
    if (!folderMenu && !emptyAreaMenu) return;
    const handleClick = () => { setFolderMenu(null); setEmptyAreaMenu(null); };
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setFolderMenu(null); setEmptyAreaMenu(null); } };
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [folderMenu, emptyAreaMenu]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    };
  }, []);

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
    longPressPointRef.current = null;
  };

  const handleServerTouchStart = (server: ServerEntry, e: React.TouchEvent<HTMLButtonElement>) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const point = { x: touch.clientX, y: touch.clientY };
    longPressStartRef.current = point;
    longPressPointRef.current = point;
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => {
      const menuPoint = longPressPointRef.current ?? point;
      suppressNextServerClickRef.current = true;
      setServerMenu({ server, x: menuPoint.x, y: menuPoint.y });
      clearLongPress();
    }, 500);
  };

  const handleServerTouchMove = (e: React.TouchEvent<HTMLButtonElement>) => {
    if (!longPressStartRef.current || e.touches.length !== 1) return;
    const touch = e.touches[0];
    longPressPointRef.current = { x: touch.clientX, y: touch.clientY };
    const dx = touch.clientX - longPressStartRef.current.x;
    const dy = touch.clientY - longPressStartRef.current.y;
    if (dx * dx + dy * dy > 12 * 12) clearLongPress();
  };

  function clearDragState() {
    setDrag(null);
    setDropTarget(null);
    setFolderDropIndicator(null);
    setHoverMergeTarget(null);
  }

  function handleFolderReorder(folderId: string, draggedUrl: string, targetUrl: string, position: 'before' | 'after') {
    const folder = serverFolders.find((f) => f.id === folderId);
    if (!folder) return;
    const newUrls = [...folder.serverUrls];
    const fromIdx = newUrls.indexOf(draggedUrl);
    if (fromIdx === -1) return;
    newUrls.splice(fromIdx, 1);
    let toIdx = newUrls.indexOf(targetUrl);
    if (toIdx === -1) return;
    if (position === 'after') toIdx += 1;
    newUrls.splice(toIdx, 0, draggedUrl);
    updateFolder(folderId, { serverUrls: newUrls });
  }

  function handleDropAtIndex(insertBefore: number) {
    if (!drag) return;

    if (drag.type === 'server' && drag.fromFolderId) {
      // Dragging server out of a folder — place at the drop position
      const { serverLayout: currentLayout, serverFolders: currentFolders } = useServerStore.getState();
      const folder = currentFolders.find((f) => f.id === drag.fromFolderId);
      if (!folder) { clearDragState(); return; }

      const newServerUrls = folder.serverUrls.filter((u) => u !== drag.id);
      let newLayout = [...currentLayout];
      let newFolders = [...currentFolders];

      if (newServerUrls.length === 0) {
        // Folder becomes empty — remove it from layout too
        const folderLayoutIdx = newLayout.findIndex(
          (item) => item.type === 'folder' && item.folderId === drag.fromFolderId
        );
        newLayout = newLayout.filter(
          (item) => !(item.type === 'folder' && item.folderId === drag.fromFolderId)
        );
        newFolders = newFolders.filter((f) => f.id !== drag.fromFolderId);
        // Adjust insert index for the removed folder item
        const adjustedInsert = folderLayoutIdx !== -1 && folderLayoutIdx < insertBefore
          ? insertBefore - 1
          : insertBefore;
        newLayout.splice(Math.min(adjustedInsert, newLayout.length), 0, { type: 'server', url: drag.id });
      } else {
        newFolders = newFolders.map((f) =>
          f.id === drag.fromFolderId ? { ...f, serverUrls: newServerUrls } : f
        );
        newLayout.splice(Math.min(insertBefore, newLayout.length), 0, { type: 'server', url: drag.id });
      }

      useServerStore.setState({ serverLayout: newLayout, serverFolders: newFolders });
      useServerStore.getState().persistServers();
      clearDragState();
      return;
    }

    // Normal top-level reorder
    const draggedItem = serverLayout.find((item) =>
      drag.type === 'server'
        ? item.type === 'server' && item.url === drag.id
        : item.type === 'folder' && item.folderId === drag.id
    );
    if (!draggedItem) { clearDragState(); return; }

    const sourceIdx = serverLayout.indexOf(draggedItem);
    const newLayout = serverLayout.filter((_, i) => i !== sourceIdx);
    const adjustedInsert = sourceIdx < insertBefore ? insertBefore - 1 : insertBefore;
    newLayout.splice(Math.min(adjustedInsert, newLayout.length), 0, draggedItem);
    reorderLayout(newLayout);
    clearDragState();
  }

  function getCounts(url: string) {
    if (url === activeServerUrl) return { unread: 0, mentions: 0, nonMentionUnread: 0 };
    const snap = snapshots[url];
    if (!snap) return { unread: 0, mentions: 0, nonMentionUnread: 0 };
    let unread = 0;
    let mentions = 0;
    for (const [channelId, count] of Object.entries(snap.unreadByChannel)) {
      if (snap.prefsByChannel[channelId]?.muted) continue;
      unread += count ?? 0;
    }
    for (const [channelId, count] of Object.entries(snap.mentionByChannel)) {
      if (snap.prefsByChannel[channelId]?.muted) continue;
      mentions += count ?? 0;
    }
    const canonicalMentions = isCentral ? (notificationSummary?.mentionsByRealm[url] ?? mentions) : mentions;
    return { unread, mentions: canonicalMentions, nonMentionUnread: Math.max(unread - canonicalMentions, 0) };
  }

  function renderDropZone(index: number) {
    const isActive = dropTarget === index && drag !== null;
    return (
      <div
        className={`w-10 mx-auto rounded-full transition-all duration-100 shrink-0 ${
          isActive ? 'h-1 bg-accent my-0.5' : 'h-1 my-0.5 opacity-0'
        }`}
        onDragOver={(e) => {
          if (!drag) return;
          e.preventDefault();
          e.stopPropagation();
          setDropTarget(index);
          setHoverMergeTarget(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          handleDropAtIndex(index);
        }}
      />
    );
  }

  function renderServerItem(server: ServerEntry, _insideFolder = false, folderId?: string) {
    const isActive = activeServerUrl === server.url;
    const prefs = normalizeServerPrefs(server.prefs);
    const counts = getCounts(server.url);
    const showMentions = !isActive && !prefs.muted && counts.mentions > 0;
    const showUnread = !isActive && !prefs.muted && prefs.badgeMode === 'all' && counts.nonMentionUnread > 0;
    const letter = getServerInitial(server.name);
    const resolvedIcon = resolveServerIcon(server);
    const status = serverStatus[server.url] ?? 'idle';
    const isOffline = status === 'disconnected' && !getSocket(server.url)?.connected;
    const isMergeTarget = hoverMergeTarget === `server:${server.url}`;
    const isDragging = drag?.type === 'server' && drag.id === server.url;
    const dropIndicatorPos = folderDropIndicator?.folderId === folderId && folderDropIndicator?.serverUrl === server.url
      ? folderDropIndicator.position
      : null;

    return (
      <div
        key={server.url}
        className="relative group shrink-0"
        style={dropIndicatorPos === 'before'
          ? { borderTop: '2px solid var(--color-accent)', borderRadius: '2px' }
          : dropIndicatorPos === 'after'
            ? { borderBottom: '2px solid var(--color-accent)', borderRadius: '2px' }
            : {}}
      >
        <button
          draggable
          onDragStart={(e) => {
            setDrag({ type: 'server', id: server.url, fromFolderId: folderId } as DragState);
            e.dataTransfer.effectAllowed = 'move';
            e.stopPropagation();
          }}
          onDragOver={(e) => {
            if (!drag || drag.id === server.url) return;
            e.preventDefault();
            e.stopPropagation();
            if (folderId && drag.type === 'server') {
              // Half-detection for folder-internal reordering
              const rect = e.currentTarget.getBoundingClientRect();
              const relY = (e.clientY - rect.top) / rect.height;
              const position = relY < 0.5 ? 'before' : 'after';
              setFolderDropIndicator({ folderId, serverUrl: server.url, position });
              setDropTarget(null);
              setHoverMergeTarget(null);
            } else {
              // Only show merge ring if NEITHER server is in a folder
              const dragFromFolder = drag.type === 'server' && 'fromFolderId' in drag && drag.fromFolderId;
              if (drag.type === 'server' && !dragFromFolder && !folderId) {
                setHoverMergeTarget(`server:${server.url}`);
                setDropTarget(null);
              }
            }
          }}
          onDragLeave={() => {
            if (hoverMergeTarget === `server:${server.url}`) setHoverMergeTarget(null);
            if (folderDropIndicator?.serverUrl === server.url) setFolderDropIndicator(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (drag?.type === 'server' && drag.id !== server.url) {
              if (folderId) {
                const dragFromFolder = 'fromFolderId' in drag ? drag.fromFolderId : undefined;
                if (dragFromFolder === folderId) {
                  // Reorder within same folder using half-detection position
                  const rect = e.currentTarget.getBoundingClientRect();
                  const relY = (e.clientY - rect.top) / rect.height;
                  const position = relY < 0.5 ? 'before' : 'after';
                  handleFolderReorder(folderId, drag.id, server.url, position);
                } else {
                  // Drop from outside into this folder
                  addServerToFolder(drag.id, folderId);
                }
              } else {
                const dragFromFolder = 'fromFolderId' in drag && drag.fromFolderId;
                if (!dragFromFolder) {
                  // Neither server is in a folder — safe to merge into a new folder
                  createFolder([drag.id, server.url]);
                }
              }
              // All other cases: block — use drop zones for positioning instead
            }
            clearDragState();
          }}
          onDragEnd={clearDragState}
          onClick={(e) => {
            if (suppressNextServerClickRef.current) {
              suppressNextServerClickRef.current = false;
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            switchServer(server.url);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setServerMenu({ server, x: e.clientX, y: e.clientY });
          }}
          onTouchStart={(e) => handleServerTouchStart(server, e)}
          onTouchMove={handleServerTouchMove}
          onTouchEnd={clearLongPress}
          onTouchCancel={clearLongPress}
          className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-200 text-sm font-bold ${
            isActive
              ? 'bg-accent rounded-xl text-white'
              : 'bg-bg-sidebar text-text-secondary hover:bg-accent hover:text-white hover:rounded-xl'
          } ${isMergeTarget ? 'ring-2 ring-accent' : ''} ${isDragging ? 'opacity-50' : ''}`}
          title={server.name}
        >
          {resolvedIcon ? (
            <img src={resolvedIcon} alt={server.name} className="w-full h-full rounded-inherit object-cover" />
          ) : (
            letter
          )}
        </button>

        {isOffline && (
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-danger text-white text-[10px] rounded-full flex items-center justify-center shadow">
            !
          </div>
        )}
        {debugServerStates && (
          <div
            className="absolute -bottom-1 -right-1 min-w-[28px] h-4 px-1 bg-black/85 text-white text-[9px] rounded flex items-center justify-center shadow pointer-events-none"
            title={`debug: ${status}`}
          >
            {status}
          </div>
        )}

        {/* Active indicator pill */}
        {isActive && (
          <div className="absolute left-[-6px] top-1/2 -translate-y-1/2 w-1 h-10 bg-text-primary rounded-r-full" />
        )}

        {/* Notification badges */}
        {!isActive && !prefs.muted && (showMentions || showUnread) && (
          <div className="absolute -top-1 -right-1 flex flex-col items-end gap-1">
            {showMentions && (
              <div className="min-w-[16px] h-4 px-1 bg-danger text-white text-[10px] rounded-full flex items-center justify-center shadow">
                {counts.mentions > 99 ? '99+' : counts.mentions}
              </div>
            )}
            {showUnread && (
              <div className="min-w-[16px] h-4 px-1 bg-white text-black text-[10px] rounded-full flex items-center justify-center shadow">
                {counts.nonMentionUnread > 99 ? '99+' : counts.nonMentionUnread}
              </div>
            )}
          </div>
        )}

        {/* Tooltip */}
        <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-bg-elevated text-text-primary text-sm font-medium rounded-md shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
          {isOffline ? 'This server is offline or having issues connecting to it...' : server.name}
        </div>
      </div>
    );
  }

  function renderFolderItem(folder: ServerFolder) {
    const containedServers = folder.serverUrls
      .map((url) => servers.find((s) => s.url === url))
      .filter(Boolean) as ServerEntry[];
    const isActive = folder.serverUrls.some((url) => url === activeServerUrl);
    const isHoverTarget = hoverMergeTarget === `folder:${folder.id}`;
    const isDragging = drag?.type === 'folder' && drag.id === folder.id;

    // Aggregate unread counts across folder servers
    let folderMentions = 0;
    let folderNonMentionUnread = 0;
    if (!isActive) {
      for (const url of folder.serverUrls) {
        const prefs = normalizeServerPrefs(servers.find((s) => s.url === url)?.prefs);
        if (prefs.muted) continue;
        const counts = getCounts(url);
        folderMentions += counts.mentions;
        if (prefs.badgeMode === 'all') folderNonMentionUnread += counts.nonMentionUnread;
      }
    }

    const pillOpen = folder.isOpen && containedServers.length > 0;

    return (
      <div key={folder.id} className="w-[72px] flex flex-col items-center shrink-0">
        {/* Pill wraps folder icon + servers when expanded */}
        <div
          className="flex flex-col items-center rounded-[28px] transition-all duration-200"
          style={pillOpen ? {
            gap: '8px',
            paddingTop: '12px',
            paddingBottom: '12px',
            width: '56px',
            backgroundColor: `${folder.color}28`,
            boxShadow: `0 0 0 1.5px ${folder.color}55, 0 4px 16px ${folder.color}33`,
          } : {}}
        >

        <div className="relative group shrink-0" data-folder>
          <div
            draggable
            onDragStart={(e) => {
              setDrag({ type: 'folder', id: folder.id });
              e.dataTransfer.effectAllowed = 'move';
              e.stopPropagation();
            }}
            onDragOver={(e) => {
              if (!drag) return;
              if (drag.type === 'folder' && drag.id === folder.id) return;
              e.preventDefault();
              e.stopPropagation();
              if (drag.type === 'server') {
                setHoverMergeTarget(`folder:${folder.id}`);
                setDropTarget(null);
              }
            }}
            onDragLeave={() => {
              if (hoverMergeTarget === `folder:${folder.id}`) setHoverMergeTarget(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (drag?.type === 'server') {
                if ('fromFolderId' in drag && drag.fromFolderId && drag.fromFolderId !== folder.id) {
                  // Move from one folder to another
                  removeServerFromFolder(drag.id, drag.fromFolderId);
                }
                addServerToFolder(drag.id, folder.id);
              }
              clearDragState();
            }}
            onDragEnd={clearDragState}
            onClick={() => toggleFolder(folder.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setFolderMenu({ folder, x: e.clientX, y: e.clientY });
            }}
            className={`w-12 h-12 rounded-2xl flex items-center justify-center cursor-pointer transition-all duration-200 ${
              isActive ? 'rounded-xl' : 'hover:rounded-xl'
            } ${isHoverTarget ? 'ring-2 ring-accent' : ''} ${isDragging ? 'opacity-50' : ''}`}
            style={{
              backgroundColor: `${folder.color}33`,
              boxShadow: `0 4px 16px 0 ${folder.color}55`,
            }}
          >
            <FolderGridIcon
              serverUrls={folder.serverUrls}
              servers={servers}
              color={folder.color}
              isOpen={folder.isOpen}
            />
          </div>

          {/* Active indicator pill — colored with folder color */}
          {isActive && (
            <div
              className="absolute left-[-6px] top-1/2 -translate-y-1/2 w-1 h-10 rounded-r-full"
              style={{ backgroundColor: folder.color }}
            />
          )}

          {/* Folder unread badges */}
          {!isActive && (folderMentions > 0 || folderNonMentionUnread > 0) && (
            <div className="absolute -top-1 -right-1 flex flex-col items-end gap-1">
              {folderMentions > 0 && (
                <div className="min-w-[16px] h-4 px-1 bg-danger text-white text-[10px] rounded-full flex items-center justify-center shadow">
                  {folderMentions > 99 ? '99+' : folderMentions}
                </div>
              )}
              {folderNonMentionUnread > 0 && folderMentions === 0 && (
                <div className="min-w-[16px] h-4 px-1 bg-white text-black text-[10px] rounded-full flex items-center justify-center shadow">
                  {folderNonMentionUnread > 99 ? '99+' : folderNonMentionUnread}
                </div>
              )}
            </div>
          )}

          {/* Tooltip */}
          <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-bg-elevated text-text-primary text-sm font-medium rounded-md shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
            {folder.name}
          </div>
        </div>

        {/* Expanded servers inside the same pill */}
        {pillOpen && containedServers.map((server) => (
          <Fragment key={server.url}>
            {renderServerItem(server, true, folder.id)}
          </Fragment>
        ))}

        </div>{/* end pill */}
      </div>
    );
  }

  // Build filtered layout: skip servers that are offline (they appear in the modal button)
  // Also skip layout items whose server/folder no longer exists
  const folderIds = new Set(serverFolders.map((f) => f.id));
  const serverUrlSet = new Set(servers.map((s) => s.url));
  const filteredLayout = serverLayout.filter((item) => {
    if (item.type === 'server') return serverUrlSet.has(item.url) && !offlineUrlSet.has(item.url);
    if (item.type === 'folder') return folderIds.has(item.folderId);
    return false;
  });

  return (
    <div
      className={`w-[72px] bg-bg-deepest flex flex-col items-center py-3 gap-2 shrink-0 overflow-y-auto overflow-x-hidden no-scrollbar transition-all duration-300 ease-out ${serverListOpen ? 'translate-x-0 md:translate-x-0' : '-translate-x-full md:translate-x-0'} fixed md:relative left-0 inset-y-0 z-30 md:z-auto`}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('button, [data-folder]')) return;
        e.preventDefault();
        setEmptyAreaMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* Home button */}
      <div className="relative shrink-0">
        <button
          data-tour="home"
          onClick={goHome}
          className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-200 ${
            activeServerUrl === null
              ? 'bg-accent rounded-xl text-white'
              : 'bg-bg-sidebar text-text-secondary hover:bg-accent hover:text-white hover:rounded-xl'
          }`}
          title="Home"
        >
          <img src={homeLogo} alt="CatRealm" className="w-8 h-8 object-contain" />
        </button>
        {homeUnread > 0 && (
          <div className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-danger text-white text-[10px] rounded-full flex items-center justify-center shadow border border-bg-deepest">
            {homeUnread > 99 ? '99+' : homeUnread}
          </div>
        )}
      </div>

      {/* Incoming Call Indicator */}
      <IncomingCallModal onNavigateToTab={onNavigateToHomeTab} />
      <CallDeclinedToast />

      {/* Calling Indicator */}
      <CallingIndicator />

      {/* Divider */}
      <div className="w-8 h-0.5 bg-border rounded-full shrink-0" />

      {/* Server / folder layout with drop zones */}
      {renderDropZone(0)}
      {filteredLayout.map((item, idx) => (
        <Fragment key={item.type === 'server' ? item.url : item.folderId}>
          {item.type === 'server'
            ? (() => {
                const server = servers.find((s) => s.url === item.url);
                return server ? renderServerItem(server) : null;
              })()
            : (() => {
                const folder = serverFolders.find((f) => f.id === item.folderId);
                return folder ? renderFolderItem(folder) : null;
              })()
          }
          {renderDropZone(idx + 1)}
        </Fragment>
      ))}

      {/* Add server button */}
      <button
        data-tour="add-server"
        onClick={() => openModal('addServer')}
        className="w-12 h-12 rounded-2xl bg-bg-sidebar text-success hover:bg-success hover:text-white flex items-center justify-center transition-all duration-200 hover:rounded-xl shrink-0"
        title="Add a Server"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {/* Servers that need attention */}
      {offlineServers.length > 0 && (
        <button
          onClick={() => openModal('offlineServers')}
          className={`w-12 h-12 rounded-2xl bg-bg-sidebar hover:text-white flex items-center justify-center transition-all duration-200 hover:rounded-xl shrink-0 relative ${hasHttpBlockedServers ? 'text-warning hover:bg-warning' : 'text-danger hover:bg-danger'}`}
          title="View servers needing attention"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <div className={`absolute -top-1 -right-1 min-w-[16px] h-4 px-1 text-white text-[10px] rounded-full flex items-center justify-center shadow border border-bg-deepest ${hasHttpBlockedServers ? 'bg-warning' : 'bg-danger'}`}>
            {offlineServers.length}
          </div>
        </button>
      )}

      {/* Mobile overlay */}
      {serverListOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => useUIStore.setState({ serverListOpen: false })}
        />
      )}

      {/* Portals */}
      {renderServerMenu()}
      {renderFolderMenu()}
      {renderEmptyAreaMenu()}

      {/* Folder settings modal — portaled to body so it isn't clipped by the 72px sidebar */}
      {folderSettingsTarget && typeof document !== 'undefined' && createPortal(
        <ServerFolderSettingsModal
          folder={folderSettingsTarget}
          onApply={(name, color) => updateFolder(folderSettingsTarget.id, { name, color })}
          onDelete={() => deleteFolder(folderSettingsTarget.id)}
          onClose={() => setFolderSettingsTarget(null)}
        />,
        document.body
      )}
    </div>
  );

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function copyServerHost(serverUrl: string) {
    try {
      const url = new URL(serverUrl);
      await writeClipboardText(url.host);
    } catch {
      await writeClipboardText(serverUrl);
    }
  }

  function openProfileSettingsForServer(serverUrl: string) {
    if (activeServerUrl !== serverUrl) switchServer(serverUrl);
    setTimeout(() => openModal('profileSettings'), 0);
  }

  function renderServerMenu() {
    if (!serverMenu) return null;
    if (typeof document === 'undefined') return null;
    const { server, x, y } = serverMenu;
    const prefs = getServerPrefs(server.url);
    const owner = isServerOwnerToken(server.token);
    const disableInvite = !isCentral;
    const leaveDisabled = owner;
    const itemClass = 'w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50';
    const disabledClass = 'opacity-50 cursor-not-allowed';

    return createPortal(
      <div
        className="fixed z-[9999] bg-bg-elevated border border-border rounded shadow-lg text-sm py-1 w-56 max-w-[calc(100vw-2rem)]"
        style={{ left: x, top: y }}
      >
        <button
          className={itemClass}
          onClick={() => { void markServerAsRead(server.url); setServerMenu(null); }}
        >
          Mark As Read
        </button>

        <div className="border-t border-border my-1" />

        <button
          className={`${itemClass} ${disableInvite ? disabledClass : ''}`}
          onClick={() => {
            if (disableInvite) return;
            openModal('friends');
            setServerMenu(null);
          }}
        >
          Invite Friend
        </button>

        {/* Move to Folder */}
        {serverFolders.length > 0 && (
          <>
            <div className="border-t border-border my-1" />
            <div className="px-3 py-1 text-xs text-text-muted uppercase tracking-wider">Move to Folder</div>
            {serverFolders.map((folder) => (
              <button
                key={folder.id}
                className={itemClass}
                onClick={() => {
                  addServerToFolder(server.url, folder.id);
                  setServerMenu(null);
                }}
              >
                <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: folder.color }} />
                {folder.name}
              </button>
            ))}
          </>
        )}

        <div className="border-t border-border my-1" />

        <button
          className={itemClass}
          onClick={() => { setServerPrefs(server.url, { muted: !prefs.muted }); setServerMenu(null); }}
        >
          {prefs.muted ? 'Unmute Server' : 'Mute Server'}
        </button>

        <div className="relative">
          <button
            className={itemClass}
            onClick={(event) => {
              event.stopPropagation();
              setServerMenuNotificationsOpen((current) => !current);
            }}
            onMouseEnter={() => { if (!serverMenuNotificationsOpen) setServerMenuNotificationsOpen(true); }}
          >
            Notifications &gt;
          </button>
          <div
            className={`absolute left-full top-0 ml-1 w-60 max-w-[calc(100vw-2rem)] bg-bg-elevated border border-border rounded shadow-lg text-sm py-1 transition-opacity ${
              serverMenuNotificationsOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
            onMouseEnter={() => setServerMenuNotificationsOpen(true)}
          >
            <button className={itemClass} onClick={() => { setServerPrefs(server.url, { badgeMode: 'mentions-only' }); setServerMenuNotificationsOpen(false); setServerMenu(null); }}>
              {prefs.badgeMode === 'mentions-only' && <Check className="mr-1 inline h-3.5 w-3.5" />}Red Numbers Only
            </button>
            <button className={itemClass} onClick={() => { setServerPrefs(server.url, { badgeMode: 'all' }); setServerMenuNotificationsOpen(false); setServerMenu(null); }}>
              {prefs.badgeMode === 'all' && <Check className="mr-1 inline h-3.5 w-3.5" />}White &amp; Red Numbers
            </button>
            <div className="border-t border-border my-1" />
            <button className={itemClass} onClick={() => { setServerPrefs(server.url, { mentionScope: 'everyone' }); setServerMenuNotificationsOpen(false); setServerMenu(null); }}>
              {prefs.mentionScope === 'everyone' && <Check className="mr-1 inline h-3.5 w-3.5" />}Count @everyone
            </button>
            <button className={itemClass} onClick={() => { setServerPrefs(server.url, { mentionScope: 'user' }); setServerMenuNotificationsOpen(false); setServerMenu(null); }}>
              {prefs.mentionScope === 'user' && <Check className="mr-1 inline h-3.5 w-3.5" />}Only @user/@uuid
            </button>
          </div>
        </div>

        <button
          className={itemClass}
          onClick={() => { openProfileSettingsForServer(server.url); setServerMenu(null); }}
        >
          Edit Server Profile
        </button>

        <div className="border-t border-border my-1" />

        <button
          className={`${itemClass} ${leaveDisabled ? disabledClass : 'text-danger'}`}
          onClick={() => {
            if (leaveDisabled) return;
            openModal('leaveServer', server);
            setServerMenu(null);
          }}
        >
          Leave Server
        </button>

        <div className="border-t border-border my-1" />

        <button
          className={itemClass}
          onClick={() => { copyServerHost(server.url); setServerMenu(null); }}
        >
          Copy Server IP + Port
        </button>
      </div>,
      document.body
    );
  }

  function renderFolderMenu() {
    if (!folderMenu) return null;
    if (typeof document === 'undefined') return null;
    const { folder, x, y } = folderMenu;
    const itemClass = 'w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50';

    return createPortal(
      <div
        className="fixed z-[9999] bg-bg-elevated border border-border rounded shadow-lg text-sm py-1 w-52 max-w-[calc(100vw-2rem)]"
        style={{ left: x, top: y }}
      >
        <button
          className={itemClass}
          onClick={() => { void markFolderAsRead(folder.id); setFolderMenu(null); }}
        >
          Mark Folder as Read
        </button>

        <div className="border-t border-border my-1" />

        <button
          className={itemClass}
          onClick={() => { setFolderSettingsTarget(folder); setFolderMenu(null); }}
        >
          Folder Settings
        </button>

        <button
          className={itemClass}
          onClick={() => { collapseAllFolders(); setFolderMenu(null); }}
        >
          Close All Folders
        </button>
      </div>,
      document.body
    );
  }

  function renderEmptyAreaMenu() {
    if (!emptyAreaMenu) return null;
    if (typeof document === 'undefined') return null;
    const { x, y } = emptyAreaMenu;
    const itemClass = 'w-full text-left px-3 py-1.5 text-text-secondary hover:bg-bg-hover/50';

    return createPortal(
      <div
        className="fixed z-[9999] bg-bg-elevated border border-border rounded shadow-lg text-sm py-1 w-44 max-w-[calc(100vw-2rem)]"
        style={{ left: x, top: y }}
      >
        <button
          className={itemClass}
          onClick={() => {
            const newFolderId = createFolder([]);
            const newFolder = useServerStore.getState().serverFolders.find((f) => f.id === newFolderId);
            if (newFolder) setFolderSettingsTarget(newFolder);
            setEmptyAreaMenu(null);
          }}
        >
          New Folder
        </button>
      </div>,
      document.body
    );
  }
}
