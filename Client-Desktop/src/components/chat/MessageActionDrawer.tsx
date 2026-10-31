import type { ReactNode } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useMessageStore } from '../../stores/messageStore';
import { useThreadStore } from '../../stores/threadStore';
import type { Message } from '../../types';
import { copyMessageText, dispatchMessageEditRequest, dispatchMessageForward, dispatchMessageReply } from '../../messaging/chatlib/messageActions';

interface MessageActionData {
  message: Message;
  canEdit: boolean;
  canDelete: boolean;
  canPin: boolean;
  canThread: boolean;
  isPinned: boolean;
}

export function MessageActionDrawer() {
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData) as MessageActionData | null;
  const closeModal = useUIStore((s) => s.closeModal);
  const openModal = useUIStore((s) => s.openModal);
  const { pinMessage, unpinMessage } = useMessageStore();
  const createThread = useThreadStore((s) => s.createThread);

  if (activeModal !== 'messageActions' || !modalData) return null;

  const { message, canEdit, canDelete, canPin, canThread, isPinned } = modalData;

  const handleEdit = () => {
    closeModal();
    dispatchMessageEditRequest(message.id);
  };

  const handleReply = () => {
    closeModal();
    dispatchMessageReply(message);
  };

  const handleForward = () => {
    closeModal();
    dispatchMessageForward(message);
  };

  const handleCopyText = () => {
    copyMessageText(message.content);
    closeModal();
  };

  const handlePin = () => {
    if (isPinned) {
      unpinMessage(message.channel_id, message.id).catch(() => {});
    } else {
      pinMessage(message.channel_id, message.id).catch(() => {});
    }
    closeModal();
  };

  const handleThread = () => {
    createThread(message.channel_id, message.id, `Thread: ${message.username}`);
    closeModal();
  };

  const handleDelete = () => {
    closeModal();
    openModal('deleteMessage', message);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-50 modal-backdrop-in"
        onClick={closeModal}
      />

      {/* Bottom drawer */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bottom-drawer">
        {/* Rounded top card */}
        <div className="bg-bg-elevated rounded-t-2xl shadow-2xl border-t border-border overflow-hidden">
          {/* Handle bar */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-10 h-1 bg-border rounded-full" />
          </div>

          {/* Preview of message */}
          <div className="px-4 py-2 border-b border-border/50 mb-1">
            <p className="text-xs text-text-muted font-medium mb-0.5">{message.username}</p>
            {message.content ? (
              <p className="text-sm text-text-secondary truncate">{message.content}</p>
            ) : (
              <p className="text-sm text-text-muted italic">Attachment</p>
            )}
          </div>

          {/* Action rows */}
          <div className="pb-safe pb-6 px-2">
            {canEdit && (
              <ActionRow
                icon={<PencilIcon />}
                label="Edit Message"
                onClick={handleEdit}
              />
            )}
            <ActionRow
              icon={<ReplyIcon />}
              label="Reply"
              onClick={handleReply}
            />
            <ActionRow
              icon={<ForwardIcon />}
              label="Forward"
              onClick={handleForward}
            />
            {message.content && (
              <ActionRow
                icon={<CopyIcon />}
                label="Copy Text"
                onClick={handleCopyText}
              />
            )}
            {canPin && (
              <ActionRow
                icon={<PinIcon />}
                label={isPinned ? 'Unpin Message' : 'Pin Message'}
                onClick={handlePin}
              />
            )}
            {canThread && (
              <ActionRow
                icon={<ThreadIcon />}
                label="Start Thread"
                onClick={handleThread}
              />
            )}
            {canDelete && (
              <ActionRow
                icon={<TrashIcon />}
                label="Delete Message"
                onClick={handleDelete}
                danger
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ActionRow({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-xl text-sm font-medium transition-colors active:scale-[0.98] ${
        danger
          ? 'text-danger hover:bg-danger/10 active:bg-danger/15'
          : 'text-text-primary hover:bg-bg-hover active:bg-bg-hover'
      }`}
    >
      <span className="w-5 h-5 flex items-center justify-center shrink-0 opacity-80">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <polyline points="9 17 4 12 9 7" />
      <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
    </svg>
  );
}

function ForwardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <polyline points="15 17 20 12 15 7" />
      <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z" />
    </svg>
  );
}

function ThreadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
