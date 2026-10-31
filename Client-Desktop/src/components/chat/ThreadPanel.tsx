import { useEffect, useState } from 'react';
import { ServerMentionProvider } from './mentions';
import { useThreadStore } from '../../stores/threadStore';
import { useMessageStore } from '../../stores/messageStore';
import { MessageItem } from './MessageItem';
import { shouldShowMessageHeader } from './messageGrouping';
import { MessageInput } from './MessageInput';
import { Edit3, Trash2, X } from 'lucide-react';

export function ThreadPanel() {
  const activeThread = useThreadStore((s) => s.activeThread);
  const setActiveThread = useThreadStore((s) => s.setActiveThread);
  const renameThread = useThreadStore((s) => s.renameThread);
  const deleteThread = useThreadStore((s) => s.deleteThread);
  const messagesByThread = useMessageStore((s) => s.messagesByThread);
  const fetchThreadMessages = useMessageStore((s) => s.fetchThreadMessages);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    if (!activeThread) return;
    fetchThreadMessages(activeThread.id);
    setName(activeThread.name);
  }, [activeThread, fetchThreadMessages]);

  if (!activeThread) return null;

  const messages = messagesByThread[activeThread.id] ?? [];

  return (
    <ServerMentionProvider>
    <div className="w-full md:w-80 border-l border-border bg-bg-chat flex flex-col fixed md:relative inset-0 z-30 md:z-auto">
      <div className="h-12 px-4 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {editing ? (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-bg-input border border-border rounded px-2 py-1 text-sm text-text-primary w-full"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  renameThread(activeThread.id, name.trim());
                  setEditing(false);
                }
                if (e.key === 'Escape') {
                  setName(activeThread.name);
                  setEditing(false);
                }
              }}
              autoFocus
            />
          ) : (
            <div className="text-sm text-text-primary font-semibold truncate">
              {activeThread.name}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditing((v) => !v)}
            className="text-text-muted hover:text-text-primary transition-colors"
            title="Rename Thread"
          >
            <Edit3 className="h-4 w-4" />
          </button>
          <button
            onClick={() => deleteThread(activeThread.id)}
            className="text-text-muted hover:text-danger transition-colors"
            title="Delete Thread"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setActiveThread(null)}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {messages.map((msg, i) => {
          const prev = messages[i - 1];
          const showHeader = shouldShowMessageHeader(msg, prev);
          return <MessageItem key={msg.id} message={msg} showHeader={showHeader} />;
        })}
      </div>
      <MessageInput threadId={activeThread.id} />

      {/* Mobile overlay */}
      <div
        className="fixed inset-0 bg-black/50 -z-10 md:hidden"
        onClick={() => setActiveThread(null)}
      />
    </div>
    </ServerMentionProvider>
  );
}
