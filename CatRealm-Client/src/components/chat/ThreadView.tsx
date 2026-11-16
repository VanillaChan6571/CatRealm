import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Edit3, Settings2, Trash2 } from 'lucide-react';
import { ServerMentionProvider } from './mentions';
import { useThreadStore } from '../../stores/threadStore';
import { useMessageStore } from '../../stores/messageStore';
import { useViewedPermissions } from '../../hooks/useViewedPermissions';
import { PERMISSIONS, hasChannelPermission } from '../../utils/permissions';
import { useSelfUserId } from '../workitems/workItemUtils';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { MessageItem } from './MessageItem';
import { shouldShowMessageHeader } from './messageGrouping';
import { MessageInput } from './MessageInput';
import { slideIn } from './threadSwap';
import { ThreadSettingsModal } from './ThreadSettingsModal';
import type { Channel, Message, Thread } from '../../types';

const EMPTY_MESSAGES: Message[] = [];
const NAME_MAX = 100;

/**
 * A thread shown in place of its channel's chat: "# channel › 🧶 thread" at the top,
 * the thread's messages, and a composer that posts into the thread.
 */
export function ThreadView({ thread, channel }: { thread: Thread; channel: Channel }) {
  const setActiveThread = useThreadStore((s) => s.setActiveThread);
  const renameThread = useThreadStore((s) => s.renameThread);
  const deleteThread = useThreadStore((s) => s.deleteThread);
  const messages = useMessageStore((s) => s.messagesByThread[thread.id]) ?? EMPTY_MESSAGES;
  const parent = useMessageStore((s) => s.messagesByChannel[thread.channel_id]?.find((m) => m.id === thread.parent_message_id));
  const fetchThreadMessages = useMessageStore((s) => s.fetchThreadMessages);
  const viewed = useViewedPermissions();
  const selfId = useSelfUserId();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(thread.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isStaff = hasChannelPermission(viewed.permissions, channel.effective_permissions, PERMISSIONS.MANAGE_POSTS);
  const canManage = isStaff || (!!selfId && thread.created_by === selfId);
  const back = () => setActiveThread(null);

  useEffect(() => { slideIn(rootRef.current, 'right'); }, []);
  useEffect(() => { void fetchThreadMessages(thread.id); }, [thread.id, fetchThreadMessages]);
  // Stay at the newest message as replies arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const saveName = async () => {
    const next = name.trim();
    setEditing(false);
    if (next.length < 2 || next === thread.name) { setName(thread.name); return; }
    try {
      await renameThread(thread.id, next);
      setError('');
    } catch {
      setName(thread.name);
      setError('Failed to rename thread');
    }
  };

  return (
    <ServerMentionProvider>
      <div ref={rootRef} className="absolute inset-0 z-20 flex flex-col bg-bg-chat">
        <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-3 shadow-sm">
          <button
            type="button"
            onClick={back}
            className="flex min-w-0 shrink items-center gap-1.5 rounded px-1.5 py-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
            title={`Back to #${channel.name}`}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span className="text-lg font-bold leading-none">#</span>
            <span className="truncate font-semibold">{channel.name}</span>
          </button>
          <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
          <span className="shrink-0" aria-hidden>🧶</span>
          {editing ? (
            <input
              autoFocus
              value={name}
              maxLength={NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => void saveName()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') { setName(thread.name); setEditing(false); }
              }}
              className="min-w-0 flex-1 rounded border border-border bg-bg-input px-2 py-1 text-sm text-text-primary focus:border-accent focus:outline-none"
            />
          ) : (
            <h3 className="min-w-0 flex-1 truncate font-semibold text-text-primary">{thread.name}</h3>
          )}
          {isStaff && !editing && (
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="rounded p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
              title="Thread settings"
            >
              <Settings2 className="h-4 w-4" />
            </button>
          )}
          {canManage && !editing && (
            <>
              <button
                type="button"
                onClick={() => { setName(thread.name); setEditing(true); }}
                className="rounded p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
                title="Rename thread"
              >
                <Edit3 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="rounded p-1.5 text-text-muted transition-colors hover:bg-danger/15 hover:text-danger"
                title="Delete thread"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {parent && (
            <div className="mx-4 mt-3 rounded-md border border-border bg-bg-elevated/50 px-3 py-2 text-xs text-text-muted">
              <span>Thread started from a message by </span>
              <b className="font-semibold text-text-secondary">{parent.display_name || parent.username}</b>
              <p className="mt-0.5 line-clamp-3 break-words text-sm text-text-secondary">{parent.content?.trim() || 'Attachment'}</p>
            </div>
          )}
          {error && <p className="px-4 pt-2 text-xs text-danger">{error}</p>}
          {messages.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-text-muted">No messages in this thread yet.</p>
          )}
          {messages.map((msg, i) => (
            <MessageItem key={msg.id} message={msg} showHeader={shouldShowMessageHeader(msg, messages[i - 1])} />
          ))}
        </div>

        <MessageInput threadId={thread.id} />
      </div>

      {showSettings && <ThreadSettingsModal thread={thread} onClose={() => setShowSettings(false)} />}
      <ConfirmDialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => { void deleteThread(thread.id).catch(() => setError('Failed to delete thread')); }}
        title="Delete thread"
        message={`Delete the thread "${thread.name}" and its messages? This cannot be undone.`}
        confirmText="Delete"
      />
    </ServerMentionProvider>
  );
}
