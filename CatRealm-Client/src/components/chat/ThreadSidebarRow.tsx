import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Settings2, SquareArrowOutUpRight, Trash2 } from 'lucide-react';
import { useThreadStore } from '../../stores/threadStore';
import { useViewedPermissions } from '../../hooks/useViewedPermissions';
import { PERMISSIONS, hasChannelPermission } from '../../utils/permissions';
import { useSelfUserId } from '../workitems/workItemUtils';
import { ContextMenu, type ContextMenuEntry } from '../workitems/ContextMenu';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ThreadSettingsModal } from './ThreadSettingsModal';
import type { Channel, Thread } from '../../types';

const NAME_MAX = 100;

/**
 * One thread under its channel in the sidebar. Right-click gives the thread's creator
 * and staff (Manage Posts) rename and delete.
 */
export function ThreadSidebarRow({ thread, channel, active, onOpen }: {
  thread: Thread;
  channel: Channel;
  active: boolean;
  onOpen: () => void;
}) {
  const renameThread = useThreadStore((s) => s.renameThread);
  const deleteThread = useThreadStore((s) => s.deleteThread);
  const viewed = useViewedPermissions();
  const selfId = useSelfUserId();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(thread.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const isStaff = hasChannelPermission(viewed.permissions, channel.effective_permissions, PERMISSIONS.MANAGE_POSTS);
  const canManage = isStaff || (!!selfId && thread.created_by === selfId);

  const entries: ContextMenuEntry[] = [
    { label: 'Open thread', icon: <SquareArrowOutUpRight className="h-4 w-4" />, onSelect: onOpen },
    ...(canManage ? [
      { label: 'Rename thread', icon: <Pencil className="h-4 w-4" />, onSelect: () => { setName(thread.name); setRenaming(true); } },
      ...(isStaff ? [{ label: 'Thread settings…', icon: <Settings2 className="h-4 w-4" />, onSelect: () => setShowSettings(true) }] : []),
      { type: 'separator' as const },
      { label: 'Delete thread', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => setConfirmingDelete(true) },
    ] : []),
  ];

  const saveName = () => {
    const next = name.trim();
    setRenaming(false);
    if (next.length < 2 || next === thread.name) return;
    void renameThread(thread.id, next).catch(() => {});
  };

  return (
    <>
      {renaming ? (
        <div className="px-6 py-0.5">
          <input
            autoFocus
            value={name}
            maxLength={NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') { setName(thread.name); setRenaming(false); }
            }}
            className="w-full rounded border border-border bg-bg-input px-1.5 py-0.5 text-xs text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenu({ x: event.clientX, y: event.clientY });
          }}
          className={`flex w-full items-center gap-1.5 px-6 py-1 text-left text-xs transition-colors hover:bg-bg-hover/40 hover:text-text-primary ${active ? 'bg-bg-hover/60 text-text-primary' : 'text-text-muted'}`}
          title={thread.name}
        >
          <span aria-hidden>🧶</span>
          <span className="truncate">{thread.name}</span>
        </button>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={entries} onClose={closeMenu} />}
      {createPortal(
        <ConfirmDialog
          open={confirmingDelete}
          onClose={() => setConfirmingDelete(false)}
          onConfirm={() => { void deleteThread(thread.id).catch(() => {}); }}
          title="Delete thread"
          message={`Delete the thread "${thread.name}" and its messages? This cannot be undone.`}
          confirmText="Delete"
        />,
        document.body,
      )}
      {showSettings && createPortal(<ThreadSettingsModal thread={thread} onClose={() => setShowSettings(false)} />, document.body)}
    </>
  );
}
