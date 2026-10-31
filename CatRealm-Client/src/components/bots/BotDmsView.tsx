import { useEffect, useRef, useState } from 'react';
import { Bot as BotIcon, Send, X } from 'lucide-react';
import { useBotStore } from '../../stores/botStore';
import { useChannelStore } from '../../stores/channelStore';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { AvatarImage } from '../ui/AvatarImage';
import { resolveAvatarUrl } from '../../utils/avatar';
import { formatMessageTime } from '../../utils/formatTime';
import { useSettingsStore } from '../../stores/settingsStore';

// Full-pane "Bot DMs" view — the pinned pseudo-channel below Realm Rules.
// Shows per-bot private conversations persisted on the realm.
export function BotDmsView() {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const timeFormat = useSettingsStore((s) => s.timeFormat);
  const openModal = useUIStore((s) => s.openModal);
  const conversations = useBotStore((s) => s.conversations);
  const messagesByBot = useBotStore((s) => s.messagesByBot);
  const activeBotDmId = useBotStore((s) => s.activeBotDmId);
  const openBotDms = useBotStore((s) => s.openBotDms);
  const closeBotDms = useBotStore((s) => s.closeBotDms);
  const fetchDmMessages = useBotStore((s) => s.fetchDmMessages);
  const markConversationRead = useBotStore((s) => s.markConversationRead);
  const replyToBot = useBotStore((s) => s.replyToBot);
  const activeChannelId = useChannelStore((s) => s.activeChannelId);

  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const openedWithChannelId = useRef(activeChannelId);

  // Selecting a real channel in the sidebar leaves this view.
  useEffect(() => {
    if (activeChannelId !== openedWithChannelId.current) closeBotDms();
  }, [activeChannelId, closeBotDms]);

  const active = conversations.find((c) => c.botId === activeBotDmId) ?? null;
  const messages = activeBotDmId ? (messagesByBot[activeBotDmId] ?? []) : [];

  useEffect(() => {
    if (!activeBotDmId) return;
    void fetchDmMessages(activeBotDmId);
    void markConversationRead(activeBotDmId);
  }, [activeBotDmId, fetchDmMessages, markConversationRead]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, activeBotDmId]);

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || !activeBotDmId) return;
    setDraft('');
    setSendError(null);
    const ok = await replyToBot(activeBotDmId, content);
    if (!ok) setSendError('Failed to send — the bot may be disabled.');
  };

  return (
    <div className="flex-1 flex min-h-0 bg-bg-chat">
      {/* Conversation list */}
      <div className="w-60 shrink-0 border-r border-border flex flex-col">
        <div className="h-12 px-4 flex items-center justify-between border-b border-border shrink-0">
          <div className="flex items-center gap-2 font-semibold text-text-primary">
            <BotIcon className="w-4 h-4 text-indigo-400" /> Bot DMs
          </div>
          <button
            type="button"
            onClick={closeBotDms}
            className="p-1 rounded hover:bg-bg-hover text-text-muted"
            aria-label="Close Bot DMs"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {conversations.length === 0 && (
            <p className="px-2 py-4 text-xs text-text-muted">
              No bot messages yet. Bots you've allowed can message you here.
            </p>
          )}
          {conversations.map((conv) => (
            <button
              key={conv.botId}
              type="button"
              onClick={() => openBotDms(conv.botId)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                conv.botId === activeBotDmId ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:bg-bg-hover/60'
              }`}
            >
              <span className="w-8 h-8 rounded-full overflow-hidden bg-indigo-600/30 flex items-center justify-center text-white shrink-0">
                <AvatarImage
                  src={resolveAvatarUrl(conv.avatar, serverUrl)}
                  alt={conv.username}
                  size={32}
                  className="w-8 h-8 object-cover"
                  fallback={<BotIcon className="w-4 h-4" />}
                />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{conv.displayName || conv.username}</span>
              {conv.unread > 0 && (
                <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[11px] font-bold flex items-center justify-center">
                  {conv.unread > 99 ? '99+' : conv.unread}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 flex flex-col min-w-0">
        {!active ? (
          <div className="flex-1 flex flex-col items-center justify-center text-text-muted gap-2">
            <BotIcon className="w-10 h-10 opacity-40" />
            <p className="text-sm">Select a bot conversation</p>
          </div>
        ) : (
          <>
            <div className="h-12 px-4 flex items-center gap-2 border-b border-border shrink-0">
              <button
                type="button"
                className="flex items-center gap-2 hover:opacity-80"
                onClick={() => openModal('profileView', { userId: active.botUserId })}
              >
                <span className="w-7 h-7 rounded-full overflow-hidden bg-indigo-600/30 flex items-center justify-center text-white">
                  <AvatarImage
                    src={resolveAvatarUrl(active.avatar, serverUrl)}
                    alt={active.username}
                    size={28}
                    className="w-7 h-7 object-cover"
                    fallback={<BotIcon className="w-4 h-4" />}
                  />
                </span>
                <span className="font-semibold text-text-primary">{active.displayName || active.username}</span>
                <span className="rounded bg-indigo-600 px-1 py-px text-[10px] font-bold uppercase text-white">BOT</span>
              </button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[70%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                      msg.sender === 'user'
                        ? 'bg-accent text-white'
                        : 'bg-bg-input text-text-primary'
                    }`}
                  >
                    <p>{msg.content}</p>
                    <p className={`mt-0.5 text-[10px] ${msg.sender === 'user' ? 'text-white/70' : 'text-text-muted'}`}>
                      {formatMessageTime(msg.created_at, timeFormat)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3 border-t border-border">
              {sendError && <p className="mb-1 text-xs text-danger">{sendError}</p>}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={draft}
                  maxLength={2000}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={`Message @${active.username}`}
                  className="flex-1 rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!draft.trim()}
                  className="p-2 rounded-lg bg-accent text-white disabled:opacity-40"
                  aria-label="Send"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
